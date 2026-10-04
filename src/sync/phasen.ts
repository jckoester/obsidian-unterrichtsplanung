import type { LessonLinkedItem, LessonPhaseItem } from "../api/types";
import { stableStringify } from "./hash";
import { findeEintrag, type Eintrag, type Wertelisten } from "./wertelisten";

/**
 * Die Phasenliste einer Stunde — gelesen aus `## Ablauf`, geschrieben dorthin und gemischt
 * mit dem Stand der Plattform (Notizformat-Plan, Entscheidung 4). Rein: kein Vault, kein
 * Netz, keine Uhr.
 *
 * Zwei Darstellungen, ein Parser. Gerendert wird nach einer Regel ohne Gedächtnis: Trägt
 * eine Phase mehr als Name und Dauer, wird eine Tabelle geschrieben, sonst eine Liste.
 */

export const ABLAUF_UEBERSCHRIFT = "## Ablauf";

/**
 * Sprache des Codeblocks über dem Ablauf; das Plugin zeichnet daraus die Zeitleiste
 * (Plan-Ablauf-Editor, B3). Beim Lesen wird er übergangen.
 */
export const ZEITLEISTE = "uplan-zeit";

/**
 * Inhalt der Knopfspalte rechts in der Tabelle — das Plugin macht daraus den Knopf, der den
 * Phasen-Editor öffnet. Ein Inline-Code, weil Obsidian ihn in der Live-Vorschau dem Plugin
 * zeigt; einen Knopf irgendwo sonst in der Zeile ließe das Tabellen-Widget nur über seinen
 * internen Aufbau zu. Die Spalte hat keine Überschrift und wird beim Lesen übergangen.
 */
export const PHASENKNOPF = "`✎`";

/** Freitext oder Verweis auf einen Baustein. */
export type Verweis = LessonLinkedItem;

/** Die Schemafelder einer Phase — genau das, was zurückgeschickt wird. */
export type PhaseNutzlast = LessonPhaseItem;

/**
 * Eine Phase, wie die Plattform sie hält. `status` wird nur gelesen — eine gestrichene
 * Phase erscheint durchgestrichen. Zurückgeschickt wird er nie: Den übernimmt die
 * Plattform selbst aus dem gespeicherten Stand (0.13, P2).
 */
export interface Phase extends PhaseNutzlast {
	status: string | null;
}

/**
 * Was eine Darstellung im Vault über eine Phase aussagt. Fehlt ein Feld, sagt sie nichts
 * darüber — eine Tabelle ohne Prio-Spalte lässt die Prio stehen, eine Liste das Material.
 */
export interface VaultPhase {
	name: string;
	dauer_min?: number | null;
	beschreibung?: string | null;
	prio?: string;
	sozialform?: string | null;
	methode?: string | null;
	material?: string[];
}

/**
 * Wo eine Phase im Text steht: die Zeilen `start` bis `ende` (ausschließlich), gezählt in dem
 * Text, den `leseAblauf` bekam. Gebraucht vom Phasen-Editor, der nur seine eine Phase ersetzt.
 */
export interface Stelle {
	start: number;
	ende: number;
	/** Der Name stand durchgestrichen da (`~~…~~`) — die Phase ist auf der Plattform gestrichen. */
	gestrichen: boolean;
}

export interface Ablauf {
	phasen: VaultPhase[];
	/** Was die Plattform ablehnen würde. Steht hier etwas, wird die Stunde nicht geschrieben. */
	fehler: string[];
	/**
	 * Je Phase ihre Zeilen, parallel zu `phasen`. Bewusst nicht an den Phasen selbst: Die gehen
	 * in den Strukturhash, und ein neues Feld dort machte jede bestehende Notiz „geändert".
	 */
	stellen: Stelle[];
	/** Bei einer Tabelle die Zeile ihrer Kopfzeile. */
	kopf?: number;
}

const PRIO_LABEL: Record<string, string> = { kern: "Kern", uebung: "Übung", vertiefung: "Vertiefung" };
const PRIO_AUS_LABEL: Record<string, string> = {
	kern: "kern",
	übung: "uebung",
	uebung: "uebung",
	vertiefung: "vertiefung",
};

/** Grenzen aus `LessonPhaseItem` — was darüber liegt, lehnt die Plattform mit 422 ab. */
const NAME_MAX = 200;
const DAUER_MIN = 1;
const DAUER_MAX = 480;

// ── Plattformstand lesen ─────────────────────────────────────────────────────

function istObjekt(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}

function text(x: unknown): string | null {
	return typeof x === "string" ? x : null;
}

/** Ein Verweis immer mit allen vier Schlüsseln — sonst wäre `{wert}` ungleich `{wert, node_id: null}`. */
function verweis(x: unknown): Verweis | null {
	if (!istObjekt(x)) return null;
	return {
		typ: text(x["typ"]) ?? "text",
		wert: text(x["wert"]),
		node_id: text(x["node_id"]),
		titel: text(x["titel"]),
	};
}

/**
 * Die Phasen aus den Metadaten eines Stundenknotens. `null` und ein fehlender Schlüssel
 * heißen dasselbe — so speichert die Plattform eine Phase ohne Dauer (0.13, P1).
 */
export function normalisierePhasen(roh: unknown): Phase[] {
	if (!Array.isArray(roh)) return [];
	return roh.filter(istObjekt).map((p) => ({
		id: text(p["id"]) || null,
		name: text(p["name"]) ?? "",
		dauer_min: typeof p["dauer_min"] === "number" ? p["dauer_min"] : null,
		beschreibung: text(p["beschreibung"]),
		prio: text(p["prio"]) || "kern",
		sozialform: verweis(p["sozialform"]),
		methode: verweis(p["methode"]),
		material: Array.isArray(p["material"])
			? p["material"].map(verweis).filter((v): v is Verweis => v !== null)
			: [],
		status: text(p["status"]),
	}));
}

/** Was von einem Verweis im Vault steht: der Titel eines Bausteins, sonst der Freitext. */
export function anzeige(v: Verweis | null): string {
	return (v?.titel ?? v?.wert ?? "").trim();
}

export function nutzlast(p: Phase): PhaseNutzlast {
	return {
		id: p.id,
		name: p.name,
		dauer_min: p.dauer_min,
		beschreibung: p.beschreibung,
		prio: p.prio,
		sozialform: p.sozialform,
		methode: p.methode,
		material: p.material,
	};
}

// ── Rendern ──────────────────────────────────────────────────────────────────

/** Die Umschaltregel: Trägt irgendeine Phase mehr als Name und Dauer, wird es eine Tabelle. */
export function brauchtTabelle(phasen: Phase[]): boolean {
	return phasen.some(
		(p) =>
			(p.beschreibung ?? "").trim() !== "" ||
			anzeige(p.sozialform) !== "" ||
			anzeige(p.methode) !== "" ||
			p.material.some((m) => anzeige(m) !== "") ||
			p.prio !== "kern",
	);
}

function phasenName(p: Phase): string {
	return p.status === "gestrichen" ? `~~${p.name}~~` : p.name;
}

function zelle(wert: string): string {
	return wert.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

/** Die Zeilen unter `## Ablauf`. Ohne Phasen ein leerer Listenpunkt — der Platz für die Skizze. */
export function rendereAblauf(phasen: Phase[]): string[] {
	if (phasen.length === 0) return ["1."];
	if (!brauchtTabelle(phasen)) {
		return phasen.map(
			(p, i) => `${i + 1}. ${phasenName(p)}${p.dauer_min !== null ? ` (${p.dauer_min} min)` : ""}`,
		);
	}
	const zeilen = [
		"| Prio | Min | Phase | Inhalt | Sozialform | Methode | Material |  |",
		"| --- | --- | --- | --- | --- | --- | --- | --- |",
	];
	for (const p of phasen) {
		const zellen = [
			PRIO_LABEL[p.prio] ?? p.prio,
			p.dauer_min !== null ? String(p.dauer_min) : "",
			phasenName(p),
			p.beschreibung ?? "",
			anzeige(p.sozialform),
			anzeige(p.methode),
			p.material.map(anzeige).filter(Boolean).join(", "),
		];
		zeilen.push(`| ${zellen.map(zelle).join(" | ")} | ${PHASENKNOPF} |`);
	}
	return zeilen;
}

// ── Lesen ────────────────────────────────────────────────────────────────────

/**
 * Der Abschnitt `## Ablauf` — bis zur nächsten Überschrift erster oder zweiter Ebene oder
 * zum Marker. `null`, wenn es ihn nicht gibt: Dann sagt die Notiz nichts über die Phasen.
 */
export function ablaufAbschnitt(text: string): { start: number; ende: number; zeilen: string[] } | null {
	const zeilen = text.split("\n");
	const start = zeilen.findIndex((z) => z.trim() === ABLAUF_UEBERSCHRIFT);
	if (start === -1) return null;
	let ende = start + 1;
	while (ende < zeilen.length && !/^#{1,2} /.test(zeilen[ende] as string) && !zeilen[ende]?.startsWith("<!-- uplan:ende")) {
		ende++;
	}
	return { start, ende, zeilen: zeilen.slice(start + 1, ende) };
}

/** Eine Zeile samt ihrer Nummer im gelesenen Text. */
interface Zeile {
	text: string;
	nr: number;
}

export function leseAblauf(text: string): Ablauf | null {
	const abschnitt = ablaufAbschnitt(text);
	if (!abschnitt) return null;
	const zeilen = ohneZeitleiste(abschnitt.zeilen).map((z, i) => ({ text: z, nr: abschnitt.start + 1 + i }));
	const inhalt = zeilen.filter((z) => z.text.trim() !== "");
	if (inhalt[0]?.text.trim().startsWith("|")) return leseTabelle(inhalt);
	return leseListe(zeilen);
}

/**
 * Der Zeitleisten-Block gehört zur Darstellung, nicht zum Ablauf. Stünde er noch in den
 * Zeilen, hielte die Erkennung eine Tabelle für eine Liste (die erste Zeile wäre der Zaun),
 * und unter einem Listenpunkt würden die Zaunzeilen zur Beschreibung.
 *
 * ⚠️ Fehlt der schließende Zaun, fällt nur die öffnende Zeile weg — nicht alles danach.
 * Sonst läse der Rückkanal einen leeren Ablauf, und eine fehlende Zeile ist eine gelöschte
 * Phase: Ein versehentlich gelöschtes ``` räumte die Stunde auf der Plattform leer.
 */
function ohneZeitleiste(zeilen: string[]): string[] {
	const block = zeitleistenBlock(zeilen);
	// Geleert statt herausgeschnitten: So behält jede Zeile ihre Nummer (`Stelle`).
	return block ? zeilen.map((z, i) => (i >= block.start && i < block.ende ? "" : z)) : zeilen;
}

/** Die Zeilen des Zeitleisten-Blocks, `ende` ausschließlich; ohne schließenden Zaun nur die öffnende. */
function zeitleistenBlock(zeilen: string[]): { start: number; ende: number } | null {
	const start = zeilen.findIndex((z) => z.trim() === "```" + ZEITLEISTE);
	if (start === -1) return null;
	const ende = zeilen.findIndex((z, i) => i > start && z.trim() === "```");
	return { start, ende: ende === -1 ? start + 1 : ende + 1 };
}

function istGestrichen(name: string): boolean {
	const t = name.trim();
	return t.startsWith("~~") && t.endsWith("~~") && t.length > 4;
}

function ohneStreichung(name: string): string {
	const t = name.trim();
	return istGestrichen(t) ? t.slice(2, -2).trim() : t;
}

/** `10`, `10'`, `10′`, `10 min` → 10; leer → `null`; alles andere → `undefined` (unlesbar). */
function leseDauer(wert: string): number | null | undefined {
	const t = wert.trim();
	if (t === "") return null;
	const treffer = /^(\d+)\s*(?:min\.?|minuten|′|')?$/i.exec(t);
	return treffer ? Number(treffer[1]) : undefined;
}

function pruefe(nr: number, p: VaultPhase, fehler: string[]): void {
	if (p.name.length > NAME_MAX) fehler.push(`Phase ${nr}: Name länger als ${NAME_MAX} Zeichen`);
	if (typeof p.dauer_min === "number" && (p.dauer_min < DAUER_MIN || p.dauer_min > DAUER_MAX)) {
		fehler.push(`Phase ${nr}: Dauer ${p.dauer_min} liegt nicht zwischen ${DAUER_MIN} und ${DAUER_MAX}`);
	}
}

type Spalte = "prio" | "dauer" | "name" | "beschreibung" | "sozialform" | "methode" | "material";

/**
 * Über die Kopfzeile, nicht über die Position — die handgeschriebenen Tabellen seit
 * Schuljahresbeginn haben `Zeit | Phase | Inhalt | Methode | Medien`. `Zeit` ist dort die
 * Dauer, nicht die Uhr.
 */
const SPALTEN: Record<string, Spalte> = {
	prio: "prio",
	min: "dauer",
	minuten: "dauer",
	dauer: "dauer",
	zeit: "dauer",
	phase: "name",
	name: "name",
	inhalt: "beschreibung",
	beschreibung: "beschreibung",
	sozialform: "sozialform",
	methode: "methode",
	material: "material",
	medien: "material",
};

function zellenVon(zeile: string): string[] {
	let s = zeile.trim();
	if (s.startsWith("|")) s = s.slice(1);
	if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
	const teile: string[] = [];
	let aktuell = "";
	for (let i = 0; i < s.length; i++) {
		if (s[i] === "\\" && s[i + 1] === "|") {
			aktuell += "|";
			i++;
		} else if (s[i] === "|") {
			teile.push(aktuell.trim());
			aktuell = "";
		} else {
			aktuell += s[i];
		}
	}
	teile.push(aktuell.trim());
	return teile;
}

function spaltenVon(kopfzeile: string): (Spalte | null)[] {
	return zellenVon(kopfzeile).map((k) => SPALTEN[k.toLowerCase().replace(/[^a-zäöüß]/g, "")] ?? null);
}

function leseTabelle(zeilen: Zeile[]): Ablauf {
	const fehler: string[] = [];
	const kopfzeile = zeilen[0] as Zeile;
	const kopf = spaltenVon(kopfzeile.text);
	if (!kopf.includes("name")) {
		return { phasen: [], fehler: ["Tabelle unter „## Ablauf“ hat keine Spalte „Phase“"], stellen: [], kopf: kopfzeile.nr };
	}

	const phasen: VaultPhase[] = [];
	const stellen: Stelle[] = [];
	let vorige = "";
	for (const { text: zeile, nr } of zeilen.slice(1)) {
		const zellen = zellenVon(zeile);
		if (zellen.every((z) => /^:?-+:?$/.test(z))) continue; // Trennzeile
		if (zellen.every((z) => z === "")) continue;

		const p: VaultPhase = { name: "" };
		kopf.forEach((spalte, i) => {
			const wert = zellen[i] ?? "";
			switch (spalte) {
				case "name":
					p.name = ohneStreichung(wert);
					break;
				case "dauer": {
					const dauer = leseDauer(wert);
					if (dauer === undefined) fehler.push(`Phase ${phasen.length + 1}: Dauer „${wert}“ nicht lesbar`);
					p.dauer_min = dauer ?? null;
					break;
				}
				case "prio": {
					const prio = wert === "" ? "kern" : PRIO_AUS_LABEL[wert.toLowerCase()];
					if (!prio) fehler.push(`Phase ${phasen.length + 1}: Prio „${wert}“ unbekannt`);
					p.prio = prio ?? "kern";
					break;
				}
				case "beschreibung":
					p.beschreibung = wert === "" ? null : wert.replace(/<br\s*\/?>/gi, "\n");
					break;
				case "sozialform":
				case "methode":
					p[spalte] = wert === "" ? null : wert;
					break;
				case "material":
					// Komma wie im Plattform-Editor, <br> wie in den handgeschriebenen Tabellen.
					p.material = wert.split(/\s*(?:,|<br\s*\/?>)\s*/i).filter(Boolean);
					break;
			}
		});
		// Leere Phase-Zelle: Fortsetzung der Phase darüber, wie im Bestand üblich.
		if (p.name === "") p.name = vorige;
		if (p.name === "") {
			fehler.push(`Phase ${phasen.length + 1}: ohne Namen`);
			continue;
		}
		vorige = p.name;
		pruefe(phasen.length + 1, p, fehler);
		phasen.push(p);
		const namenszelle = zellen[kopf.indexOf("name")] ?? "";
		stellen.push({ start: nr, ende: nr + 1, gestrichen: istGestrichen(namenszelle) });
	}
	return { phasen, fehler, stellen, kopf: kopfzeile.nr };
}

const PUNKT = /^\s{0,1}(?:\d+[.)]|[-*+])(?:\s+(.*))?$/;
const KLAMMER_AM_ENDE = /^(.*?)\s*\(([^()]*)\)\s*$/;
const BEGINNT_MIT_DAUER = /^\s*\d+\s*(?:min\.?|minuten|′|')/i;

/**
 * Die schnelle Skizze: `1. Sicherung (10 min · Plenum · Unterrichtsgespräch)`, darunter
 * eingerückt die Beschreibung. Eine Klammer am Ende zählt nur als Angaben, wenn sie mit
 * einer Dauer beginnt oder ein `·` enthält — „Erarbeitung (Aufg. 1+2)" bleibt ein Name.
 */
function leseListe(zeilen: Zeile[]): Ablauf {
	const fehler: string[] = [];
	const phasen: VaultPhase[] = [];
	const stellen: Stelle[] = [];
	let aktuell: { phase: VaultPhase; beschreibung: string[]; stelle: Stelle } | null = null;

	const abschliessen = () => {
		if (!aktuell) return;
		if (aktuell.beschreibung.length > 0) aktuell.phase.beschreibung = aktuell.beschreibung.join("\n");
		pruefe(phasen.length + 1, aktuell.phase, fehler);
		phasen.push(aktuell.phase);
		stellen.push(aktuell.stelle);
		aktuell = null;
	};

	for (const { text: zeile, nr } of zeilen) {
		const punkt = PUNKT.exec(zeile);
		if (punkt) {
			abschliessen();
			const inhalt = (punkt[1] ?? "").trim();
			if (inhalt === "") continue; // leerer Punkt: der Platzhalter, keine Phase
			const name = KLAMMER_AM_ENDE.exec(inhalt)?.[1] ?? inhalt;
			aktuell = {
				phase: leseListenpunkt(inhalt, phasen.length + 1, fehler),
				beschreibung: [],
				stelle: { start: nr, ende: nr + 1, gestrichen: istGestrichen(name) || istGestrichen(inhalt) },
			};
		} else if (aktuell && zeile.trim() !== "") {
			aktuell.beschreibung.push(zeile.trim());
			aktuell.stelle.ende = nr + 1;
		}
	}
	abschliessen();
	return { phasen, fehler, stellen };
}

function leseListenpunkt(inhalt: string, nr: number, fehler: string[]): VaultPhase {
	const klammer = KLAMMER_AM_ENDE.exec(inhalt);
	const innen = klammer?.[2] ?? "";
	if (!klammer || !(BEGINNT_MIT_DAUER.test(innen) || innen.includes("·"))) {
		return { name: ohneStreichung(inhalt), dauer_min: null };
	}
	const angaben = innen.split(/\s*[·,]\s*/).filter(Boolean);
	const phase: VaultPhase = { name: ohneStreichung(klammer[1] as string), dauer_min: null };
	if (angaben[0] !== undefined && BEGINNT_MIT_DAUER.test(angaben[0])) {
		const dauer = leseDauer(angaben.shift() as string);
		if (dauer === undefined) fehler.push(`Phase ${nr}: Dauer nicht lesbar`);
		phase.dauer_min = dauer ?? null;
	}
	if (angaben[0] !== undefined) phase.sozialform = angaben.shift() as string;
	if (angaben.length > 0) phase.methode = angaben.join(", ");
	return phase;
}

// ── Bearbeiten (Phasen-Editor) ───────────────────────────────────────────────

/** Die Felder einer Phase, wie Tabellenspalten und Editor sie nennen. */
export type AblaufFeld = Spalte;

const ALLE_FELDER: AblaufFeld[] = ["name", "dauer", "prio", "beschreibung", "sozialform", "methode", "material"];

export interface AblaufImText {
	ablauf: Ablauf;
	form: "tabelle" | "liste";
	/**
	 * Was der Editor anbieten darf. Eine Tabelle drückt nur aus, wofür sie eine Spalte hat —
	 * die handgeschriebenen haben `Zeit | Phase | Inhalt | Methode | Medien`, ohne Prio. Eine
	 * Liste alles: Braucht eine Phase mehr als Name und Dauer, wird sie zur Tabelle.
	 */
	felder: Set<AblaufFeld>;
}

/**
 * Der Ablauf einer Notiz, mit Zeilennummern im ganzen Text. Gesucht wird erst hinter dem
 * Frontmatter: Ein mehrzeiliges Stundenziel könnte eine eingerückte Zeile `## Ablauf`
 * enthalten.
 */
export function ablaufImText(text: string): AblaufImText | null {
	const zeilen = text.split("\n");
	const versatz = rumpfBeginn(zeilen);
	const ablauf = leseAblauf(zeilen.slice(versatz).join("\n"));
	if (!ablauf) return null;
	const verschoben: Ablauf = {
		...ablauf,
		stellen: ablauf.stellen.map((s) => ({ ...s, start: s.start + versatz, ende: s.ende + versatz })),
		kopf: ablauf.kopf === undefined ? undefined : ablauf.kopf + versatz,
	};
	if (verschoben.kopf === undefined) return { ablauf: verschoben, form: "liste", felder: new Set(ALLE_FELDER) };
	const spalten = spaltenVon(zeilen[verschoben.kopf] as string);
	const felder = new Set<AblaufFeld>(ALLE_FELDER.filter((f) => spalten.includes(f)));
	return { ablauf: verschoben, form: "tabelle", felder };
}

/** Die erste Zeile hinter dem Frontmatter — so, wie `splitNote` die Grenze zieht. */
function rumpfBeginn(zeilen: string[]): number {
	if (zeilen[0]?.trimEnd() !== "---") return 0;
	const ende = zeilen.findIndex((z, i) => i > 0 && z.trimEnd() === "---");
	return ende === -1 ? 0 : ende + 1;
}

/**
 * Welche Phase in Datenzeile `zeile` einer Tabelle steht (0 = erste Zeile unter der
 * Trennzeile) — so zählt der Knopf `✎` seine Zeile. `null` für eine leere Zeile, die keine
 * Phase ist.
 */
export function phaseInTabellenzeile(text: string, zeile: number): number | null {
	const imText = ablaufImText(text);
	if (!imText || imText.ablauf.kopf === undefined) return null;
	const nr = imText.ablauf.kopf + 2 + zeile;
	const nummer = imText.ablauf.stellen.findIndex((s) => s.start === nr);
	return nummer === -1 ? null : nummer;
}

export type Aenderung =
	| { art: "ersetzen"; nummer: number; vorher: VaultPhase; phase: VaultPhase }
	| { art: "anhaengen"; phase: VaultPhase }
	| { art: "loeschen"; nummer: number; vorher: VaultPhase };

/**
 * Wendet eine Änderung aus dem Phasen-Editor auf den Text der Notiz an.
 *
 * In einer Tabelle wird nur die eine Zeile ersetzt, gelöscht oder angehängt — die übrigen
 * behalten ihre Formatierung, unbekannte Spalten und die Knopfspalte ihren Inhalt, eine
 * gestrichene Phase ihre Tilden. Eine Liste wird neu geschrieben, nach derselben Regel wie
 * beim Sync (`rendereAblauf`): als Tabelle, sobald eine Phase mehr trägt als Name und Dauer.
 * Prio und Material, die eine Liste nicht zeigt, setzt das auf Kern und leer — genau das
 * hat die Plattform, solange der Sync eine Liste schreibt; hat sie sich inzwischen bewegt,
 * wird es beim nächsten Sync ein Konflikt, kein stilles Überschreiben.
 *
 * Wirft, wenn an der Stelle nicht mehr die Phase steht, die der Editor geöffnet hat — die
 * Notiz hat sich dazwischen geändert.
 */
export function bearbeiteAblauf(text: string, aenderung: Aenderung): string {
	const imText = ablaufImText(text);
	if (!imText) throw new Error("Die Notiz hat keinen Abschnitt „## Ablauf“.");
	const { ablauf } = imText;
	if (aenderung.art !== "anhaengen") {
		const jetzt = ablauf.phasen[aenderung.nummer];
		if (!jetzt || stableStringify(jetzt) !== stableStringify(aenderung.vorher)) {
			throw new Error("Der Ablauf hat sich inzwischen geändert — bitte die Phase neu öffnen.");
		}
	}
	const zeilen = text.split("\n");

	if (ablauf.kopf !== undefined) {
		const kopfTexte = zellenVon(zeilen[ablauf.kopf] as string);
		const spalten = spaltenVon(zeilen[ablauf.kopf] as string);
		if (aenderung.art === "loeschen") {
			zeilen.splice((ablauf.stellen[aenderung.nummer] as Stelle).start, 1);
		} else if (aenderung.art === "ersetzen") {
			const stelle = ablauf.stellen[aenderung.nummer] as Stelle;
			const alt = zellenVon(zeilen[stelle.start] as string);
			zeilen[stelle.start] = tabellenzeile(spalten, alt, aenderung.phase, stelle.gestrichen);
		} else {
			// Leere Zellen für eine neue Zeile — außer in der Knopfspalte (ohne Überschrift).
			const leer = kopfTexte.map((k) => (k === "" ? PHASENKNOPF : ""));
			let ende = ablauf.kopf;
			while (ende < zeilen.length && (zeilen[ende] as string).trim().startsWith("|")) ende++;
			zeilen.splice(ende, 0, tabellenzeile(spalten, leer, aenderung.phase, false));
		}
		return zeilen.join("\n");
	}

	// Liste oder leerer Platzhalter: neu schreiben.
	const phasen = ablauf.phasen.map((p, i) => alsPhase(p, (ablauf.stellen[i] as Stelle).gestrichen));
	if (aenderung.art === "loeschen") phasen.splice(aenderung.nummer, 1);
	else if (aenderung.art === "ersetzen") {
		phasen[aenderung.nummer] = alsPhase(aenderung.phase, (ablauf.stellen[aenderung.nummer] as Stelle).gestrichen);
	} else phasen.push(alsPhase(aenderung.phase, false));

	const bereich = ablaufInhalt(zeilen);
	zeilen.splice(bereich.start, bereich.ende - bereich.start, ...rendereAblauf(phasen));
	return zeilen.join("\n");
}

/** Eine Tabellenzeile nach der Kopfzeile; was die Phase nicht sagt, bleibt aus `alt`. */
function tabellenzeile(spalten: (Spalte | null)[], alt: string[], p: VaultPhase, gestrichen: boolean): string {
	const zellen = spalten.map((spalte, i) => {
		const bisher = alt[i] ?? "";
		switch (spalte) {
			case "name":
				return gestrichen ? `~~${p.name}~~` : p.name;
			case "dauer":
				return p.dauer_min === undefined ? bisher : p.dauer_min === null ? "" : String(p.dauer_min);
			case "prio":
				return p.prio === undefined ? bisher : (PRIO_LABEL[p.prio] ?? p.prio);
			case "beschreibung":
				return p.beschreibung === undefined ? bisher : (p.beschreibung ?? "");
			case "sozialform":
			case "methode":
				return p[spalte] === undefined ? bisher : (p[spalte] ?? "");
			case "material":
				return p.material === undefined ? bisher : p.material.join(", ");
			default:
				return bisher;
		}
	});
	return `| ${zellen.map(zelle).join(" | ")} |`;
}

/** Eine Vault-Phase so, wie `rendereAblauf` sie erwartet — Werte als Freitext. */
function alsPhase(v: VaultPhase, gestrichen: boolean): Phase {
	const text = (wert: string | null | undefined): Verweis | null =>
		wert && wert.trim() ? { typ: "text", wert: wert.trim(), node_id: null, titel: null } : null;
	return {
		id: null,
		name: v.name,
		dauer_min: v.dauer_min ?? null,
		beschreibung: v.beschreibung ?? null,
		prio: v.prio ?? "kern",
		sozialform: text(v.sozialform),
		methode: text(v.methode),
		material: (v.material ?? []).map(text).filter((m): m is Verweis => m !== null),
		status: gestrichen ? "gestrichen" : null,
	};
}

/**
 * Die Zeilen, die eine Liste (oder der leere Platzhalter) unter `## Ablauf` belegt — ohne
 * Zeitleiste und ohne die Leerzeilen davor und danach. Ohne Inhalt die Stelle direkt
 * dahinter, damit neu geschrieben wird, wo der Platzhalter stünde.
 */
function ablaufInhalt(zeilen: string[]): { start: number; ende: number } {
	const versatz = rumpfBeginn(zeilen);
	const abschnitt = ablaufAbschnitt(zeilen.slice(versatz).join("\n")) as NonNullable<ReturnType<typeof ablaufAbschnitt>>;
	const erste = versatz + abschnitt.start + 1;
	const block = zeitleistenBlock(abschnitt.zeilen);
	const ab = block ? erste + block.ende : erste;
	const bis = versatz + abschnitt.ende;
	let start = ab;
	while (start < bis && (zeilen[start] as string).trim() === "") start++;
	let ende = bis;
	while (ende > start && (zeilen[ende - 1] as string).trim() === "") ende--;
	return { start, ende };
}

// ── Mischen ──────────────────────────────────────────────────────────────────

function gleicherName(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Welche Vault-Zeile welche Plattform-Phase ist: erst gleicher Name, dann die Position unter
 * den übrigen. Was übrig bleibt, ist neu. Zugeordnet wird gegen den aktuellen Plattformstand —
 * zurückgeschrieben wird nur, wenn der sich seit dem letzten Lauf nicht geändert hat, er ist
 * also genau die Basis, aus der die Notiz gerendert wurde.
 */
export function ordnePhasenZu(server: Phase[], vault: VaultPhase[]): (Phase | undefined)[] {
	const frei = new Set(server.map((_, i) => i));
	const zuordnung: (number | undefined)[] = vault.map((v) => {
		const j = server.findIndex((s, i) => frei.has(i) && gleicherName(s.name, v.name));
		if (j === -1) return undefined;
		frei.delete(j);
		return j;
	});
	const uebrig = [...frei].sort((a, b) => a - b);
	let k = 0;
	for (let i = 0; i < zuordnung.length && k < uebrig.length; i++) {
		if (zuordnung[i] === undefined) zuordnung[i] = uebrig[k++];
	}
	return zuordnung.map((j) => (j === undefined ? undefined : server[j]));
}

/**
 * Freitext — es sei denn, er lautet wie ein bisheriger Eintrag; dann bleibt dessen Verweis.
 * Ein **neuer** Wert, der einem Eintrag der Werteliste gleicht (Titel oder Alias), wird zum
 * Verweis auf dessen Wissensknoten, wie bei einer Auswahl im Plattform-Editor.
 *
 * ⚠️ Nur ein neuer Wert: Ein unveränderter Freitext „Partnerarbeit" bleibt Freitext. Würde
 * er beim Mischen zum Verweis, wiche jede solche Phase vom Serverstand ab — und jede
 * vault-geänderte Notiz schickte Phasen mit, die niemand angefasst hat.
 */
function alsVerweis(textWert: string | null, bisher: Verweis[], liste: Eintrag[] = []): Verweis | null {
	const t = (textWert ?? "").trim();
	if (t === "") return null;
	const gleich = bisher.find((b) => anzeige(b) === t);
	if (gleich) return gleich;
	const eintrag = findeEintrag(liste, t);
	return eintrag
		? { typ: "node", wert: null, node_id: eintrag.id, titel: eintrag.titel }
		: { typ: "text", wert: t, node_id: null, titel: null };
}

/**
 * Die Mischregel: Die Phasenliste wird nicht neu gebaut. Auf jede Phase kommen nur die
 * Felder, die die Darstellung im Vault ausdrückt; alles andere bleibt, wie es auf der
 * Plattform steht. Eine Zeile, die fehlt, ist eine gelöschte Phase — das ist gewollt.
 */
export function mischePhasen(
	server: Phase[],
	vault: VaultPhase[],
	wertelisten?: Wertelisten | null,
): PhaseNutzlast[] {
	const basis = ordnePhasenZu(server, vault);
	return vault.map((v, i) => {
		const alt = basis[i];
		const p: PhaseNutzlast = alt
			? nutzlast(alt)
			: { id: null, name: v.name, dauer_min: null, beschreibung: null, prio: "kern", sozialform: null, methode: null, material: [] };
		p.name = v.name;
		if (v.dauer_min !== undefined) p.dauer_min = v.dauer_min;
		if (v.beschreibung !== undefined) p.beschreibung = v.beschreibung;
		if (v.prio !== undefined) p.prio = v.prio;
		if (v.sozialform !== undefined) {
			p.sozialform = alsVerweis(v.sozialform, alt?.sozialform ? [alt.sozialform] : [], wertelisten?.sozialform);
		}
		if (v.methode !== undefined) {
			p.methode = alsVerweis(v.methode, alt?.methode ? [alt.methode] : [], wertelisten?.methode);
		}
		if (v.material !== undefined) {
			p.material = v.material
				.map((m) => alsVerweis(m, alt?.material ?? []))
				.filter((m): m is Verweis => m !== null);
		}
		return p;
	});
}

/** Gleich in den Schemafeldern — der Status einer Plattform-Phase zählt nicht mit. */
export function gleichePhasen(a: PhaseNutzlast[], b: PhaseNutzlast[]): boolean {
	const schema = (p: PhaseNutzlast) => nutzlast({ ...p, status: null });
	return stableStringify(a.map(schema)) === stableStringify(b.map(schema));
}
