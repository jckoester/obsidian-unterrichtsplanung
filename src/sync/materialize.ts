import type { OverviewRead, SlotRead, UnitRead } from "../api/types";
import { hashObject } from "./hash";
import {
	MARKER_UEBERSCHRIFT,
	extractOwnSection,
	readScalars,
	renderFrontmatter,
	splitNote,
	type FrontmatterValue,
} from "./frontmatter";
import type { SyncOp, SyncPlan } from "./plan";
import { kategorieZuUStatus } from "./status";

/**
 * Die Materialisierung ist **rein**: Serverstand + vorhandene Notizen rein, Liste von
 * Dateioperationen raus. Kein Vault-Zugriff, kein Netz. Der Dry-Run ist deshalb kein
 * Sonderpfad, sondern schlicht: den Plan bauen und nicht ausführen.
 */

export interface VorhandeneNotiz {
	pfad: string;
	inhalt: string;
}

export interface GruppenZuordnung {
	groupId: number;
	/** Notizname des Lehrauftrags, z. B. "NwT 9 2526|NwT 9" für den Wikilink. */
	lehrauftragLink: string;
	/** Ordner des Lehrauftrags, z. B. "Bereiche/11 Unterricht/NwT 9". */
	ordner: string;
	/** Unterordner für Stundennotizen, relativ zu `ordner`. */
	stundenOrdner: string;
	/** Dateinamensmuster; Platzhalter: {lehrauftrag} {nr} {datum} {thema} */
	dateiMuster: string;
}

export const STANDARD_DATEIMUSTER = "{lehrauftrag} Stunde {nr}";

export interface MaterializeInput {
	zuordnung: GruppenZuordnung;
	overview: OverviewRead;
	vorhanden: VorhandeneNotiz[];
}

/** Der Anker. Siehe Kommentar in `stundenAnker`. */
const ANKER_FELD = "ggd_slot_id";
const UE_ANKER_FELD = "ggd_node_id";

/**
 * Warum der Slot und nicht der Stundenknoten ankert: Ein Slot existiert ab der
 * Slot-Generierung, ein `stunde_node_id` erst, wenn jemand einen Entwurf anlegt.
 * Ankerte die Notiz am Knoten, bekäme jede leere Stunde beim ersten Entwurf einen
 * neuen Anker — und damit ein Duplikat statt einer Aktualisierung.
 */
function stundenAnker(slot: SlotRead): string {
	return slot.id;
}

export function materialize(input: MaterializeInput): SyncPlan {
	const { zuordnung, overview, vorhanden } = input;
	const ops: SyncOp[] = [];

	const index = new Map<string, VorhandeneNotiz>();
	for (const notiz of vorhanden) {
		const felder = readScalars(splitNote(notiz.inhalt).frontmatter);
		const anker = felder[ANKER_FELD] ?? felder[UE_ANKER_FELD];
		if (anker) index.set(anker, notiz);
	}

	const einheiten = new Map<string, UnitRead>();
	for (const unit of overview.units) einheiten.set(unit.id, unit);

	const slots = [...overview.slots].sort(vergleicheSlots);
	const gesehen = new Set<string>();

	slots.forEach((slot, i) => {
		const anker = stundenAnker(slot);
		gesehen.add(anker);
		const unit = slot.ue_node_id ? einheiten.get(slot.ue_node_id) : undefined;
		const nr = i + 1;
		const pfad = stundenPfad(zuordnung, slot, nr);
		const vorhandeneNotiz = index.get(anker);
		const serverHash = hashObject(serverNutzlast(slot, unit));

		if (!vorhandeneNotiz) {
			ops.push({
				art: "erstellen",
				pfad,
				inhalt: baueStundennotiz(zuordnung, slot, unit, nr, serverHash, ""),
			});
			return;
		}

		const felder = readScalars(splitNote(vorhandeneNotiz.inhalt).frontmatter);
		const vaultGeaendert =
			felder["ggd_hash"] !== undefined &&
			felder["ggd_hash"] !== hashNotizInhalt(vorhandeneNotiz.inhalt);
		const serverGeaendert = felder["ggd_server_hash"] !== serverHash;

		if (!serverGeaendert && !vaultGeaendert && vorhandeneNotiz.pfad === pfad) {
			ops.push({ art: "unveraendert", pfad });
			return;
		}

		if (vorhandeneNotiz.pfad !== pfad) {
			// Umbenennen statt neu anlegen — der Anker hängt am Slot, nicht am Namen.
			ops.push({ art: "umbenennen", pfad, vonPfad: vorhandeneNotiz.pfad });
		}

		if (!serverGeaendert) {
			// Nur der Vault hat sich bewegt. Stufe 1 schreibt nicht zurück; das Feld
			// bleibt stehen und wandert in Stufe 2 über den Rückkanal.
			ops.push({
				art: "unveraendert",
				pfad,
				grund: "nur Vault geändert — Rückkanal ist Stufe 2",
			});
			return;
		}

		const eigenerTeil = extractOwnSection(splitNote(vorhandeneNotiz.inhalt).body);
		const neu = baueStundennotiz(zuordnung, slot, unit, nr, serverHash, eigenerTeil);

		if (vaultGeaendert) {
			ops.push({
				art: "konflikt",
				pfad,
				inhalt: mitKonfliktblock(neu, vorhandeneNotiz.inhalt),
				grund: "beidseitig geändert — Plattform gewinnt, Vault-Fassung als Block angehängt",
			});
		} else {
			ops.push({ art: "aktualisieren", pfad, inhalt: neu, grund: "Serverstand neuer" });
		}
	});

	// Verschwundenes erkennt man nur am Abgleich der Vollmenge — die Plattform löscht
	// hart, ohne Grabstein. Gelöscht wird im Vault trotzdem nichts.
	for (const [anker, notiz] of index) {
		if (gesehen.has(anker)) continue;
		const { frontmatter } = splitNote(notiz.inhalt);
		if (readScalars(frontmatter)["ggd_status"] === "archiviert") continue;
		ops.push({
			art: "archivieren",
			pfad: notiz.pfad,
			inhalt: setzeStatusArchiviert(notiz.inhalt),
			grund: "auf der Plattform nicht mehr vorhanden",
		});
	}

	return { gruppe: zuordnung.groupId, ops };
}

function vergleicheSlots(a: SlotRead, b: SlotRead): number {
	if (a.date !== b.date) return a.date < b.date ? -1 : 1;
	return (a.start_period ?? 0) - (b.start_period ?? 0);
}

/** Genau die Felder, die in der Notiz landen — mehr darf nicht in den Hash. */
function serverNutzlast(slot: SlotRead, unit: UnitRead | undefined) {
	return {
		date: slot.date,
		start_period: slot.start_period,
		periods: slot.periods,
		kategorie: slot.kategorie,
		thema: slot.thema,
		note: slot.note,
		hat_phasen: slot.hat_phasen,
		nachbereitet_at: slot.nachbereitet_at,
		ue_node_id: slot.ue_node_id,
		stunde_node_id: slot.stunde_node_id,
		ue_titel: unit?.title ?? null,
	};
}

export function stundenPfad(
	zuordnung: GruppenZuordnung,
	slot: SlotRead,
	nr: number,
): string {
	const name = zuordnung.dateiMuster
		.replace("{lehrauftrag}", anzeigeName(zuordnung.lehrauftragLink))
		.replace("{nr}", String(nr))
		.replace("{datum}", slot.date)
		.replace("{thema}", slugify(slot.thema ?? ""))
		.trim();
	const teile = [zuordnung.ordner, zuordnung.stundenOrdner, `${name}.md`].filter(Boolean);
	return teile.join("/");
}

function anzeigeName(link: string): string {
	const pipe = link.indexOf("|");
	return pipe === -1 ? link : link.slice(pipe + 1);
}

export function slugify(text: string): string {
	return text
		.replace(/[\\/:*?"<>|#^[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function datumDeutsch(iso: string): string {
	const [jahr, monat, tag] = iso.split("-");
	return `${tag}.${monat}.${jahr}`;
}

export function baueStundennotiz(
	zuordnung: GruppenZuordnung,
	slot: SlotRead,
	unit: UnitRead | undefined,
	nr: number,
	serverHash: string,
	eigenerTeil: string,
): string {
	const felder: Record<string, FrontmatterValue> = {
		Kategorien: ["[[UStunden]]"],
		Lehrauftrag: `[[${zuordnung.lehrauftragLink}]]`,
		UEinheit: unit ? `[[${unit.title}]]` : null,
		Datum: slot.date,
		UStatus: [kategorieZuUStatus(slot)],
		Inhalte: slot.thema ?? null,
		UStunden: slot.periods,
		ggd_slot_id: slot.id,
		ggd_node_id: slot.stunde_node_id,
		ggd_group_id: slot.group_id,
		ggd_updated_at: slot.updated_at,
		ggd_server_hash: serverHash,
		ggd_hash: "",
		ggd_status: "aktiv",
	};

	const kopf = [
		">[!journal-header]",
		">## `=this.Lehrauftrag`",
		`># Stunde ${nr} - ${datumDeutsch(slot.date)}`,
	].join("\n");

	const eigen = eigenerTeil.trim() || MARKER_UEBERSCHRIFT;

	const rumpf = [
		kopf,
		"",
		`Status:\`INPUT[inlineSelect(title(Status), option(⚫️ Platzhalter), option(🟡 Idee), option(🟢 vorbereitet), option(✅ gehalten), option(🔵 Puffer), option(🟣 Prüfung), option(🔴 Entfall),defaultValue(⚫️ Platzhalter)):UStatus]\``,
		"",
		"## Ziele",
		slot.note?.trim() ? slot.note.trim() : "-",
		"",
		"## Verlauf",
		slot.hat_phasen
			? "_Entwurf liegt auf der Plattform — Phasen-Roundtrip ist Stufe 3._"
			: "1.",
		"",
		eigen,
		"",
	].join("\n");

	const roh = `${renderFrontmatter(felder)}\n${rumpf}`;
	return roh.replace("ggd_hash: \"\"", `ggd_hash: ${hashNotizInhalt(roh)}`);
}

/**
 * Der Vault-Hash über den Inhalt **ohne** die `ggd_hash`-Zeile — sonst hinge der Hash
 * von sich selbst ab.
 */
export function hashNotizInhalt(inhalt: string): string {
	const ohne = inhalt.replace(/^ggd_hash:.*$/m, "ggd_hash:");
	return hashObject(ohne);
}

function setzeStatusArchiviert(inhalt: string): string {
	if (/^ggd_status:.*$/m.test(inhalt)) {
		return inhalt.replace(/^ggd_status:.*$/m, "ggd_status: archiviert");
	}
	const { frontmatter, body } = splitNote(inhalt);
	return `---\n${frontmatter}\nggd_status: archiviert\n---\n${body}`;
}

function mitKonfliktblock(neu: string, alt: string): string {
	const alterRumpf = splitNote(alt).body.trim();
	return `${neu.trimEnd()}\n\n> [!warning] Sync-Konflikt\n> Die Plattform hatte den neueren Stand. Die vorherige Vault-Fassung steht unten und wird beim nächsten Sync nicht angefasst.\n\n\`\`\`markdown\n${alterRumpf}\n\`\`\`\n`;
}
