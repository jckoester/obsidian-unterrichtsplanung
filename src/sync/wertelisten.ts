import type { ContextNodeRead } from "../api/types";

/**
 * Die Werte, die die Plattform für Sozialform und Methode anbietet (Plan-Ablauf-Editor, B4).
 *
 * Es sind keine festen Listen im Code der Plattform, sondern Wissensknoten mit
 * `content_type` `sozialform` bzw. `methode` — die Schule legt einen Grundbestand an,
 * Lehrkräfte ergänzen eigene. Der Sync lädt sie und merkt sie sich, damit der Phasen-Editor
 * auch offline Vorschläge hat.
 */

export interface Eintrag {
	id: string;
	titel: string;
	/** Andere Namen derselben Sache, z. B. `Ich-Du-Wir` für Think-Pair-Share. */
	aliase: string[];
	/** `null` heißt: für alle Fächer. */
	subject_id: number | null;
}

export interface Wertelisten {
	sozialform: Eintrag[];
	methode: Eintrag[];
}

export const WERTELISTEN_TYPEN = ["sozialform", "methode"] as const;

export function eintraegeAus(knoten: ContextNodeRead[]): Eintrag[] {
	return knoten
		.map((k) => ({
			id: k.id,
			titel: k.title.trim(),
			aliase: (k.aliase ?? []).map((a) => a.trim()).filter(Boolean),
			subject_id: k.subject_id ?? null,
		}))
		.filter((e) => e.titel !== "")
		.sort((a, b) => a.titel.localeCompare(b.titel, "de"));
}

/**
 * Der Eintrag, den ein Text meint — erst nach Titel, dann nach Alias, beides ohne Rücksicht
 * auf Groß- und Kleinschreibung. Gesucht wird nur in der einen Liste: „Unterrichtsgespräch"
 * ist ein Alias von Plenum, einer Sozialform, und als Methode deshalb Freitext.
 */
export function findeEintrag(liste: Eintrag[], text: string): Eintrag | undefined {
	const gesucht = text.trim().toLowerCase();
	if (!gesucht) return undefined;
	return (
		liste.find((e) => e.titel.toLowerCase() === gesucht) ??
		liste.find((e) => e.aliase.some((a) => a.toLowerCase() === gesucht))
	);
}
