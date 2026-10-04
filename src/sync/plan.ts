import type { LessonUpdate } from "../api/types";

export type SyncOpArt =
	| "erstellen"
	| "aktualisieren"
	| "umbenennen"
	| "archivieren"
	| "konflikt"
	| "zurueckschreiben"
	| "zurueckgehalten"
	| "unveraendert";

/**
 * Was der Runner zur Plattform schickt. `knotenId: null` heißt: Der Termin hat noch keinen
 * Entwurf — er wird erst angelegt, dann beschrieben.
 */
export interface Rueckkanal {
	slotId: string;
	knotenId: string | null;
	nutzlast: LessonUpdate;
	/**
	 * Der Ablauf, wie er beim Planen im Vault stand. Nach dem Schreiben wird der Hash damit
	 * gebildet, nicht mit dem, was dann in der Datei steht: Hat jemand in der Zwischenzeit
	 * weitergeschrieben, bleibt das als Vault-Änderung sichtbar, statt eingemeindet zu werden.
	 */
	vaultAblauf: unknown;
}

export interface SyncOp {
	art: SyncOpArt;
	pfad: string;
	/** Bei „umbenennen": der bisherige Pfad. */
	vonPfad?: string;
	/** Der zu schreibende Inhalt; fehlt bei „unveraendert", „umbenennen" und dem Rückkanal. */
	inhalt?: string;
	/** Bei „zurueckschreiben". */
	rueckkanal?: Rueckkanal;
	grund?: string;
}

export interface SyncPlan {
	gruppe: number;
	ops: SyncOp[];
}

export function planZusammenfassung(plan: SyncPlan): string {
	const zaehler = new Map<SyncOpArt, number>();
	for (const op of plan.ops) zaehler.set(op.art, (zaehler.get(op.art) ?? 0) + 1);
	const teile = [...zaehler.entries()]
		.filter(([art]) => art !== "unveraendert")
		.map(([art, n]) => `${n}× ${art}`);
	const unveraendert = zaehler.get("unveraendert") ?? 0;
	if (teile.length === 0) return `nichts zu tun (${unveraendert} unverändert)`;
	return `${teile.join(", ")} — ${unveraendert} unverändert`;
}
