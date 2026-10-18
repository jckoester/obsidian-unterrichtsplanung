/**
 * Kompetenzen und Fachbegriffe der Stunde — die `refs` des Stundenknotens, read-only im
 * Frontmatter (Plan-Plattform-0.16, P4). Rein: kein Vault, kein Netz.
 *
 * Als Text, nicht als Verweis: Nicht jede Nutzer:in hat die Fachbegriffe als Notizen im
 * Vault, und eine Verlinkung zöge eine Synchronisation der Begriffe nach sich (Jan,
 * 16.10.2026). Als Text sind sie in Bases filterbar und für die Suche sichtbar. Zurück geht
 * nichts: Die Plattform prüft Kompetenzen gegen den Bildungsplan und Begriffe gegen den
 * Wissensspeicher — aus einem Vault-Text käme kein gültiger Verweis.
 */

export interface Bezuege {
	kompetenzen: string[];
	fachbegriffe: string[];
}

function istObjekt(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}

function text(x: unknown): string {
	return typeof x === "string" ? x.trim() : "";
}

/**
 * `ik` und `pk` sind Kompetenzen, `concept` sind Begriffe — seit 0.17 nur noch Fachbegriffe
 * und Stoffsteckbriefe (`BEGRIFF_TYPEN` in `planning/schemas.py`). Was keinen Titel und keine
 * Nummer hat, fällt weg; ein Begriff steht nur einmal da.
 */
export function bezuegeAus(refs: unknown): Bezuege {
	const kompetenzen: string[] = [];
	const fachbegriffe: string[] = [];
	for (const ref of Array.isArray(refs) ? refs.filter(istObjekt) : []) {
		const typ = text(ref["typ"]);
		if (typ === "ik" || typ === "pk") {
			const eintrag = kompetenzText(text(ref["code"]), text(ref["titel"]), ref["partiell"] === true);
			if (eintrag) kompetenzen.push(eintrag);
		} else if (typ === "concept") {
			const titel = text(ref["titel"]);
			if (titel && !fachbegriffe.includes(titel)) fachbegriffe.push(titel);
		}
	}
	return { kompetenzen, fachbegriffe };
}

/** Die Markierung einer nur teilweise geförderten Kompetenz, wie im Markdown-Export der Plattform. */
const PARTIELL = "[…]";

/** Die Nummer vorn im Titel einer Kompetenz: `3.2.2.1(9) …`, `2.2.5 …`. */
const NUMMER_IM_TITEL = /^(\d+(?:\.\d+)*\s?(?:\(\d+\))?)\s+(.+)$/s;

/**
 * `3.2.2.1(9)[…]: Wortlaut` — Nummer vorn, damit sie im Kopf als Kurzform taugt und in einer
 * Base filterbar ist; der Wortlaut dahinter für den Tooltip.
 *
 * Die Titel der Kompetenzen beginnen schon mit ihrer Nummer (auf Dev alle 224, 17.10.2026);
 * `code` ist dieselbe Nummer noch einmal (`kompetenz_nr`). Sie steht deshalb nur einmal da.
 * Der Planer speichert `code` teils als `null`; dann kommt die Nummer aus dem Titel.
 */
function kompetenzText(code: string, titel: string, partiell: boolean): string {
	const marke = partiell ? PARTIELL : "";
	const imTitel = NUMMER_IM_TITEL.exec(titel);
	const nummer = code || (imTitel?.[1] ?? "");
	const wortlaut = imTitel && (!code || imTitel[1] === code) ? (imTitel[2] as string) : titel;
	if (!nummer) return wortlaut ? `${wortlaut}${marke}` : "";
	return wortlaut ? `${nummer}${marke}: ${wortlaut}` : `${nummer}${marke}`;
}

/**
 * Für die Anzeige: Kurzform und ganzer Text. Kurzform ist die Nummer, wenn es eine gibt — ein
 * Präfix vor `: ` mit einer Ziffer darin. Ein Titel wie „Energie: Formen" bleibt so ganz.
 */
export function kompetenzAnzeige(eintrag: string): { kurz: string; lang: string } {
	const treffer = /^([^:]{1,24}?\d[^:]{0,24}?): (.+)$/s.exec(eintrag);
	return { kurz: treffer ? (treffer[1] as string) : eintrag, lang: eintrag };
}
