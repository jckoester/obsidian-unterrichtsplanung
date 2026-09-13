import type { GgdApiClient } from "../api/client";
import { materialize, type GruppenZuordnung, type VorhandeneNotiz } from "./materialize";
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

	const suchOrdner = [zuordnung.ordner, zuordnung.stundenOrdner].filter(Boolean).join("/");
	const pfade = await vault.list(suchOrdner);
	const vorhanden: VorhandeneNotiz[] = [];
	for (const pfad of pfade) {
		vorhanden.push({ pfad, inhalt: await vault.read(pfad) });
	}

	const plan = materialize({ zuordnung, overview, vorhanden });
	const fehler: string[] = [];

	if (!dryRun) {
		for (const op of plan.ops) {
			try {
				switch (op.art) {
					case "umbenennen":
						if (op.vonPfad) await vault.rename(op.vonPfad, op.pfad);
						break;
					case "erstellen":
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
