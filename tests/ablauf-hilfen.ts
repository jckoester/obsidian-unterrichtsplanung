/**
 * Wie `## Ablauf` in einer frisch angelegten Stundennotiz steht (seit NOTIZFORMAT 7): die
 * Zeitleiste, darunter der leere Listenpunkt. Tests, die eine Vault-Änderung am Ablauf
 * nachstellen, ersetzen diesen Text — ein `replace` auf eine veraltete Form ersetzte still
 * nichts, und der Test prüfte dann eine unveränderte Notiz.
 */
export const LEERER_ABLAUF = "## Ablauf\n```uplan-zeit\n```\n\n1.";

/** `## Ablauf` mit Zeitleiste und den gegebenen Zeilen darunter. */
export function ablaufMit(zeilen: string): string {
	return `## Ablauf\n\`\`\`uplan-zeit\n\`\`\`\n\n${zeilen}`;
}
