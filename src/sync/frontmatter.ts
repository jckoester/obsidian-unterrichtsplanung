/**
 * Frontmatter — lesen tolerant, schreiben streng.
 *
 * Gelesen werden nur Skalare (das reicht für die `ggd_*`-Felder); geschrieben wird
 * ein vollständiger, von uns erzeugter Block. Ein YAML-Parser ist dafür nicht nötig
 * und wäre im Bundle teurer als der Nutzen.
 */

export const FRONTMATTER_GRENZE = "---";

/** Alles unterhalb dieser Überschrift gehört dem Vault. Der Sync fasst es nie an. */
export const MARKER_UEBERSCHRIFT = "## Eigene Notizen";

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
 * Erhält den Vault-eigenen Teil: alles ab der Marker-Überschrift.
 * Gibt es sie nicht, ist der Vault-Teil leer.
 */
export function extractOwnSection(body: string): string {
	const index = body.indexOf(MARKER_UEBERSCHRIFT);
	if (index === -1) return "";
	return body.slice(index);
}
