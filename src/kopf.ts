import { datumDeutsch } from "./sync/notizen";

/**
 * Was der Kopf einer Stundennotiz zeigt — rein, ohne Obsidian, damit es sich testen lässt.
 * Gezeichnet wird er in `kopf-ansicht.ts`.
 *
 * Der Sync schreibt nur den leeren Codeblock `uplan-kopf` in die Notiz, nie die Nachbarn
 * selbst. Sonst müsste er bei jeder Verschiebung bis zu drei Notizen nachziehen — genau die
 * Schreiblast, die der Dateiname aus dem Datum vermeiden soll.
 */

/** Sprache des Codeblocks, den `baueStundennotiz` an den Anfang jeder Stundennotiz schreibt. */
export const KOPF_SPRACHE = "uplan-kopf";

/** Ein Link im Kopf. `ziel` ist der Linktext (wie in `[[…]]`), `null` heißt: nur Text. */
export interface Verweis {
	ziel: string | null;
	text: string;
}

export interface KopfNotiz {
	pfad: string;
	/** Dateiname ohne `.md`. */
	name: string;
	frontmatter: Record<string, unknown>;
}

export interface KopfDaten {
	lehrauftrag: Verweis | null;
	datum: string | null;
	einheit: Verweis | null;
	vorher: Verweis | null;
	nachher: Verweis | null;
}

/**
 * Die Nachbarn sind die aktiven Stundennotizen desselben Ordners, nach Dateinamen sortiert —
 * der beginnt mit dem ISO-Datum. Numerisch, damit `(10. Std.)` nach `(3. Std.)` kommt.
 *
 * Die Notiz selbst muss dafür nicht aktiv sein: Eine archivierte findet ihren Platz über
 * ihren Namen und kommt so trotzdem zu ihren Nachbarn.
 */
export function kopfDaten(notiz: KopfNotiz, geschwister: KopfNotiz[]): KopfDaten {
	const fm = notiz.frontmatter;
	const lehrauftrag = verweis(fm["Lehrauftrag"]);
	const aktiv = geschwister
		.filter((g) => g.pfad !== notiz.pfad && g.frontmatter["uplan_slot_id"] && g.frontmatter["uplan_status"] !== "archiviert")
		.sort((a, b) => vergleiche(a.name, b.name));
	const vorher = aktiv.filter((g) => vergleiche(g.name, notiz.name) < 0).pop();
	const nachher = aktiv.find((g) => vergleiche(g.name, notiz.name) > 0);

	// Im Kopf steht der Lehrauftrag schon; in den Nachbarlinks wäre er nur Wiederholung.
	const kurz = (g: KopfNotiz): Verweis => {
		const praefix = lehrauftrag ? `${lehrauftrag.text} ` : "";
		const text = praefix && g.name.startsWith(praefix) ? g.name.slice(praefix.length) : g.name;
		return { ziel: g.pfad.replace(/\.md$/, ""), text };
	};

	const datum = fm["Datum"];
	return {
		lehrauftrag,
		datum: typeof datum === "string" && /^\d{4}-\d{2}-\d{2}$/.test(datum) ? datumDeutsch(datum) : null,
		einheit: verweis(fm["UEinheit"]),
		vorher: vorher ? kurz(vorher) : null,
		nachher: nachher ? kurz(nachher) : null,
	};
}

function vergleiche(a: string, b: string): number {
	return a.localeCompare(b, "de", { numeric: true });
}

/** `[[Ziel|Alias]]` → Link; anderer Text bleibt Text; leer → nichts. */
export function verweis(wert: unknown): Verweis | null {
	if (typeof wert !== "string" || !wert.trim()) return null;
	const link = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/.exec(wert.trim());
	if (!link) return { ziel: null, text: wert.trim() };
	const ziel = (link[1] as string).trim();
	return { ziel, text: link[2]?.trim() || (ziel.split("/").pop() as string) };
}
