import type { GgdApiClient } from "../api/client";
import { HttpError } from "../api/http";
import type { ContextNodeRead, SlotRead } from "../api/types";
import type { OverviewRead } from "../api/types";
import {
	materialize,
	nachDemZurueckschreiben,
	type GruppenZuordnung,
	type Stundenknoten,
	type VorhandeneNotiz,
} from "./materialize";
import { normalisierePhasen } from "./phasen";
import { eintraegeAus, type Wertelisten } from "./wertelisten";
import { planZusammenfassung, type SyncOp, type SyncPlan } from "./plan";
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
	wertelisten: Wertelisten | null = null,
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
		wertelisten,
	});
	const fehler: string[] = [];

	if (!dryRun) {
		// Die Ordner gleich anlegen, nicht erst mit der ersten Notiz: Eine frisch eingerichtete
		// Gruppe ohne Termine hätte sonst keinen Ordner, und man suchte nach dem Fehler. Erst
		// hier, nach `materialize()` — das hat die Zuordnung geprüft, ein leerer Pfad kommt
		// nicht bis hierher.
		try {
			await vault.ensureFolder(zuordnung.ordner);
			if (zuordnung.stundenOrdner) {
				await vault.ensureFolder(`${zuordnung.ordner}/${zuordnung.stundenOrdner}`);
			}
		} catch (error) {
			fehler.push(`Ordner ${zuordnung.ordner}: ${(error as Error).message}`);
		}

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
					case "zurueckschreiben": // nach den Dateien, siehe unten
					case "zurueckgehalten":
					case "unveraendert":
						break;
				}
			} catch (error) {
				fehler.push(`${op.art} ${op.pfad}: ${(error as Error).message}`);
			}
		}
		// Erst die Dateien, dann der Rückkanal: Danach schreibt er die Buchführung in die
		// Notiz, und die soll dann schon dort liegen, wo der Plan sie hinlegt.
		const rueck = plan.ops.filter((op) => op.art === "zurueckschreiben");
		if (rueck.length > 0) {
			fehler.push(...(await schreibeZurueck(api, vault, zuordnung, overview, stundenknoten, rueck)));
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
 * Stundenziel und Phasen hängen am Stundenknoten, nicht am Slot. Geholt wird
 * gesammelt — eine Anfrage je 500 Stunden statt einer je Stunde gegen eine gedrosselte API.
 *
 * Der Sammelabruf filtert über `read_scope_group_id`. Das trifft, was die Planung anlegt,
 * aber nicht alles, was an einem Slot hängen kann: Bis Plattform 0.12.0 nahm
 * `PATCH /planning/slots/{id}` jeden Knoten, und eine Kopie aus einer Vorjahresgruppe
 * behält deren Gruppe. Seit 0.12.1 prüft die Plattform die Gruppe beim Zuweisen; was davor
 * angehängt wurde, hängt aber weiter. Was fehlt, wird deshalb einzeln nachgeholt — selten,
 * und ohne dass ein Stundenziel still verschwindet.
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
		knoten.set(k.id, {
			id: k.id,
			stundenziel: typeof ziel === "string" ? ziel : null,
			phasen: normalisierePhasen(k.metadata["phasen"]),
			updated_at: k.updated_at,
			darf_schreiben: k.darf_schreiben ?? null,
		});
	}

	for (const slot of slots) {
		const id = slot.stunde_node_id;
		if (!id || knoten.has(id)) continue;
		try {
			const stunde = await api.lesson(id);
			knoten.set(id, {
				id,
				stundenziel: stunde.stundenziel,
				phasen: normalisierePhasen(stunde.phasen),
				updated_at: stunde.updated_at,
				darf_schreiben: stunde.darf_bearbeiten,
			});
		} catch (error) {
			if (error instanceof HttpError && (error.status === 403 || error.status === 404)) continue;
			throw error;
		}
	}
	return [...knoten.values()];
}

/**
 * Sozialformen und Methoden der Plattform — einmal je Sync-Lauf, nicht je Gruppe: Es sind
 * dieselben Listen für alle Gruppen.
 */
export async function ladeWertelisten(api: GgdApiClient): Promise<Wertelisten> {
	return {
		sozialform: eintraegeAus(await api.knotenVomTyp("sozialform")),
		methode: eintraegeAus(await api.knotenVomTyp("methode")),
	};
}

/** Ab dieser Plattformversion bleiben Nachbereitungsstatus und Marken beim Schreiben erhalten (P2). */
export const MINDESTVERSION = "0.13.0";

/** `x.y.z` ≥ `mindestens`? Alles, was keine Version ist (`unbekannt`), gilt als zu alt. */
export function versionReicht(version: string, mindestens = MINDESTVERSION): boolean {
	const teile = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);
	const ist = teile(version.trim());
	const soll = teile(mindestens) as number[];
	if (!ist) return false;
	for (let i = 0; i < 3; i++) {
		if ((ist[i] as number) !== soll[i]) return (ist[i] as number) > (soll[i] as number);
	}
	return true;
}

/**
 * Schreibt zur Plattform und danach die Buchführung in die Notiz: erst das Thema an den
 * Termin, dann Ablauf und Stundenziel an den Entwurf. In dieser Reihenfolge, weil das
 * Anlegen eines Entwurfs den Stempel des Slots weiterrückt — das Thema danach liefe in einen
 * 409 gegen den eigenen Schritt.
 *
 * Vorher einmal `/health`: Unter 0.13 ginge beim Schreiben der Nachbereitungsstatus der
 * Phasen verloren, ohne dass das Plugin es merken könnte. Dann wird nur gelesen.
 *
 * Ein 409 überschreibt nichts: Die Plattform hat sich seit dem Lesen bewegt. Der nächste
 * Lauf sieht das als Serveränderung und macht einen Konfliktblock daraus.
 */
async function schreibeZurueck(
	api: GgdApiClient,
	vault: VaultAdapter,
	zuordnung: GruppenZuordnung,
	overview: OverviewRead,
	gelesen: Stundenknoten[],
	ops: SyncOp[],
): Promise<string[]> {
	const fehler: string[] = [];
	let version: string;
	try {
		version = await api.plattformversion();
	} catch {
		version = "unbekannt";
	}
	if (!versionReicht(version)) {
		return ops.map((op) => `zurueckschreiben ${op.pfad}: Plattform ${version} — zurückgeschrieben wird erst ab ${MINDESTVERSION}`);
	}

	for (const op of ops) {
		const rueckkanal = op.rueckkanal;
		if (!rueckkanal) continue;
		try {
			let termin: { thema: string | null; updated_at: string } | undefined;
			if (rueckkanal.termin) {
				const slot = await api.patchSlot(rueckkanal.slotId, rueckkanal.termin);
				termin = { thema: slot.thema, updated_at: slot.updated_at };
			}

			let stunde = gelesen.find((k) => k.id === rueckkanal.knotenId);
			if (rueckkanal.stunde) {
				let id = rueckkanal.knotenId;
				let nutzlast = rueckkanal.stunde;
				if (!id) {
					id = (await api.entwurfFuerSlot(rueckkanal.slotId)).id;
					// Der Entwurf ist eben erst entstanden — es gibt keinen Stand, gegen den
					// sich etwas geändert haben könnte.
					const { expected_updated_at: _ohneStempel, ...ohne } = nutzlast;
					nutzlast = ohne;
				}
				const antwort = await api.patchLesson(id, nutzlast);
				stunde = {
					id,
					stundenziel: antwort.stundenziel,
					phasen: normalisierePhasen(antwort.phasen),
					updated_at: antwort.updated_at,
					darf_schreiben: true,
				};
			}
			const inhalt = await vault.read(op.pfad);
			await vault.write(
				op.pfad,
				nachDemZurueckschreiben({
					zuordnung,
					overview,
					inhalt,
					slotId: rueckkanal.slotId,
					stunde,
					termin,
					vaultAblauf: rueckkanal.vaultAblauf,
				}),
			);
		} catch (error) {
			const nachricht =
				error instanceof HttpError && error.status === 409
					? "auf der Plattform inzwischen geändert — nichts überschrieben, der nächste Lauf gleicht ab"
					: (error as Error).message;
			fehler.push(`zurueckschreiben ${op.pfad}: ${nachricht}`);
		}
	}
	return fehler;
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
