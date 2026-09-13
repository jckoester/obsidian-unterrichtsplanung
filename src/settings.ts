import type { GruppenZuordnung } from "./sync/materialize";
import { STANDARD_DATEIMUSTER } from "./sync/materialize";

export interface UpsSettings {
	basisUrl: string;
	/** Personal Access Token (`ggd_pat_…`). Landet in data.json — nicht ins Repo. */
	token: string;
	/** Minuten; 0 = nur manuell. */
	syncIntervall: number;
	/** Standardmäßig an: Ein Sync-Client, der schreibt, zeigt erst, was er vorhat. */
	dryRun: boolean;
	zuordnungen: GruppenZuordnung[];
	letzterSync: string | null;
}

export const STANDARD_EINSTELLUNGEN: UpsSettings = {
	basisUrl: "",
	token: "",
	syncIntervall: 0,
	dryRun: true,
	zuordnungen: [],
	letzterSync: null,
};

export function leereZuordnung(groupId = 0): GruppenZuordnung {
	return {
		groupId,
		lehrauftragLink: "",
		// Bewusst leer. `Bereiche/11 Unterricht` stand hier vorher als Standard und sah
		// richtig aus — es ist aber die Sammelstelle, nicht ein Lehrauftrag. Wer ihn
		// stehen ließ, bekam die Stunden eine Ebene zu hoch und suchte sie im falschen
		// Ordner. Ein leeres Feld, das der Sync abweist, ist ehrlicher als ein
		// plausibler falscher Wert.
		ordner: "",
		stundenOrdner: "Unterrichtsstunden",
		dateiMuster: STANDARD_DATEIMUSTER,
	};
}
