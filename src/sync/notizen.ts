import type { SlotRead, UnitRead } from "../api/types";
import { renderFrontmatter, type FrontmatterValue } from "./frontmatter";

/**
 * Die Notizformate, die das Plugin erzeugt — an einer Stelle, damit ein Umbau der
 * Vault-Konvention nicht durch drei Dateien wandert.
 */

/** Zeichen, die Obsidian in Dateinamen nicht mag. */
export function slugify(text: string): string {
	return text
		.replace(/[\\/:*?"<>|#^[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function datumDeutsch(iso: string): string {
	const [jahr, monat, tag] = iso.split("-");
	return `${tag}.${monat}.${jahr}`;
}

export interface LehrauftragKontext {
	/** Notizname des Lehrauftrags, zugleich Ordnername — z. B. "NwT 9". */
	name: string;
	/** Vault-Konvention, z. B. "NwT" → `Fach: "[[NwT]]"`. Leer = Feld bleibt leer. */
	fach: string;
	stufe: number | null;
}

export function fachLink(fach: string): string | null {
	const wert = fach.trim();
	if (!wert) return null;
	// Wer schon "[[…]]" einträgt, bekommt es nicht doppelt.
	return wert.startsWith("[[") ? wert : `[[${wert}]]`;
}

/**
 * Lehrauftragsnotiz aus der Vault-Vorlage.
 *
 * `Lehrauftrag-Template.md` enthält keine Templater-Syntax — nur Frontmatter, feste
 * Überschriften und den dataviewjs-Statistikblock. Deshalb kann das Plugin die Vorlage
 * benutzen, statt sie nachzubauen: Der Block bleibt an einer Stelle gepflegt, und was
 * du am Template änderst, gilt ab dem nächsten neu angelegten Lehrauftrag.
 *
 * Ohne Vorlage (nicht gefunden) wird ein knapper Ersatz erzeugt.
 */
export function baueLehrauftragsnotiz(
	kontext: LehrauftragKontext,
	vorlage: string | null,
): string {
	const felder: Record<string, FrontmatterValue> = {
		Kategorien: ["[[Lehraufträge]]"],
		Fach: fachLink(kontext.fach),
		Stufe: kontext.stufe,
		Klasse: null,
		Bild: null,
		Schuljahre: null,
	};

	if (vorlage === null) {
		return `${renderFrontmatter(felder)}\n\n## Unterrichtseinheiten\n![[Unterrichtseinheiten.base#Lehrauftrag]]\n\n## GFS-Themen\n![[GFS-Themen.base#Lehrauftrag]]\n\n## Grundsätzliche Überlegungen\n\n## Notenbildung\n`;
	}

	// Den Rumpf der Vorlage übernehmen, das Frontmatter durch das gefüllte ersetzen.
	const zeilen = vorlage.split("\n");
	let rumpf = vorlage;
	if (zeilen[0]?.trim() === "---") {
		const ende = zeilen.findIndex((z, i) => i > 0 && z.trim() === "---");
		if (ende > 0) rumpf = zeilen.slice(ende + 1).join("\n").replace(/^\n/, "");
	}
	return `${renderFrontmatter(felder)}\n${rumpf}`;
}

export function ueFelder(
	unit: UnitRead,
	kontext: LehrauftragKontext,
	stundenzahl: number,
	serverHash: string,
): Record<string, FrontmatterValue> {
	return {
		Kategorien: ["[[UEinheiten]]"],
		Fach: fachLink(kontext.fach),
		Stufe: kontext.stufe,
		Lehrauftrag: `[[${kontext.name}]]`,
		zuletzt: null,
		Stunden: stundenzahl,
		Zusammenfassung: null,
		Bild: null,
		ggd_node_id: unit.id,
		ggd_group_id: null,
		ggd_updated_at: unit.updated_at,
		ggd_server_hash: serverHash,
		ggd_status: "aktiv",
	};
}

/**
 * Der Rumpf einer neuen UE-Notiz — nachgebaut nach `UEinheit-Template.md`.
 *
 * Anders als beim Lehrauftrag geht der Vorlagenweg hier nicht: Das UE-Template rechnet
 * in Templater-Blöcken (Fach und Stufe aus der Lehrauftragsnotiz, anschließend
 * `tp.file.move` in den gleichnamigen Unterordner). Es liefe also nur, wenn Templater
 * die Datei erzeugt — der Sync tut das nicht.
 *
 * Geschrieben wird dieser Rumpf **genau einmal**, beim Anlegen. Danach pflegt der Sync
 * nur noch das Frontmatter.
 */
export function baueUeRumpf(): string {
	return [
		"## Stunden",
		"![[Unterrichtsstunden.base#Einheit]]",
		"",
		"## Stoffverteilung",
		"",
		"## GFS",
		"![[GFS-Themen.base#Einheit]]",
		"",
		"## Inhaltliche Überlegungen",
		"",
		"## Didaktische Überlegungen",
		"",
		"## inhaltsbezogene Kompetenzen",
		"",
		"## prozessbezogene Kompetenzen",
		"",
		"## Material",
		"",
		"## Literatur",
		"",
	].join("\n");
}

/** Nur die Felder, die in der UE-Notiz landen — mehr darf nicht in den Hash. */
export function ueNutzlast(unit: UnitRead, stundenzahl: number) {
	return { titel: unit.title, kapitel_std: unit.kapitel_std, stundenzahl };
}

export function ueOrdner(ordner: string, unit: UnitRead): string {
	const name = slugify(unit.title);
	return `${ordner}/${name}`;
}

export function uePfad(ordner: string, unit: UnitRead): string {
	const name = slugify(unit.title);
	return `${ordner}/${name}/${name}.md`;
}

export function stundenNutzlastSlot(slot: SlotRead) {
	return slot;
}
