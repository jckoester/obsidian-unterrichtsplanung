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

/**
 * Die Grenzen `---` zählen nur am Zeilenanfang — so liest auch Obsidian. Ein eingerücktes
 * `---` gehört zu einem Wert: Ein mehrzeiliges Stundenziel mit Trennlinie darf das
 * Frontmatter nicht vorzeitig beenden.
 */
export function splitNote(content: string): NoteParts {
	const lines = content.split("\n");
	if (lines[0]?.trimEnd() !== FRONTMATTER_GRENZE) {
		return { frontmatter: "", body: content };
	}
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trimEnd() === FRONTMATTER_GRENZE) {
			return {
				frontmatter: lines.slice(1, i).join("\n"),
				body: lines.slice(i + 1).join("\n").replace(/^\n/, ""),
			};
		}
	}
	return { frontmatter: "", body: content };
}

/** Skalare Top-Level-Schlüssel mit Wert. Listen und leere Felder fehlen. */
export function readScalars(frontmatter: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(readFelder(frontmatter))) {
		if (typeof value === "string" && value !== "") out[key] = value;
	}
	return out;
}

const SCHLUESSEL = /^([\p{L}_][\p{L}\p{N}_]*):\s*(.*)$/u;

/**
 * Alle Top-Level-Felder in der Form, die das Plugin selbst schreibt: Skalare (auch in
 * Anführungszeichen, mit Escapes), Blockskalare (`|-`) und einfache Listen (`  - x`).
 * Leere Felder ergeben `""`. Kein YAML-Parser — der wäre im Bundle teurer als der Nutzen,
 * und gelesen wird nur, was das Plugin auch schreibt.
 *
 * Wichtig ist das für den Rückkanal: Das Stundenziel muss sich so lesen lassen, wie es
 * geschrieben wurde, sonst sähe ein escaptes `"` jedes Mal wie eine Änderung aus.
 */
export function readFelder(frontmatter: string): Record<string, string | string[]> {
	const out: Record<string, string | string[]> = {};
	const zeilen = frontmatter.split("\n");
	for (let i = 0; i < zeilen.length; i++) {
		const match = SCHLUESSEL.exec(zeilen[i] as string);
		if (!match) continue;
		const key = match[1] as string;
		const value = (match[2] ?? "").trim();
		const folgende: string[] = [];
		while (i + 1 < zeilen.length && !SCHLUESSEL.test(zeilen[i + 1] as string)) folgende.push(zeilen[++i] as string);

		if (/^[|>][-+]?$/.test(value)) {
			const block = folgende.map((z) => z.replace(/^ {2}/, ""));
			while (block.length > 0 && block[block.length - 1] === "") block.pop();
			out[key] = value.startsWith(">") ? block.join(" ") : block.join("\n");
		} else if (value === "" && folgende.some((z) => /^\s*- /.test(z))) {
			out[key] = folgende.filter((z) => /^\s*- /.test(z)).map((z) => unquote(z.replace(/^\s*- /, "").trim()));
		} else {
			out[key] = unquote(value);
		}
	}
	return out;
}

function unquote(value: string): string {
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
		return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
	}
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
		return value.slice(1, -1).replace(/''/g, "'");
	}
	return value;
}

export type FrontmatterValue = string | number | boolean | null | string[];

/** Die Zeilen eines Feldes — eine Stelle für das Format, damit `setzeFelder` gleich schreibt. */
function renderFeld(key: string, value: FrontmatterValue | undefined): string[] {
	if (value === null || value === undefined) return [`${key}:`];
	if (Array.isArray(value)) return [`${key}:`, ...value.map((item) => `  - ${quoteIfNeeded(item)}`)];
	if (typeof value === "string" && value.includes("\n")) {
		// Mehrzeilig als Blockskalar. In Anführungszeichen faltete YAML die Umbrüche zu
		// Leerzeichen, und eine nicht eingerückte Folgezeile zerbräche das Frontmatter.
		return [`${key}: |-`, ...value.split("\n").map((zeile) => (zeile ? `  ${zeile}` : ""))];
	}
	if (typeof value === "string") return [`${key}: ${quoteIfNeeded(value)}`];
	return [`${key}: ${value}`];
}

export function renderFrontmatter(fields: Record<string, FrontmatterValue>): string {
	const lines: string[] = [FRONTMATTER_GRENZE];
	for (const [key, value] of Object.entries(fields)) lines.push(...renderFeld(key, value));
	lines.push(FRONTMATTER_GRENZE);
	return lines.join("\n");
}

/**
 * Setzt einzelne einzeilige Felder und lässt alles andere Zeichen für Zeichen stehen —
 * auch das, was jemand im Vault geändert hat. Fehlt ein Feld, kommt es ans Ende.
 */
export function setzeFelder(inhalt: string, werte: Record<string, string | number | null>): string {
	const { frontmatter, body } = splitNote(inhalt);
	const zeilen = frontmatter.split("\n");
	for (const [key, value] of Object.entries(werte)) {
		const [zeile] = renderFeld(key, value);
		const index = zeilen.findIndex((z) => z.startsWith(`${key}:`));
		if (index === -1) zeilen.push(zeile as string);
		else zeilen[index] = zeile as string;
	}
	return `${FRONTMATTER_GRENZE}\n${zeilen.join("\n")}\n${FRONTMATTER_GRENZE}\n${body}`;
}

function quoteIfNeeded(value: string): string {
	// Wikilinks und alles mit YAML-Sonderzeichen in Anführungszeichen — sonst
	// verschluckt Obsidian den Wert stillschweigend.
	if (/^[\p{L}\p{N} .,\-–/()°äöüÄÖÜß✅🟢🟡🔵🟣🔴⚫️🗄️]+$/u.test(value)) return value;
	// Der Backslash zuerst: In doppelten Anführungszeichen ist er YAMLs Escape-Zeichen, und
	// ein `\b` im Text käme sonst als Steuerzeichen an.
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
