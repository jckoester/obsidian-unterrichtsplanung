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
import {
	baueLehrauftragsnotiz,
	baueUeRumpf,
	datumDeutsch,
	slugify,
	ueFelder,
	ueNutzlast,
	uePfad,
	type LehrauftragKontext,
} from "./notizen";
import { ersetzeFrontmatter } from "./frontmatter";
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
	/**
	 * Optionaler Überschreibwert für den Notiznamen des Lehrauftrags. Leer lassen:
	 * Dann ist es der Ordnername — so, wie die Ordnernotiz ohnehin heißen muss.
	 */
	lehrauftragLink: string;
	/** Vault-Konvention für das Fach, z. B. "NwT" → `Fach: "[[NwT]]"`. */
	fach: string;
	/** Jahrgangsstufe. Aus `/planning/groups/{id}/curriculum-chapters` befüllbar. */
	stufe: number | null;
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
	/** Inhalt von `System/Templates/Unterricht/Lehrauftrag-Template.md`, falls vorhanden. */
	lehrauftragVorlage?: string | null;
}

/** Notizname des Lehrauftrags — Überschreibwert, sonst der Ordnername. */
export function lehrauftragName(zuordnung: GruppenZuordnung): string {
	const override = zuordnung.lehrauftragLink.trim();
	if (override) return override;
	const teile = zuordnung.ordner.split("/").filter(Boolean);
	return teile[teile.length - 1] ?? "";
}

function kontextVon(zuordnung: GruppenZuordnung): LehrauftragKontext {
	return {
		name: lehrauftragName(zuordnung),
		fach: zuordnung.fach,
		stufe: zuordnung.stufe,
	};
}

/** Der Anker. Siehe Kommentar in `stundenAnker`. */
const ANKER_FELD = "uplan_slot_id";
const UE_ANKER_FELD = "uplan_node_id";

/**
 * Warum der Slot und nicht der Stundenknoten ankert: Ein Slot existiert ab der
 * Slot-Generierung, ein `stunde_node_id` erst, wenn jemand einen Entwurf anlegt.
 * Ankerte die Notiz am Knoten, bekäme jede leere Stunde beim ersten Entwurf einen
 * neuen Anker — und damit ein Duplikat statt einer Aktualisierung.
 */
function stundenAnker(slot: SlotRead): string {
	return slot.id;
}

export class ZuordnungFehler extends Error {
	constructor(nachricht: string) {
		super(nachricht);
		this.name = "ZuordnungFehler";
	}
}

/**
 * Prüft, was ohne Vault-Zugriff prüfbar ist. Ein Sync, der Dateien in einen halb
 * konfigurierten Ordner schreibt, ist schlimmer als einer, der sich weigert: Die
 * Notizen liegen dann irgendwo, und der nächste Lauf mit richtiger Einstellung findet
 * sie nicht wieder — er legt sie ein zweites Mal an.
 */
export function pruefeZuordnung(zuordnung: GruppenZuordnung): void {
	if (!zuordnung.groupId) {
		throw new ZuordnungFehler("Keine group_id eingetragen.");
	}
	if (!zuordnung.ordner.trim()) {
		throw new ZuordnungFehler(
			"Kein Ordner eingetragen. Erwartet wird der Ordner des Lehrauftrags, " +
				'z. B. "Bereiche/11 Unterricht/NwT 9" — nicht der Sammelordner darüber.',
		);
	}
	if (!lehrauftragName(zuordnung)) {
		throw new ZuordnungFehler(
			"Aus dem Ordner lässt sich kein Lehrauftragsname ableiten.",
		);
	}
}

export function materialize(input: MaterializeInput): SyncPlan {
	const { zuordnung, overview, vorhanden } = input;
	pruefeZuordnung(zuordnung);
	const ops: SyncOp[] = [];

	// Zwei Register, nicht eines: Eine Stundennotiz trägt beide Felder — `uplan_slot_id`
	// als Anker und `uplan_node_id` für den Stundenentwurf. In einem gemeinsamen Register
	// könnte sie einer Unterrichtseinheit in die Quere kommen.
	const index = new Map<string, VorhandeneNotiz>();
	const ueIndex = new Map<string, VorhandeneNotiz>();
	for (const notiz of vorhanden) {
		const felder = readScalars(splitNote(notiz.inhalt).frontmatter);
		const slotAnker = felder[ANKER_FELD];
		if (slotAnker) {
			index.set(slotAnker, notiz);
			continue;
		}
		const ueAnker = felder[UE_ANKER_FELD];
		if (ueAnker) ueIndex.set(ueAnker, notiz);
	}

	const einheiten = new Map<string, UnitRead>();
	for (const unit of overview.units) einheiten.set(unit.id, unit);

	const kontext = kontextVon(zuordnung);

	// ── Lehrauftragsnotiz ────────────────────────────────────────────────────
	// Nur anlegen, nie anfassen. Sie gehört dem Vault: Grundsätzliche Überlegungen,
	// Notenbildung, der Statistikblock — nichts davon hat der Sync zu verantworten.
	const lehrauftragPfad = `${zuordnung.ordner}/${kontext.name}.md`;
	if (!vorhanden.some((n) => n.pfad === lehrauftragPfad)) {
		ops.push({
			art: "erstellen",
			pfad: lehrauftragPfad,
			inhalt: baueLehrauftragsnotiz(kontext, input.lehrauftragVorlage ?? null),
			grund: "Lehrauftragsnotiz fehlt",
		});
	}

	// ── Unterrichtseinheiten ─────────────────────────────────────────────────
	const stundenJeUe = new Map<string, number>();
	for (const slot of overview.slots) {
		if (!slot.ue_node_id) continue;
		stundenJeUe.set(slot.ue_node_id, (stundenJeUe.get(slot.ue_node_id) ?? 0) + 1);
	}

	for (const unit of overview.units) {
		const pfad = uePfad(zuordnung.ordner, unit);
		const stundenzahl = stundenJeUe.get(unit.id) ?? 0;
		const serverHash = hashObject(ueNutzlast(unit, stundenzahl));
		const felder = ueFelder(unit, kontext, stundenzahl, serverHash);
		felder["uplan_group_id"] = zuordnung.groupId;
		const bestehend = ueIndex.get(unit.id);

		if (!bestehend) {
			ops.push({
				art: "erstellen",
				pfad,
				inhalt: `${renderFrontmatter(felder)}\n${baueUeRumpf()}`,
			});
			continue;
		}

		const alteFelder = readScalars(splitNote(bestehend.inhalt).frontmatter);
		if (alteFelder["uplan_server_hash"] === serverHash) {
			ops.push({ art: "unveraendert", pfad: bestehend.pfad });
			continue;
		}

		// Rumpf bleibt, Frontmatter wird getauscht. Der Ordner behält seinen Namen,
		// auch wenn die Einheit auf der Plattform umbenannt wurde: Darin liegt dein
		// Material, und ein automatisches Verschieben ist kein Nebeneffekt, den ein
		// Sync-Lauf haben sollte.
		const titelGewandert = bestehend.pfad !== pfad;
		ops.push({
			art: "aktualisieren",
			pfad: bestehend.pfad,
			inhalt: ersetzeFrontmatter(bestehend.inhalt, felder),
			grund: titelGewandert
				? `Titel jetzt „${unit.title}" — Ordner bleibt ${bestehend.pfad}`
				: "Serverstand neuer",
		});
	}

	// Auch Einheiten verschwinden: Die Übersicht der Plattform liefert nur Knoten mit
	// `status = active`, und der Lifecycle-Dienst archiviert persönliche Knoten nach
	// Ablaufdatum von selbst. Für den Vault gilt dasselbe wie bei den Stunden —
	// Grabstein statt Löschen. Umbenannt wird die UE-Notiz dabei nicht: In ihrem Ordner
	// liegt das Material, und der Ordner bleibt, wo er ist.
	for (const [anker, notiz] of ueIndex) {
		if (einheiten.has(anker)) continue;
		if (readScalars(splitNote(notiz.inhalt).frontmatter)["uplan_status"] === "archiviert") continue;
		ops.push({
			art: "archivieren",
			pfad: notiz.pfad,
			inhalt: setzeStatusArchiviert(notiz.inhalt),
			grund: "Einheit auf der Plattform nicht mehr vorhanden",
		});
	}

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
			felder["uplan_hash"] !== undefined &&
			felder["uplan_hash"] !== hashNotizInhalt(vorhandeneNotiz.inhalt);
		const serverGeaendert = felder["uplan_server_hash"] !== serverHash;

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
				inhalt: setzeHash(mitKonfliktblock(neu, vorhandeneNotiz.inhalt)),
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
		const felder = readScalars(splitNote(notiz.inhalt).frontmatter);
		if (felder["uplan_status"] === "archiviert") continue;

		// Die laufende Nummer im Dateinamen gehört den aktiven Stunden: Fällt eine weg,
		// rückt die nächste auf und will genau diesen Namen. Die archivierte Notiz gibt
		// ihn deshalb frei — bleiben tut sie, mit ihrem Datum im Namen.
		const ziel = archivPfad(notiz.pfad, felder["Datum"]);
		if (ziel !== notiz.pfad) {
			ops.push({
				art: "umbenennen",
				pfad: ziel,
				vonPfad: notiz.pfad,
				grund: "archiviert — gibt seinen Namen frei",
			});
		}
		ops.push({
			art: "archivieren",
			pfad: ziel,
			inhalt: setzeStatusArchiviert(notiz.inhalt),
			grund: "auf der Plattform nicht mehr vorhanden",
		});
	}

	return {
		gruppe: zuordnung.groupId,
		ops: ordneKollisionsfrei(ops, new Set(vorhanden.map((n) => n.pfad))),
	};
}

/** Wo eine archivierte Stundennotiz künftig liegt. Rein ableitbar, ohne Uhr. */
function archivPfad(pfad: string, datum?: string): string {
	const ohneEndung = pfad.replace(/\.md$/, "");
	const zusatz = datum ? ` (archiviert ${datum})` : " (archiviert)";
	return ohneEndung.endsWith(zusatz) ? pfad : `${ohneEndung}${zusatz}.md`;
}

/**
 * Der Plan wird der Reihe nach ausgeführt — also muss jedes Ziel frei sein, wenn seine
 * Operation an der Reihe ist. Von selbst stimmt das nicht: Die laufende Nummer im
 * Dateinamen ist eine Position, keine Identität. Kommt vorne eine Stunde dazu, rutschen
 * alle folgenden Nummern, und „erstellen Stunde 1" träfe die Datei, die eben noch
 * Stunde 1 war — der Plan entsteht gegen das alte Dateibild, ausgeführt wird er gegen
 * das mitwandernde.
 *
 * Deshalb wird hier umsortiert. Ein Ringtausch (zwei Stunden tauschen die Namen) lässt
 * sich nicht sortieren; er braucht einen Zwischennamen. Bleibt am Ende etwas übrig,
 * liegt eine vault-eigene Datei auf dem Zielpfad — dann bleibt die Operation im Plan
 * stehen, damit der Wächter im Runner sie meldet, statt sie stillschweigend zu schlucken.
 */
function ordneKollisionsfrei(ops: SyncOp[], belegt: Set<string>): SyncOp[] {
	const brauchtFreiesZiel = (op: SyncOp) => op.art === "umbenennen" || op.art === "erstellen";
	const offen = ops.filter(brauchtFreiesZiel);
	const rest = ops.filter((op) => !brauchtFreiesZiel(op));
	const sortiert: SyncOp[] = [];
	let zwischenschritte = 0;

	while (offen.length > 0) {
		const naechste = offen.find((op) => !belegt.has(op.pfad));
		if (naechste) {
			offen.splice(offen.indexOf(naechste), 1);
			if (naechste.vonPfad) belegt.delete(naechste.vonPfad);
			belegt.add(naechste.pfad);
			sortiert.push(naechste);
			continue;
		}

		// Kein Ziel ist frei. Entweder blockieren sich zwei Umbenennungen gegenseitig —
		// dann löst ein Zwischenname den Ring — oder auf dem Zielpfad liegt eine Datei,
		// die dem Plan nicht gehört; die ist hier nicht zu lösen.
		const blockiert = offen[0];
		const beleger = offen.find((op) => op.art === "umbenennen" && op.vonPfad === blockiert?.pfad);
		if (!beleger?.vonPfad) break;

		const von = beleger.vonPfad;
		const zwischen = `${von.replace(/\.md$/, "")} (Zwischenschritt ${++zwischenschritte}).md`;
		sortiert.push({
			art: "umbenennen",
			pfad: zwischen,
			vonPfad: von,
			grund: "Ringtausch der Namen — Zwischenschritt",
		});
		belegt.delete(von);
		belegt.add(zwischen);
		beleger.vonPfad = zwischen;
	}

	return [...sortiert, ...offen, ...rest];
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
		.replace("{lehrauftrag}", lehrauftragName(zuordnung))
		.replace("{nr}", String(nr))
		.replace("{datum}", slot.date)
		.replace("{thema}", slugify(slot.thema ?? ""))
		.trim();
	const teile = [zuordnung.ordner, zuordnung.stundenOrdner, `${name}.md`].filter(Boolean);
	return teile.join("/");
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
		Lehrauftrag: `[[${lehrauftragName(zuordnung)}]]`,
		UEinheit: unit ? `[[${slugify(unit.title)}]]` : null,
		Datum: slot.date,
		UStatus: [kategorieZuUStatus(slot)],
		Inhalte: slot.thema ?? null,
		UStunden: slot.periods,
		uplan_slot_id: slot.id,
		uplan_node_id: slot.stunde_node_id,
		uplan_group_id: slot.group_id,
		uplan_updated_at: slot.updated_at,
		uplan_server_hash: serverHash,
		uplan_hash: "",
		uplan_status: "aktiv",
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
		// Das Stundenziel hängt am Stundenknoten (`LessonRead.stundenziel`), nicht am
		// Slot. Stufe 1 lädt Stunden nicht einzeln nach — bis dahin bleibt es leer.
		"-",
		"",
		...(slot.note?.trim() ? ["## Hinweise", slot.note.trim(), ""] : []),
		"## Verlauf",
		slot.hat_phasen
			? "_Entwurf liegt auf der Plattform — Phasen-Roundtrip ist Stufe 3._"
			: "1.",
		"",
		eigen,
		"",
	].join("\n");

	return setzeHash(`${renderFrontmatter(felder)}\n${rumpf}`);
}

/**
 * Setzt `uplan_hash` auf den Hash des fertigen Textes — und zwar als Letztes.
 *
 * Wer vorher hasht und danach noch etwas anhängt (der Konfliktblock tat das), hinterlässt
 * eine Notiz, die sich beim nächsten Lauf selbst als vault-geändert meldet, obwohl
 * niemand sie angefasst hat.
 */
function setzeHash(inhalt: string): string {
	return inhalt.replace(/^uplan_hash:.*$/m, `uplan_hash: ${hashNotizInhalt(inhalt)}`);
}

/**
 * Der Vault-Hash über den Inhalt **ohne** die `uplan_hash`-Zeile — sonst hinge der Hash
 * von sich selbst ab.
 */
export function hashNotizInhalt(inhalt: string): string {
	const ohne = inhalt.replace(/^uplan_hash:.*$/m, "uplan_hash:");
	return hashObject(ohne);
}

function setzeStatusArchiviert(inhalt: string): string {
	let mitStatus: string;
	if (/^uplan_status:.*$/m.test(inhalt)) {
		mitStatus = inhalt.replace(/^uplan_status:.*$/m, "uplan_status: archiviert");
	} else {
		const { frontmatter, body } = splitNote(inhalt);
		mitStatus = `---\n${frontmatter}\nuplan_status: archiviert\n---\n${body}`;
	}
	// Der Grabstein ist eine Änderung wie jede andere — ohne neuen Hash hielte der
	// nächste Lauf die Notiz für vault-geändert.
	return /^uplan_hash:/m.test(mitStatus) ? setzeHash(mitStatus) : mitStatus;
}

function mitKonfliktblock(neu: string, alt: string): string {
	const alterRumpf = splitNote(alt).body.trim();
	const zaun = "`".repeat(laengsterZaun(alterRumpf) + 1);
	return `${neu.trimEnd()}\n\n> [!warning] Sync-Konflikt\n> Die Plattform hatte den neueren Stand. Die vorherige Vault-Fassung steht unten und wird beim nächsten Sync nicht angefasst.\n\n${zaun}markdown\n${alterRumpf}\n${zaun}\n`;
}

/**
 * Wie lang der längste Backtick-Lauf im eingebetteten Text ist.
 *
 * Drei Backticks reichen als Zaun nicht: Enthält die gerettete Fassung selbst schon einen
 * Konfliktblock, beendet dessen Zaun den äußeren — der Rest der Notiz rutscht in den
 * Fließtext, und mit jedem weiteren Konflikt verschachtelt es sich tiefer.
 */
function laengsterZaun(inhalt: string): number {
	let max = 2;
	for (const treffer of inhalt.matchAll(/`+/g)) max = Math.max(max, treffer[0].length);
	return max;
}
