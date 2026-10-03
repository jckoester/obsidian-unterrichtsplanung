/**
 * Frontmatter — lesen tolerant, schreiben streng.
 *
 * Gelesen werden nur Skalare (das reicht für die `uplan_*`-Felder); geschrieben wird
 * ein vollständiger, von uns erzeugter Block. Ein YAML-Parser ist dafür nicht nötig
 * und wäre im Bundle teurer als der Nutzen.
 */

export const FRONTMATTER_GRENZE = "---";

/**
 * Die Grenze in einer Stundennotiz: Davor schreibt (und hasht) der Sync, dahinter gehört
 * alles dem Vault und wird nie angefasst.
 *
 * Eine Grenze für beides, nicht zwei. Hinge der Hash an der ganzen Datei und der Erhalt an
 * einer Überschrift, meldete eine Zeile im eigenen Abschnitt „vault-geändert" — und mit der
 * nächsten Serveränderung entstand ein Konfliktblock ohne Konflikt.
 *
 * Ein Kommentar statt einer Überschrift: Er taucht in keiner Gliederung auf, und niemand
 * benennt ihn beim Aufräumen um.
 */
export const REGION_ENDE = "<!-- uplan:ende -->";

/** Die Markerzeile — nur als ganze Zeile, damit ein Zitat im Fließtext nicht zählt. */
const REGION_ENDE_ZEILE = /^<!-- uplan:ende -->[ \t]*$/m;

/** Überschrift, mit der der Vault-Teil einer neuen Stundennotiz beginnt. */
export const VAULT_UEBERSCHRIFT = "## Notizen";

/**
 * Die Grenze im Altbestand ohne `REGION_ENDE`. Nur noch gelesen, nie mehr geschrieben —
 * eine Stundennotiz, die der Sync neu schreibt, bekommt den Marker.
 */
export const ALTE_VAULT_UEBERSCHRIFT = "## Eigene Notizen";

export interface NoteParts {
	frontmatter: string; // roher Block ohne die --- Zeilen
	body: string;
}

export function splitNote(content: string): NoteParts {
	const lines = content.split("\n");
	if (lines[0]?.trim() !== FRONTMATTER_GRENZE) {
		return { frontmatter: "", body: content };
	}
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === FRONTMATTER_GRENZE) {
			return {
				frontmatter: lines.slice(1, i).join("\n"),
				body: lines.slice(i + 1).join("\n").replace(/^\n/, ""),
			};
		}
	}
	return { frontmatter: "", body: content };
}

/** Skalare Top-Level-Schlüssel. Listen und verschachtelte Blöcke werden übersprungen. */
export function readScalars(frontmatter: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of frontmatter.split("\n")) {
		const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
		if (!match) continue;
		const value = (match[2] ?? "").trim();
		if (value === "") continue;
		out[match[1] as string] = stripQuotes(value);
	}
	return out;
}

function stripQuotes(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

export type FrontmatterValue = string | number | boolean | null | string[];

export function renderFrontmatter(fields: Record<string, FrontmatterValue>): string {
	const lines: string[] = [FRONTMATTER_GRENZE];
	for (const [key, value] of Object.entries(fields)) {
		if (value === null || value === undefined) {
			lines.push(`${key}:`);
		} else if (Array.isArray(value)) {
			lines.push(`${key}:`);
			for (const item of value) lines.push(`  - ${quoteIfNeeded(item)}`);
		} else if (typeof value === "string") {
			lines.push(`${key}: ${quoteIfNeeded(value)}`);
		} else {
			lines.push(`${key}: ${value}`);
		}
	}
	lines.push(FRONTMATTER_GRENZE);
	return lines.join("\n");
}

function quoteIfNeeded(value: string): string {
	// Wikilinks und alles mit YAML-Sonderzeichen in Anführungszeichen — sonst
	// verschluckt Obsidian den Wert stillschweigend.
	if (/^[\p{L}\p{N} .,\-–/()°äöüÄÖÜß✅🟢🟡🔵🟣🔴⚫️🗄️]+$/u.test(value)) return value;
	return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Erhält den Vault-eigenen Teil: alles hinter `REGION_ENDE`.
 *
 * Altbestand ohne Marker: alles ab `## Eigene Notizen`. Gibt es auch das nicht, ist der
 * Vault-Teil leer.
 */
export function extractOwnSection(body: string): string {
	const treffer = REGION_ENDE_ZEILE.exec(body);
	if (treffer) return body.slice(treffer.index + treffer[0].length).replace(/^\n+/, "");
	const index = body.indexOf(ALTE_VAULT_UEBERSCHRIFT);
	if (index === -1) return "";
	return body.slice(index);
}

/**
 * Der Teil der Notiz, den der Sync verantwortet: Frontmatter und Rumpf bis vor
 * `REGION_ENDE`. Fehlt der Marker, ist es die ganze Datei — so verhält sich Altbestand wie
 * vor der Umstellung, bis der Sync ihn einmal neu geschrieben hat.
 */
export function plattformRegion(inhalt: string): string {
	const treffer = REGION_ENDE_ZEILE.exec(inhalt);
	return treffer ? inhalt.slice(0, treffer.index) : inhalt;
}

/**
 * Tauscht den Frontmatter-Block aus und lässt den Rumpf Zeichen für Zeichen stehen.
 *
 * Für UE-Notizen ist das die ganze Aktualisierung: Das Plugin legt sie einmal an und
 * pflegt danach nur noch die Felder. Alles darunter — Überlegungen, Material, eigene
 * Überschriften — gehört dem Vault, auch wenn es nicht unter einer Marker-Überschrift
 * steht.
 */
export function ersetzeFrontmatter(
	inhalt: string,
	felder: Record<string, FrontmatterValue>,
): string {
	const { body } = splitNote(inhalt);
	return `${renderFrontmatter(felder)}\n${body}`;
}
