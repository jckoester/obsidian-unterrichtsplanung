/**
 * Das Zeitbudget einer Stunde — rein, ohne Obsidian. Gezeichnet wird es von der Zeitleiste
 * unter `## Ablauf` (Plan-Ablauf-Editor, B3).
 *
 * Gerechnet wird wie im Stundeneditor der Plattform (`PhaseTable.svelte`,
 * `lib/phasendauer.js`), damit beide Seiten dieselben Minuten zeigen: Jede Phase zählt mit
 * ihrer Dauer, gleich welcher Status oder welche Prio — auch eine gestrichene. Eine Phase
 * ohne Dauer zählt null Minuten, hält aber die Uhr an: Für sie und alle folgenden lässt sich
 * kein Ende mehr angeben.
 */

/** Was das Zeitbudget von einer Phase braucht. In einer Liste fehlt die Prio. */
export interface ZeitPhase {
	name: string;
	dauer_min?: number | null;
	prio?: string;
}

export interface ZeitAbschnitt {
	name: string;
	prio: string | null;
	dauer: number | null;
	/** Minute, in der die Phase beginnt; `null`, sobald davor eine Phase ohne Dauer stand. */
	beginn: number | null;
	/** `0–10′`, `ab 20′` oder `–`, wie die Zeit-Spalte der Plattform. */
	spanne: string;
}

export interface Zeitbudget {
	verfuegbar: number;
	geplant: number;
	/** Unverplante Minuten; 0 bei Überhang. */
	frei: number;
	/** Minuten über der verfügbaren Zeit; 0, solange es passt. */
	ueberhang: number;
	ohneDauer: number;
	/** Bezugsgröße für die Breiten im Balken: die größere von geplanter und verfügbarer Zeit. */
	massstab: number;
	abschnitte: ZeitAbschnitt[];
}

/** Eine Schulstunde hat 45 Minuten, eine Doppelstunde 90 — wie `slot.periods * 45` auf der Plattform. */
export const MINUTEN_JE_STUNDE = 45;

/**
 * Verfügbare Minuten aus `UStunden`. Fehlt der Wert oder ist er unbrauchbar, gilt eine
 * Einzelstunde — so hält es die Plattform für eine Stunde ohne Termin.
 */
export function verfuegbareMinuten(uStunden: unknown): number {
	const zahl = typeof uStunden === "string" ? Number(uStunden.trim()) : uStunden;
	const stunden = typeof zahl === "number" && Number.isInteger(zahl) && zahl > 0 ? zahl : 1;
	return stunden * MINUTEN_JE_STUNDE;
}

/** Die Zeit-Spalte der Plattform (`zeitspanne` in `lib/phasendauer.js`). */
export function zeitspanne(beginn: number | null, dauer: number | null): string {
	if (beginn === null) return "–";
	return dauer === null ? `ab ${beginn}′` : `${beginn}–${beginn + dauer}′`;
}

export function zeitbudget(phasen: ZeitPhase[], verfuegbar: number): Zeitbudget {
	const abschnitte: ZeitAbschnitt[] = [];
	let uhr: number | null = 0;
	let geplant = 0;
	let ohneDauer = 0;
	for (const phase of phasen) {
		const dauer = phase.dauer_min ?? null;
		abschnitte.push({
			name: phase.name,
			prio: phase.prio ?? null,
			dauer,
			beginn: uhr,
			spanne: zeitspanne(uhr, dauer),
		});
		if (dauer === null) ohneDauer++;
		geplant += dauer ?? 0;
		uhr = uhr === null || dauer === null ? null : uhr + dauer;
	}
	return {
		verfuegbar,
		geplant,
		frei: Math.max(0, verfuegbar - geplant),
		ueberhang: Math.max(0, geplant - verfuegbar),
		ohneDauer,
		massstab: Math.max(geplant, verfuegbar),
		abschnitte,
	};
}
