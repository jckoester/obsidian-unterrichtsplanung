export type SyncOpArt =
	| "erstellen"
	| "aktualisieren"
	| "umbenennen"
	| "archivieren"
	| "konflikt"
	| "unveraendert";

export interface SyncOp {
	art: SyncOpArt;
	pfad: string;
	/** Bei „umbenennen": der bisherige Pfad. */
	vonPfad?: string;
	/** Der zu schreibende Inhalt; fehlt bei „unveraendert" und „umbenennen". */
	inhalt?: string;
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
