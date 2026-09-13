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
		ordner: "Bereiche/11 Unterricht",
		stundenOrdner: "Unterrichtsstunden",
		dateiMuster: STANDARD_DATEIMUSTER,
	};
}
