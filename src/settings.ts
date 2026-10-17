import type { AusgeblendeteGruppe, GruppenEinstellung } from "./gruppen";
import type { Wertelisten } from "./sync/wertelisten";

export interface UpsSettings {
	basisUrl: string;
	/** Personal Access Token (`ggd_pat_…`). Landet in data.json — nicht ins Repo. */
	token: string;
	/** Minuten; 0 = nur manuell. */
	syncIntervall: number;
	/** Standardmäßig an: Ein Sync-Client, der schreibt, zeigt erst, was er vorhat. */
	dryRun: boolean;
	/**
	 * Sammelordner aller Lehraufträge, z. B. `Bereiche/11 Unterricht`. Bewusst ohne
	 * Vorgabe: Leer weist der Sync jede Gruppe ab, statt in die Wurzel des Vaults zu schreiben.
	 */
	basisOrdner: string;
	gruppen: GruppenEinstellung[];
	ausgeblendet: AusgeblendeteGruppe[];
	/**
	 * Sozialformen und Methoden der Plattform, beim letzten Sync geladen — damit der
	 * Phasen-Editor auch offline Vorschläge hat. `null`, solange noch nie geladen.
	 */
	wertelisten: Wertelisten | null;
	letzterSync: string | null;
}

export const STANDARD_EINSTELLUNGEN: UpsSettings = {
	basisUrl: "",
	token: "",
	syncIntervall: 0,
	dryRun: true,
	basisOrdner: "",
	gruppen: [],
	ausgeblendet: [],
	wertelisten: null,
	letzterSync: null,
};

/**
 * Gespeicherte Einstellungen über die Vorgaben legen.
 *
 * `zuordnungen` ist das Format vor dem Basisordner (bis 04.10.2026): je Gruppe ein voller
 * Ordnerpfad und eine von Hand eingetragene `group_id`. Es gab es nur im Testvault; die
 * Gruppen kommen über „Gruppen holen" neu, und der Vorschlag findet die vorhandenen Ordner
 * wieder. Umgeschrieben wird deshalb nichts — das Feld fällt nur weg, statt für immer in
 * `data.json` mitzureisen.
 */
export function ladeEinstellungen(gespeichert: unknown): UpsSettings {
	const { zuordnungen: _alt, gruppen, ...rest } = (gespeichert ?? {}) as Partial<UpsSettings> & {
		zuordnungen?: unknown;
	};
	// Eigene Listen statt der aus den Vorgaben: Sonst änderte das erste `push` die Vorgaben mit.
	return {
		...STANDARD_EINSTELLUNGEN,
		ausgeblendet: [],
		...rest,
		// Eingerichtet vor dem Plattformfach (bis 16.10.2026): Der nächste Sync trägt es nach.
		gruppen: (gruppen ?? []).map((g) => ({ ...g, fachId: g.fachId ?? null, fachSlug: g.fachSlug ?? null })),
	};
}
