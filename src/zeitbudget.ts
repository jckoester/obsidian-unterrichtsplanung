/**
 * Das Zeitbudget einer Stunde — rein, ohne Obsidian. Gezeichnet wird es von der Zeitleiste
 * unter `## Ablauf` (Plan-Ablauf-Editor, B3).
 *
 * Gerechnet wird wie im Stundeneditor der Plattform (`PhaseTable.svelte`,
 * `lib/phasendauer.js`): Jede Phase zählt mit ihrer Dauer, gleich welche Prio. Eine Phase
 * ohne Dauer zählt null Minuten, hält aber die Uhr an: Für sie und alle folgenden lässt sich
 * kein Ende mehr angeben.
 *
 * ⚠️ **Eine Ausnahme, bewusst** (Jan, 18.10.2026): Eine gestrichene Phase zählt nicht — sie
 * findet nicht statt. Die Plattform zählt sie mit; die Minuten weichen dann voneinander ab.
 */

import { plattformRegion, readFelder, splitNote } from "./sync/frontmatter";
import { leseAblauf } from "./sync/phasen";

/** Was das Zeitbudget von einer Phase braucht. In einer Liste fehlt die Prio. */
export interface ZeitPhase {
	name: string;
	dauer_min?: number | null;
	prio?: string;
	gestrichen?: boolean;
}

export interface ZeitAbschnitt {
	name: string;
	prio: string | null;
	dauer: number | null;
	/** Minute, in der die Phase beginnt; `null`, sobald davor eine Phase ohne Dauer stand. */
	beginn: number | null;
	/** `0–10′`, `ab 20′` oder `–`, wie die Zeit-Spalte der Plattform. */
	spanne: string;
	/** Gestrichen: ohne Minuten, ohne Platz im Balken. */
	gestrichen: boolean;
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
		if (phase.gestrichen) {
			abschnitte.push({ name: phase.name, prio: phase.prio ?? null, dauer, beginn: null, spanne: "–", gestrichen: true });
			continue;
		}
		abschnitte.push({
			name: phase.name,
			prio: phase.prio ?? null,
			dauer,
			beginn: uhr,
			spanne: zeitspanne(uhr, dauer),
			gestrichen: false,
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

/** Was die Zeitleiste zeigt: das Budget und, was die Plattform am Ablauf ablehnen würde. */
export interface ZeitleisteDaten {
	budget: Zeitbudget;
	fehler: string[];
}

/**
 * Die Zeitleiste aus dem Text einer Stundennotiz; `null`, wenn sie keinen Ablauf hat.
 * Gelesen wird wie im Rückkanal — nur die Plattform-Region, mit `leseAblauf` —, damit die
 * Zeitleiste zeigt, was beim nächsten Sync zur Plattform ginge. Die Fehler gleich mit: Eine
 * unbekannte Prio hält sonst erst beim Sync die ganze Stunde zurück.
 */
export function zeitleisteAus(inhalt: string): ZeitleisteDaten | null {
	const { frontmatter, body } = splitNote(plattformRegion(inhalt));
	const ablauf = leseAblauf(body);
	if (!ablauf) return null;
	const minuten = verfuegbareMinuten(readFelder(frontmatter)["UStunden"]);
	const phasen = ablauf.phasen.map((p, i) => ({ ...p, gestrichen: ablauf.stellen[i]?.gestrichen ?? false }));
	return { budget: zeitbudget(phasen, minuten), fehler: ablauf.fehler };
}

/**
 * Breite einer Phase ohne Dauer im Balken, als wären es so viele Minuten: sichtbar und
 * anklickbar, aber erkennbar schmal. Der Balken wird dadurch um ein paar Minuten ungenau —
 * die Zahlen darüber rechnen sie nicht mit.
 */
export const ERSATZ_MINUTEN = 3;

export interface BalkenTeil {
	art: "phase" | "frei";
	/** Stelle der Phase im Ablauf; fehlt beim freien Rest. */
	nummer?: number;
	/** Breite in Prozent des Balkens. */
	anteil: number;
}

export interface Balken {
	teile: BalkenTeil[];
	/** Wo die verfügbare Zeit endet, in Prozent — bei einem Überhang mitten im Balken. */
	ziel: number;
}

/** Die Abschnitte des Balkens: eine je Phase, dahinter der freie Rest. Gestrichene fehlen. */
export function balken(budget: Zeitbudget): Balken {
	const breite = (a: ZeitAbschnitt) => (a.gestrichen ? 0 : (a.dauer ?? ERSATZ_MINUTEN));
	const belegt = budget.abschnitte.reduce((summe, a) => summe + breite(a), 0);
	const gesamt = Math.max(belegt, budget.verfuegbar, 1);
	const teile: BalkenTeil[] = budget.abschnitte.flatMap((a, nummer) =>
		a.gestrichen ? [] : [{ art: "phase" as const, nummer, anteil: (breite(a) / gesamt) * 100 }],
	);
	if (belegt < gesamt) teile.push({ art: "frei", anteil: ((gesamt - belegt) / gesamt) * 100 });
	return { teile, ziel: (budget.verfuegbar / gesamt) * 100 };
}

