import type { OverviewRead, SlotRead, UnitRead } from "../api/types";
import { hashObject } from "./hash";
import {
	REGION_ENDE,
	VAULT_UEBERSCHRIFT,
	extractOwnSection,
	plattformRegion,
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
import { kategorieZuUArt, slotZuUStand } from "./status";

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
}

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

/**
 * Die beiden Ankerfelder. Eine Stundennotiz trägt immer `uplan_slot_id` und, sobald es
 * einen Entwurf gibt, `uplan_node_id`; eine UE-Notiz nur `uplan_node_id`. Am Slot-Feld
 * erkennt der Sync deshalb, welche Art Notiz vor ihm liegt.
 */
const SLOT_FELD = "uplan_slot_id";
const KNOTEN_FELD = "uplan_node_id";

/**
 * Version des Stundennotiz-Formats. Sie steht im Server-Hash, damit eine Formatänderung
 * jede Stundennotiz einmal neu schreibt — sonst bekämen nur die Notizen das neue Format,
 * deren Termin sich zufällig gerade auf der Plattform geändert hat. Bei jeder Änderung
 * an `baueStundennotiz` hochzählen.
 *
 * 2: `UArt`/`UStand` statt `UStatus`, Dateiname aus dem Datum, `## Ablauf`, `## Notizen`.
 */
const NOTIZFORMAT = 2;

interface Stundennotiz {
	notiz: VorhandeneNotiz;
	felder: Record<string, string>;
}

function istArchiviert(felder: Record<string, string>): boolean {
	return felder["uplan_status"] === "archiviert";
}

function merke(register: Map<string, Stundennotiz[]>, schluessel: string, eintrag: Stundennotiz) {
	const liste = register.get(schluessel) ?? [];
	liste.push(eintrag);
	register.set(schluessel, liste);
}

/** Die erste noch freie Notiz — eine aktive vor einer archivierten, die damit wieder auflebt. */
function waehle(kandidaten: Stundennotiz[], vergeben: Set<Stundennotiz>): Stundennotiz | undefined {
	const frei = kandidaten.filter((k) => !vergeben.has(k));
	return frei.find((k) => !istArchiviert(k.felder)) ?? frei[0];
}

/**
 * Welche vorhandene Notiz zu welchem Slot gehört (Notizformat-Plan, Entscheidung 2).
 *
 * Hat der Slot einen Stundenknoten, ankert die Notiz **am Knoten**: Sie ist „die Stunde"
 * und folgt ihrem Inhalt. Das zählt, weil der Swap der Plattform Knoten zwischen Slots
 * tauscht, die ihr Datum behalten — am Slot verankert bliebe die Vorbereitung beim falschen
 * Termin stehen. Ohne Knoten ankert sie **am Slot** und ist „der Termin".
 *
 * Deshalb zwei Durchgänge, und die Reihenfolge ist der Kern: Erst holt sich jeder Knoten
 * seine Notiz, wo immer sie gerade liegt. Dann bekommen die übrigen Slots ihre
 * Termin-Notiz — auch dann, wenn der Slot inzwischen einen Knoten hat, den noch keine Notiz
 * kennt. So übernimmt ein Platzhalter beim ersten Entwurf den Knoten, statt ein Duplikat
 * zu bekommen.
 *
 * Eine Notiz, deren Knoten noch im Plan steht, gehört diesem Knoten, auch wenn ihr
 * Slot-Feld noch auf den alten Termin zeigt. Ist ihr Knoten verschwunden (Entwurf
 * gelöscht), fällt sie auf ihren Termin zurück.
 */
function ordneNotizenZu(slots: SlotRead[], notizen: Stundennotiz[]): Map<string, Stundennotiz> {
	const nachKnoten = new Map<string, Stundennotiz[]>();
	const nachSlot = new Map<string, Stundennotiz[]>();
	for (const eintrag of notizen) {
		merke(nachSlot, eintrag.felder[SLOT_FELD] as string, eintrag);
		const knoten = eintrag.felder[KNOTEN_FELD];
		if (knoten) merke(nachKnoten, knoten, eintrag);
	}

	const knotenImPlan = new Set(slots.flatMap((s) => (s.stunde_node_id ? [s.stunde_node_id] : [])));
	const vergeben = new Set<Stundennotiz>();
	const zuordnung = new Map<string, Stundennotiz>();
	const vergib = (slot: SlotRead, eintrag: Stundennotiz | undefined) => {
		if (!eintrag) return;
		vergeben.add(eintrag);
		zuordnung.set(slot.id, eintrag);
	};

	for (const slot of slots) {
		if (slot.stunde_node_id) vergib(slot, waehle(nachKnoten.get(slot.stunde_node_id) ?? [], vergeben));
	}
	for (const slot of slots) {
		if (zuordnung.has(slot.id)) continue;
		const kandidaten = (nachSlot.get(slot.id) ?? []).filter((k) => {
			const knoten = k.felder[KNOTEN_FELD];
			return !knoten || !knotenImPlan.has(knoten);
		});
		vergib(slot, waehle(kandidaten, vergeben));
	}
	return zuordnung;
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

	// Stundennotizen und UE-Notizen getrennt: Eine Stundennotiz trägt mit `uplan_node_id`
	// dasselbe Feld wie eine UE-Notiz und könnte ihr in einem gemeinsamen Register in die
	// Quere kommen.
	const stundennotizen: Stundennotiz[] = [];
	const ueIndex = new Map<string, VorhandeneNotiz>();
	for (const notiz of vorhanden) {
		const felder = readScalars(splitNote(notiz.inhalt).frontmatter);
		if (felder[SLOT_FELD]) {
			stundennotizen.push({ notiz, felder });
			continue;
		}
		const ueAnker = felder[KNOTEN_FELD];
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
	const pfade = stundenPfade(zuordnung, slots);
	const zugeordnet = ordneNotizenZu(slots, stundennotizen);

	for (const slot of slots) {
		const unit = slot.ue_node_id ? einheiten.get(slot.ue_node_id) : undefined;
		const pfad = pfade.get(slot.id) as string;
		const bestehend = zugeordnet.get(slot.id);
		const serverHash = hashObject(serverNutzlast(slot, unit));

		if (!bestehend) {
			ops.push({
				art: "erstellen",
				pfad,
				inhalt: baueStundennotiz(zuordnung, slot, unit, serverHash, ""),
			});
			continue;
		}

		const { notiz, felder } = bestehend;
		const vaultGeaendert =
			felder["uplan_hash"] !== undefined &&
			felder["uplan_hash"] !== hashPlattformRegion(notiz.inhalt);
		// Eine archivierte Notiz, deren Termin zurückkehrt, wird neu geschrieben, auch bei
		// gleichem Serverstand — sonst bekäme sie ihren Namen zurück und bliebe archiviert.
		const serverGeaendert = felder["uplan_server_hash"] !== serverHash || istArchiviert(felder);

		if (!serverGeaendert && !vaultGeaendert && notiz.pfad === pfad) {
			ops.push({ art: "unveraendert", pfad });
			continue;
		}

		if (notiz.pfad !== pfad) {
			// Umbenennen statt neu anlegen — der Anker steht im Frontmatter, nicht im Namen.
			ops.push({ art: "umbenennen", pfad, vonPfad: notiz.pfad });
		}

		if (!serverGeaendert) {
			// Nur der Vault hat sich bewegt. Zurückgeschrieben wird noch nicht; die Änderung
			// bleibt stehen, bis der Rückkanal sie mitnimmt.
			ops.push({
				art: "unveraendert",
				pfad,
				grund: "nur Vault geändert — wird noch nicht zurückgeschrieben",
			});
			continue;
		}

		const eigenerTeil = extractOwnSection(splitNote(notiz.inhalt).body);
		const neu = baueStundennotiz(zuordnung, slot, unit, serverHash, eigenerTeil);
		const uebernahme = slot.stunde_node_id && !felder[KNOTEN_FELD];

		if (vaultGeaendert) {
			ops.push({
				art: "konflikt",
				pfad,
				inhalt: setzeHash(mitKonfliktblock(neu, notiz.inhalt)),
				grund: "beidseitig geändert — Plattform gewinnt, Vault-Fassung als Block angehängt",
			});
		} else {
			ops.push({
				art: "aktualisieren",
				pfad,
				inhalt: neu,
				grund: uebernahme ? "erster Entwurf — die Notiz übernimmt den Stundenknoten" : "Serverstand neuer",
			});
		}
	}

	// Was keinem Slot mehr zugeordnet ist, wird archiviert — nie gelöscht. Verschwundenes
	// erkennt man nur am Abgleich der Vollmenge; die Plattform löscht hart, ohne Grabstein.
	//
	// Zwei Fälle, unterschieden im Namen: „ersetzt" heißt, der Termin besteht weiter, gehört
	// jetzt aber einer Stunde, die von einem anderen Termin herübergewandert ist. Das trifft
	// nur Platzhalter: Eine Notiz mit Knoten wandert mit ihrem Knoten.
	const vergeben = new Set(zugeordnet.values());
	const slotIds = new Set(slots.map((s) => s.id));
	const belegt = new Set([...vorhanden.map((n) => n.pfad), ...pfade.values()]);
	for (const eintrag of stundennotizen) {
		if (vergeben.has(eintrag) || istArchiviert(eintrag.felder)) continue;
		const { notiz, felder } = eintrag;
		const slotId = felder[SLOT_FELD] as string;
		const ersetzt = slotIds.has(slotId);

		// Der Name gehört den aktiven Terminen: Ein Slot desselben Tages will ihn haben. Die
		// archivierte Notiz gibt ihn deshalb frei.
		const ziel = archivPfad(notiz.pfad, ersetzt ? "ersetzt" : "archiviert", belegt);
		belegt.add(ziel);
		ops.push({
			art: "umbenennen",
			pfad: ziel,
			vonPfad: notiz.pfad,
			grund: "archiviert — gibt seinen Namen frei",
		});
		ops.push({
			art: "archivieren",
			pfad: ziel,
			inhalt: setzeStatusArchiviert(notiz.inhalt),
			grund: ersetzt
				? `ersetzt — ${pfade.get(slotId)} gehört jetzt einer verschobenen Stunde`
				: "auf der Plattform nicht mehr vorhanden",
		});
	}

	return {
		gruppe: zuordnung.groupId,
		ops: ordneKollisionsfrei(ops, new Set(vorhanden.map((n) => n.pfad))),
	};
}

/**
 * Wo eine archivierte Stundennotiz künftig liegt: `… (archiviert).md` bzw.
 * `… (ersetzt).md`. Liegt dort schon eine, wird gezählt — `(archiviert 2)`. Rein ableitbar
 * aus dem Dateibild, ohne Uhr.
 */
function archivPfad(pfad: string, wort: string, belegt: Set<string>): string {
	const stamm = pfad.replace(/\.md$/, "");
	for (let n = 1; ; n++) {
		const ziel = `${stamm} (${n === 1 ? wort : `${wort} ${n}`}).md`;
		if (!belegt.has(ziel)) return ziel;
	}
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

/**
 * Genau die Felder, die in der Notiz landen — mehr darf nicht in den Hash. Dazu die
 * Formatversion: Ändert sich die Gestalt der Notiz, gilt jede als veraltet.
 */
function serverNutzlast(slot: SlotRead, unit: UnitRead | undefined) {
	return {
		format: NOTIZFORMAT,
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

/**
 * Dateinamen aller Stundennotizen: `NwT 9 2026-09-15.md`.
 *
 * Keine laufende Nummer — sie ist eine Position, keine Identität, und jede vorne
 * eingefügte Stunde benannte alle folgenden um. Kein Thema — eine Themenänderung soll
 * keine Umbenennung auslösen. Das ISO-Datum vorn sortiert die Namen nebenbei
 * chronologisch.
 *
 * Zwei Slots am selben Tag bekommen beide ihre Anfangsstunde angehängt, nicht nur der
 * zweite: Sonst hinge der Name an der Reihenfolge, in der die Slots entstanden sind. Ohne
 * `start_period` zählt die Reihenfolge des Tages.
 *
 * @param slots chronologisch sortiert
 */
export function stundenPfade(zuordnung: GruppenZuordnung, slots: SlotRead[]): Map<string, string> {
	const jeTag = new Map<string, SlotRead[]>();
	for (const slot of slots) jeTag.set(slot.date, [...(jeTag.get(slot.date) ?? []), slot]);

	const pfade = new Map<string, string>();
	for (const [datum, amTag] of jeTag) {
		amTag.forEach((slot, i) => {
			const zusatz = amTag.length > 1 ? ` (${slot.start_period ?? i + 1}. Std.)` : "";
			const name = `${lehrauftragName(zuordnung)} ${datum}${zusatz}.md`;
			pfade.set(slot.id, [zuordnung.ordner, zuordnung.stundenOrdner, name].filter(Boolean).join("/"));
		});
	}
	return pfade;
}

/**
 * Vor- und Zurück-Link als DataviewJS, zur Anzeigezeit berechnet.
 *
 * Das alte Skript schrieb die Nachbarn als Text in jede Notiz. Dann müsste der Sync bei
 * jeder Verschiebung bis zu drei Notizen nachziehen — genau die Schreiblast, die der
 * Dateiname aus dem Datum vermeiden soll. So schreibt er keine einzige Navigationszeile.
 * Sortiert wird nach Dateiname, der mit dem ISO-Datum beginnt.
 *
 * Als sofort ausgeführte Funktion, weil Dataview einen Inline-Ausdruck erwartet.
 */
const NAVIGATION = [
	"`$= (() => {",
	"const c = dv.current();",
	`const s = dv.pages('"' + c.file.folder + '"')`,
	`.where(p => p.uplan_slot_id && p.uplan_status != "archiviert")`,
	".sort(p => p.file.name).array();",
	"const i = s.findIndex(p => p.file.path == c.file.path);",
	`return (s[i - 1] ? s[i - 1].file.link : "") + " ← " + (c.UEinheit ?? "") + " → " + (s[i + 1] ? s[i + 1].file.link : "");`,
	"})()`",
].join(" ");

export function baueStundennotiz(
	zuordnung: GruppenZuordnung,
	slot: SlotRead,
	unit: UnitRead | undefined,
	serverHash: string,
	eigenerTeil: string,
): string {
	const felder: Record<string, FrontmatterValue> = {
		Kategorien: ["[[UStunden]]"],
		Lehrauftrag: `[[${lehrauftragName(zuordnung)}]]`,
		UEinheit: unit ? `[[${slugify(unit.title)}]]` : null,
		Datum: slot.date,
		UArt: kategorieZuUArt(slot.kategorie),
		UStand: slotZuUStand(slot),
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
		`># ${datumDeutsch(slot.date)}`,
		">>[!journal-header-links]",
		`>>${NAVIGATION}`,
	].join("\n");

	const eigen = eigenerTeil.trim() || VAULT_UEBERSCHRIFT;

	// Kein Meta-Bind-Feld mehr: `UArt` und `UStand` gehören der Plattform. Ein Auswahlfeld
	// lüde dazu ein, sie im Vault zu ändern — und jede solche Änderung wäre beim nächsten
	// Serverstand ein Konflikt.
	const rumpf = [
		kopf,
		"",
		...(slot.note?.trim() ? ["## Hinweise", slot.note.trim(), ""] : []),
		"## Ablauf",
		slot.hat_phasen
			? "_Der Entwurf liegt auf der Plattform. Hier erscheint er, sobald der Ablauf gespiegelt wird._"
			: "1.",
		"",
		REGION_ENDE,
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
	return inhalt.replace(/^uplan_hash:.*$/m, `uplan_hash: ${hashPlattformRegion(inhalt)}`);
}

/**
 * Der Vault-Hash: nur über die Plattform-Region, und dort **ohne** die `uplan_hash`-Zeile —
 * sonst hinge der Hash von sich selbst ab.
 *
 * Nur die Region, weil hinter `REGION_ENDE` nichts liegt, was der Sync überschreiben
 * könnte. Wer dort schreibt, hat für den Abgleich nichts geändert.
 *
 * Ohne Marker ist die Region die ganze Datei und der Hash derselbe wie vor der Umstellung:
 * Eine unberührte Bestandsnotiz darf nicht plötzlich als vault-geändert gelten.
 *
 * Gehasht wird noch der Text. Sobald `## Ablauf` geparst wird (AP5 im Notizformat-Plan),
 * tauscht diese Funktion ihr Innenleben gegen einen Hash über die Struktur — dann stört
 * auch eine von Obsidian neu ausgerichtete Tabelle nicht mehr.
 */
export function hashPlattformRegion(inhalt: string): string {
	const ohne = plattformRegion(inhalt).replace(/^uplan_hash:.*$/m, "uplan_hash:");
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
