import type { GgdApiClient } from "../api/client";
import { HttpError } from "../api/http";
import type { ContextNodeRead, SlotRead } from "../api/types";
import {
	materialize,
	type GruppenZuordnung,
	type Stundenknoten,
	type VorhandeneNotiz,
} from "./materialize";
import { planZusammenfassung, type SyncPlan } from "./plan";
import type { VaultAdapter } from "./vault-adapter";

export interface SyncErgebnis {
	plan: SyncPlan;
	ausgefuehrt: boolean;
	zusammenfassung: string;
	fehler: string[];
}

/**
 * Holt den Serverstand, baut den Plan und führt ihn aus — es sei denn, `dryRun`.
 * Gelöscht wird nie; das ist die einzige harte Zusage des Sync an den Vault.
 */
export async function syncGruppe(
	api: GgdApiClient,
	vault: VaultAdapter,
	zuordnung: GruppenZuordnung,
	dryRun: boolean,
): Promise<SyncErgebnis> {
	const overview = await api.overview(zuordnung.groupId);
	const stundenknoten = await holeStundenknoten(api, zuordnung.groupId, overview.slots);

	// Der ganze Lehrauftragsordner, nicht nur der Stunden-Unterordner: Darin liegen auch
	// die Lehrauftragsnotiz und die UE-Ordner, und ohne sie hielte der Plan jede
	// vorhandene UE für fehlend und legte sie ein zweites Mal an.
	const pfade = await vault.list(zuordnung.ordner);
	const vorhanden: VorhandeneNotiz[] = [];
	for (const pfad of pfade) {
		vorhanden.push({ pfad, inhalt: await vault.read(pfad) });
	}

	const plan = materialize({
		zuordnung,
		overview,
		vorhanden,
		stundenknoten,
		lehrauftragVorlage: await leseVorlage(vault),
	});
	const fehler: string[] = [];

	if (!dryRun) {
		for (const op of plan.ops) {
			try {
				switch (op.art) {
					// Zwei Wächter, und beide meinen dasselbe: Auf einem belegten Zielpfad
					// liegt eine Notiz, die dem Plan nicht gehört — sonst stünde sie mit
					// ihrem Anker darin. Sie zu überschreiben wäre ein Löschen mit anderem
					// Namen. Lieber ein Fehler im Ergebnisfenster als eine Notiz weniger.
					case "umbenennen":
						if (!op.vonPfad) break;
						if (await vault.exists(op.pfad)) {
							throw new Error(`Zielpfad ist belegt: ${op.pfad}`);
						}
						await vault.rename(op.vonPfad, op.pfad);
						break;
					case "erstellen":
						if (await vault.exists(op.pfad)) {
							throw new Error(`Datei liegt schon dort: ${op.pfad}`);
						}
						if (op.inhalt !== undefined) await vault.write(op.pfad, op.inhalt);
						break;
					case "aktualisieren":
					case "archivieren":
					case "konflikt":
						if (op.inhalt !== undefined) await vault.write(op.pfad, op.inhalt);
						break;
					case "unveraendert":
						break;
				}
			} catch (error) {
				fehler.push(`${op.art} ${op.pfad}: ${(error as Error).message}`);
			}
		}
	}

	return {
		plan,
		ausgefuehrt: !dryRun,
		zusammenfassung: planZusammenfassung(plan),
		fehler,
	};
}

/**
 * Stundenziel (und später die Phasen) hängen am Stundenknoten, nicht am Slot. Geholt wird
 * gesammelt — eine Anfrage je 500 Stunden statt einer je Stunde gegen eine gedrosselte API.
 *
 * Der Sammelabruf filtert über `read_scope_group_id`. Das trifft, was die Planung anlegt,
 * aber nicht alles, was an einem Slot hängen kann: `PATCH /planning/slots/{id}` nimmt jeden
 * Knoten, und eine Kopie aus einer Vorjahresgruppe behält deren Gruppe. Was fehlt, wird
 * deshalb einzeln nachgeholt — selten, und ohne dass ein Stundenziel still verschwindet.
 * Bleibt ein Knoten auch dann unlesbar (gelöscht, fremd), fehlt eben sein Stundenziel.
 *
 * Ein 403 auf den Sammelabruf bricht dagegen ab. Ein stiller Rückfall auf „ohne
 * Stundenziel" hieße: Jede Notiz gälte als serverseitig geändert, sobald der Token wieder
 * passt — und umgekehrt.
 */
async function holeStundenknoten(
	api: GgdApiClient,
	groupId: number,
	slots: SlotRead[],
): Promise<Stundenknoten[]> {
	let gesammelt: ContextNodeRead[];
	try {
		gesammelt = await api.stundenknoten(groupId);
	} catch (error) {
		if (error instanceof HttpError && error.status === 403) {
			throw new Error(
				"Stundenknoten gesperrt (403) — dem Token fehlt vermutlich context:read. " +
					"Einen Token mit planning:read und context:read anlegen.",
			);
		}
		throw error;
	}

	const knoten = new Map<string, Stundenknoten>();
	for (const k of gesammelt) {
		const ziel = k.metadata["stundenziel"];
		knoten.set(k.id, { id: k.id, stundenziel: typeof ziel === "string" ? ziel : null });
	}

	for (const slot of slots) {
		const id = slot.stunde_node_id;
		if (!id || knoten.has(id)) continue;
		try {
			const stunde = await api.lesson(id);
			knoten.set(id, { id, stundenziel: stunde.stundenziel });
		} catch (error) {
			if (error instanceof HttpError && (error.status === 403 || error.status === 404)) continue;
			throw error;
		}
	}
	return [...knoten.values()];
}

/** Pfad der Lehrauftrag-Vorlage im Vault. Fehlt sie, baut das Plugin einen Ersatz. */
export const LEHRAUFTRAG_VORLAGE = "System/Templates/Unterricht/Lehrauftrag-Template.md";

async function leseVorlage(vault: VaultAdapter): Promise<string | null> {
	try {
		if (!(await vault.exists(LEHRAUFTRAG_VORLAGE))) return null;
		return await vault.read(LEHRAUFTRAG_VORLAGE);
	} catch {
		return null;
	}
}
