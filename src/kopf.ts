import { datumDeutsch } from "./sync/notizen";
import { kategorieZuUArt } from "./sync/status";

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

/** Ein Knopf im Kopf, der die Stunde auf der Plattform öffnet. */
export interface PlattformLink {
	art: "entwurf" | "assistent" | "planer";
	url: string;
	titel: string;
}

/** Was die Links von der eingerichteten Gruppe brauchen (`GruppenEinstellung`, P2). */
export interface KopfGruppe {
	groupId: number;
	fachId: number | null;
	fachSlug: string | null;
}

/**
 * Die Wege von der Stundennotiz zur Plattform (Plan-Plattform-0.16, P3). Die Adressen baut die
 * Plattform selbst genauso — `titelAktion` in `lib/mein_tag.js`, `neuerChatPfad` in
 * `lib/chatziel.js`. Welcher Assistent antwortet, wählt dort die Chatseite: Mit `stunde_id`
 * sucht sie einen mit der Fähigkeit `lesson_planning` (`einstiegsFaehigkeit`).
 *
 * - Mit Entwurf: die Entwurfsansicht und der Stundenassistent mit Bezug auf diese Stunde.
 * - Ein Platzhalter nur die Jahresplanung. Die Startseite der Plattform legt an dieser Stelle
 *   erst einen Entwurf an; ein Klick im Vault soll nicht schreiben, ohne dass es im
 *   Ergebnisfenster des Syncs steht.
 * - Kein Assistent für einen Entfall („eine Stunde zu planen, die nicht stattfindet, ist kein
 *   Anliegen", `zeigtAssistent`) und gar nichts für eine archivierte Notiz — sie hat auf der
 *   Plattform keinen Termin mehr.
 */
export function plattformLinks(
	frontmatter: Record<string, unknown>,
	basisUrl: string,
	gruppen: KopfGruppe[],
): PlattformLink[] {
	// Die Basis-URL der API endet auf `/api`; davor liegt die Oberfläche.
	const basis = basisUrl.trim().replace(/\/+$/, "").replace(/\/api$/, "");
	const gruppe = gruppen.find((g) => g.groupId === frontmatter["uplan_group_id"]);
	if (!basis || !gruppe || frontmatter["uplan_status"] === "archiviert") return [];

	const planer = gruppe.fachSlug ? `${basis}/subjects/${gruppe.fachSlug}/groups/${gruppe.groupId}/planner` : null;
	const knoten = frontmatter["uplan_node_id"];
	if (typeof knoten !== "string" || !knoten) {
		return planer ? [{ art: "planer", url: planer, titel: "In der Jahresplanung öffnen" }] : [];
	}

	const links: PlattformLink[] = [];
	if (planer) links.push({ art: "entwurf", url: `${planer}/lessons/${knoten}`, titel: "Entwurf auf der Plattform öffnen" });
	if (frontmatter["UArt"] !== kategorieZuUArt("ausfall")) {
		const chat = new URLSearchParams();
		if (gruppe.fachId !== null) chat.set("subject_id", String(gruppe.fachId));
		chat.set("group_id", String(gruppe.groupId));
		chat.set("stunde_id", knoten);
		links.push({ art: "assistent", url: `${basis}/chat?${chat.toString()}`, titel: "Mit dem Stundenassistenten planen" });
	}
	return links;
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
