import type { LessonUpdate, OverviewRead, SlotRead, UnitRead } from "../api/types";
import { KOPF_SPRACHE } from "../kopf";
import { hashObject } from "./hash";
import {
	REGION_ENDE,
	VAULT_UEBERSCHRIFT,
	extractOwnSection,
	plattformRegion,
	readFelder,
	readScalars,
	renderFrontmatter,
	setzeFelder,
	splitNote,
	type FrontmatterValue,
} from "./frontmatter";
import {
	ablaufAbschnitt,
	gleichePhasen,
	leseAblauf,
	mischePhasen,
	nutzlast,
	rendereAblauf,
	type Phase,
	type VaultPhase,
} from "./phasen";
import {
	baueLehrauftragsnotiz,
	baueUeRumpf,
	slugify,
	ueFelder,
	ueNutzlast,
	uePfad,
	type LehrauftragKontext,
} from "./notizen";
import { ersetzeFrontmatter } from "./frontmatter";
import type { Rueckkanal, SyncOp, SyncPlan } from "./plan";
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

/**
 * Was der Sync vom Stundenknoten braucht — gleich, ob er aus dem Sammelabruf über
 * `/context/nodes` kommt oder einzeln aus `/planning/lessons/{id}`. Die beiden Antworten
 * sehen verschieden aus; hier sind sie eins.
 */
export interface Stundenknoten {
	id: string;
	stundenziel: string | null;
	phasen: Phase[];
	/** Stempel des Knotens — für `expected_updated_at`, als Zeichenkette unverändert zurück. */
	updated_at: string | null;
	/** `false`: archiviert oder fremd, nur lesbar. `null`: nicht bekannt. */
	darf_schreiben: boolean | null;
}

export interface MaterializeInput {
	zuordnung: GruppenZuordnung;
	overview: OverviewRead;
	vorhanden: VorhandeneNotiz[];
	/**
	 * Die Stundenknoten zu den Slots der Übersicht, soweit lesbar. Fehlt einer, bleibt sein
	 * Stundenziel leer — der Lauf geht weiter.
	 */
	stundenknoten?: Stundenknoten[];
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
 * 3: `Stundenziel` im Frontmatter.
 * 4: `## Ablauf` aus den Phasen der Plattform; `UStand: Skizze`.
 * 5: eigener Callout `uplan-stunde` statt `journal-header` (Snippet `uplan.css` in `vault/`).
 * 6: Kopf als Codeblock `uplan-kopf`, vom Plugin gezeichnet, statt Callout mit DataviewJS.
 */
const NOTIZFORMAT = 6;

/** Höchstens so viele Rückschreibungen je Lauf — jede legt einen Snapshot an, die Plattform hält 50 je Gruppe. */
export const RUECKSCHREIBUNGEN_JE_LAUF = 10;

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
			"Kein Ordner: In den Einstellungen fehlt der Basisordner oder der Ordnername dieser Gruppe.",
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
	const knoten = new Map((input.stundenknoten ?? []).map((k) => [k.id, k]));

	for (const slot of slots) {
		const unit = slot.ue_node_id ? einheiten.get(slot.ue_node_id) : undefined;
		const stunde = slot.stunde_node_id ? knoten.get(slot.stunde_node_id) : undefined;
		const pfad = pfade.get(slot.id) as string;
		const bestehend = zugeordnet.get(slot.id);
		const serverHash = hashObject(serverNutzlast(slot, unit, stunde));

		if (!bestehend) {
			ops.push({
				art: "erstellen",
				pfad,
				inhalt: baueStundennotiz(zuordnung, slot, unit, stunde, serverHash, ""),
			});
			continue;
		}

		const { notiz, felder } = bestehend;
		const vaultGeaendert = !vaultHashPasst(felder["uplan_hash"], notiz.inhalt);
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
			// Nur der Vault hat sich bewegt. Was davon dem Rückkanal gehört (Ablauf,
			// Stundenziel), geht zur Plattform; alles andere bleibt als Vault-Änderung stehen.
			ops.push(
				planeRueckschreiben(notiz.inhalt, slot, stunde, pfad) ?? {
					art: "unveraendert",
					pfad,
					grund: "nur Vault geändert — nichts davon gehört zum Rückkanal",
				},
			);
			continue;
		}

		const eigenerTeil = extractOwnSection(splitNote(notiz.inhalt).body);
		const neu = baueStundennotiz(zuordnung, slot, unit, stunde, serverHash, eigenerTeil);
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

	begrenzeRueckschreibungen(ops);

	return {
		gruppe: zuordnung.groupId,
		ops: ordneKollisionsfrei(ops, new Set(vorhanden.map((n) => n.pfad))),
	};
}

/**
 * Über der Grenze wird zurückgehalten, nicht verworfen: Die Vault-Änderung bleibt stehen
 * und kommt beim nächsten Lauf dran. Kein Dialog mitten im Sync — der läuft auch im
 * Intervall, ohne dass jemand davor sitzt.
 */
function begrenzeRueckschreibungen(ops: SyncOp[]): void {
	let gezaehlt = 0;
	for (const op of ops) {
		if (op.art !== "zurueckschreiben") continue;
		if (++gezaehlt <= RUECKSCHREIBUNGEN_JE_LAUF) continue;
		op.art = "zurueckgehalten";
		op.grund = `mehr als ${RUECKSCHREIBUNGEN_JE_LAUF} Rückschreibungen in einem Lauf — kommt beim nächsten`;
		delete op.rueckkanal;
	}
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
function serverNutzlast(slot: SlotRead, unit: UnitRead | undefined, stunde: Stundenknoten | undefined) {
	return {
		format: NOTIZFORMAT,
		date: slot.date,
		start_period: slot.start_period,
		periods: slot.periods,
		kategorie: slot.kategorie,
		thema: slot.thema,
		note: slot.note,
		// `hat_phasen` heißt auf der Plattform „Phasenliste nicht leer". Aus den Phasen
		// abgeleitet, lässt es sich nach dem Zurückschreiben genau vorhersagen.
		hat_phasen: stunde ? stunde.phasen.length > 0 : slot.hat_phasen,
		ablauf: stunde ? rendereAblauf(stunde.phasen) : null,
		nachbereitet_at: slot.nachbereitet_at,
		ue_node_id: slot.ue_node_id,
		stunde_node_id: slot.stunde_node_id,
		ue_titel: unit?.title ?? null,
		stundenziel: stundenziel(stunde),
	};
}

/**
 * Das Stundenziel, wie es in Notiz und Hash steht. Leer ist leer — ein Knoten mit
 * Leerzeichen als Ziel soll nicht anders aussehen als einer ohne.
 */
function stundenziel(stunde: Stundenknoten | undefined): string | null {
	return stunde?.stundenziel?.trim() || null;
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

export function baueStundennotiz(
	zuordnung: GruppenZuordnung,
	slot: SlotRead,
	unit: UnitRead | undefined,
	stunde: Stundenknoten | undefined,
	serverHash: string,
	eigenerTeil: string,
): string {
	const felder: Record<string, FrontmatterValue> = {
		Kategorien: ["[[UStunden]]"],
		Lehrauftrag: `[[${lehrauftragName(zuordnung)}]]`,
		UEinheit: unit ? `[[${slugify(unit.title)}]]` : null,
		Datum: slot.date,
		UArt: kategorieZuUArt(slot.kategorie),
		UStand: slotZuUStand(slot, stunde?.phasen),
		Stundenziel: stundenziel(stunde),
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

	// Lehrauftrag, Datum und die Links zu den Nachbarstunden zeichnet das Plugin zur
	// Anzeigezeit (`src/kopf.ts`). In der Notiz steht nur der leere Codeblock: Nachbarlinks
	// im Text müsste der Sync bei jeder Verschiebung in bis zu drei Notizen nachziehen.
	const kopf = ["```" + KOPF_SPRACHE, "```"].join("\n");

	const eigen = eigenerTeil.trim() || VAULT_UEBERSCHRIFT;

	// Kein Meta-Bind-Feld mehr: `UArt` und `UStand` gehören der Plattform. Ein Auswahlfeld
	// lüde dazu ein, sie im Vault zu ändern — und jede solche Änderung wäre beim nächsten
	// Serverstand ein Konflikt.
	const rumpf = [
		kopf,
		"",
		...(slot.note?.trim() ? ["## Hinweise", slot.note.trim(), ""] : []),
		"## Ablauf",
		...(stunde
			? rendereAblauf(stunde.phasen)
			: slot.stunde_node_id
				? ["_Der Entwurf liegt auf der Plattform, ist hier aber nicht lesbar._"]
				: ["1."]),
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
 * Die Frontmatter-Felder, die das Plugin in eine Stundennotiz schreibt — und nur die zählen
 * für den Vault-Hash. Ein Tag oder eine eigene Eigenschaft, die jemand im Vault ergänzt,
 * macht die Notiz deshalb nicht „geändert". Muss zu `baueStundennotiz` passen; ein Test
 * hält das fest.
 */
export const STUNDEN_FELDER = [
	"Kategorien",
	"Lehrauftrag",
	"UEinheit",
	"Datum",
	"UArt",
	"UStand",
	"Stundenziel",
	"Inhalte",
	"UStunden",
	"uplan_slot_id",
	"uplan_node_id",
	"uplan_group_id",
	"uplan_updated_at",
	"uplan_server_hash",
	"uplan_hash",
	"uplan_status",
] as const;

/** Versionsmarke des Strukturhashs. Ein Hash ohne Marke stammt von der Textformel davor. */
const STRUKTUR = "s1:";

interface Struktur {
	felder: Record<string, string | string[]>;
	rumpf: string;
	ablauf: VaultPhase[] | null;
}

/**
 * Was in der Plattform-Region steht, als Struktur statt als Text: die eigenen
 * Frontmatter-Felder gelesen statt abgeschrieben, der Rumpf ohne den Ablauf, und der Ablauf
 * geparst. Obsidian richtet Tabellen neu aus und schreibt Eigenschaften in eigener Form —
 * ein Texthash hielte das für eine Änderung.
 */
function struktur(inhalt: string): Struktur {
	const { frontmatter, body } = splitNote(plattformRegion(inhalt));
	const gelesen = readFelder(frontmatter);
	const felder: Record<string, string | string[]> = {};
	for (const key of STUNDEN_FELDER) {
		const wert = gelesen[key];
		if (key === "uplan_hash" || wert === undefined) continue;
		felder[key] = typeof wert === "string" ? wert.trim() : wert;
	}
	const abschnitt = ablaufAbschnitt(body);
	const zeilen = body.split("\n");
	const rumpf = abschnitt
		? [...zeilen.slice(0, abschnitt.start + 1), "§ablauf§", ...zeilen.slice(abschnitt.ende)].join("\n")
		: body;
	return { felder, rumpf: rumpf.trimEnd(), ablauf: leseAblauf(body)?.phasen ?? null };
}

/**
 * Der Vault-Hash: nur über die Plattform-Region — hinter `REGION_ENDE` liegt nichts, was
 * der Sync überschreiben könnte — und über ihre Struktur, nicht ihren Text.
 */
export function hashPlattformRegion(inhalt: string): string {
	return STRUKTUR + hashObject(struktur(inhalt));
}

/**
 * Die Textformel bis AP5: Region als Text, ohne die `uplan_hash`-Zeile. Ohne Marker ist die
 * Region die ganze Datei — derselbe Hash wie vor AP1.
 */
function textHash(inhalt: string): string {
	return hashObject(plattformRegion(inhalt).replace(/^uplan_hash:.*$/m, "uplan_hash:"));
}

/**
 * Passt der gespeicherte Hash zur Notiz? Ein Hash ohne Versionsmarke stammt von der
 * Textformel und wird nach ihr geprüft — sonst gälte jede bestehende Notiz nach dem
 * Umstieg als vault-geändert und jede Serveränderung als Konflikt. Ohne Hash gilt die
 * Notiz als unverändert, wie bisher.
 */
function vaultHashPasst(gespeichert: string | undefined, inhalt: string): boolean {
	if (gespeichert === undefined) return true;
	return gespeichert.startsWith(STRUKTUR)
		? gespeichert === hashPlattformRegion(inhalt)
		: gespeichert === textHash(inhalt);
}

// ── Rückkanal ────────────────────────────────────────────────────────────────

function zurueckgehalten(pfad: string, grund: string): SyncOp {
	return { art: "zurueckgehalten", pfad, grund };
}

/**
 * Was aus einer vault-geänderten Notiz zur Plattform geht — nur gerufen, wenn sich der
 * Serverstand seit dem letzten Lauf nicht bewegt hat. Dann ist der aktuelle Phasenstand der
 * Plattform genau die Basis, aus der die Notiz gerendert wurde, und die Vault-Zeilen lassen
 * sich ihm zuordnen.
 *
 * Zwei Ziele: Ablauf und Stundenziel gehen an den Entwurf, `Inhalte` an den Termin (das
 * Thema des Slots). Zurückgehalten wird nur, was den Entwurf betrifft — ein Thema lässt
 * sich auch dann schreiben, wenn der Entwurf nicht lesbar ist.
 *
 * `null`, wenn nichts davon dem Rückkanal gehört — dann war es eine Änderung an einem
 * read-only Feld, und die bleibt als Vault-Änderung stehen.
 */
function planeRueckschreiben(
	inhalt: string,
	slot: SlotRead,
	stunde: Stundenknoten | undefined,
	pfad: string,
): SyncOp | null {
	const { frontmatter, body } = splitNote(plattformRegion(inhalt));
	const ablauf = leseAblauf(body);
	const serverPhasen = stunde?.phasen ?? [];
	const phasen = ablauf ? mischePhasen(serverPhasen, ablauf.phasen) : null;
	const phasenNeu = phasen !== null && !gleichePhasen(phasen, serverPhasen.map(nutzlast));

	const felder = readFelder(frontmatter);
	const text = (key: string) => {
		const wert = felder[key];
		return typeof wert === "string" ? wert.trim() : "";
	};
	const ziel = text("Stundenziel");
	const zielNeu = ziel !== (stunde?.stundenziel ?? "").trim();
	const thema = text("Inhalte");
	const themaNeu = thema !== (slot.thema ?? "").trim();
	const entwurfNeu = phasenNeu || zielNeu;

	if (!entwurfNeu && !themaNeu && !ablauf?.fehler.length) return null;
	if (entwurfNeu || ablauf?.fehler.length) {
		if (slot.stunde_node_id && !stunde) return zurueckgehalten(pfad, "Entwurf auf der Plattform nicht lesbar");
		if (ablauf && ablauf.fehler.length > 0) return zurueckgehalten(pfad, ablauf.fehler.join("; "));
		if (stunde?.darf_schreiben === false) return zurueckgehalten(pfad, "Entwurf ist auf der Plattform nur lesbar");
	}

	const rueckkanal: Rueckkanal = { slotId: slot.id, knotenId: slot.stunde_node_id, vaultAblauf: ablauf?.phasen ?? null };
	if (entwurfNeu) {
		const nutzlastNeu: LessonUpdate = {};
		if (phasenNeu) nutzlastNeu.phasen = phasen;
		// Ein leerer String leert das Stundenziel; `null` ließe es stehen.
		if (zielNeu) nutzlastNeu.stundenziel = ziel;
		if (stunde?.updated_at) nutzlastNeu.expected_updated_at = stunde.updated_at;
		rueckkanal.stunde = nutzlastNeu;
	}
	if (themaNeu) {
		// Hier umgekehrt: `null` leert das Thema, die Plattform setzt nur, was mitkommt.
		rueckkanal.termin = { thema: thema || null, expected_updated_at: slot.updated_at };
	}

	const was = [
		...(entwurfNeu && !slot.stunde_node_id ? ["neuer Entwurf"] : []),
		...(phasenNeu ? [`${phasen?.length ?? 0} Phasen`] : []),
		...(zielNeu ? ["Stundenziel"] : []),
		...(themaNeu ? ["Inhalte"] : []),
	];
	return { art: "zurueckschreiben", pfad, rueckkanal, grund: was.join(", ") };
}

export interface NachDemZurueckschreiben {
	zuordnung: GruppenZuordnung;
	overview: OverviewRead;
	/** Die Notiz, wie sie jetzt in der Datei steht. */
	inhalt: string;
	slotId: string;
	/**
	 * Der Entwurf nach dem Schreiben — aus der Antwort der Plattform (0.13, P3). Wurde nur
	 * das Thema geschrieben, der Entwurf, wie er beim Lesen war.
	 */
	stunde?: Stundenknoten;
	/** Thema und Stempel des Termins nach dem Schreiben, falls `Inhalte` mitging. */
	termin?: { thema: string | null; updated_at: string };
	/** Der Ablauf, wie er beim Planen im Vault stand (`Rueckkanal.vaultAblauf`). */
	vaultAblauf: unknown;
}

/**
 * Die Notiz nach einem erfolgreichen Zurückschreiben. Der Rumpf bleibt, wie er ist — eine
 * Liste bleibt eine Liste; neu gerendert wird erst, wenn sich auf der Plattform etwas
 * ändert. Gesetzt werden nur die Buchführungsfelder.
 *
 * Der neue `uplan_hash` entsteht aus der Notiz, wie sie aus dem Serverstand gerendert
 * würde, mit dem Ablauf aus dem Vault. Stimmt der Rest der Notiz damit überein, ist sie
 * danach unverändert. Hat jemand ein read-only Feld geändert (etwa `UArt`), bleibt das
 * als Vault-Änderung sichtbar, statt eingemeindet und beim nächsten Serverstand still
 * überschrieben zu werden.
 *
 * Aus der Antwort auf das Termin-PATCH zählen nur `thema` und `updated_at` — `hat_phasen`
 * berechnet dort niemand.
 */
export function nachDemZurueckschreiben(args: NachDemZurueckschreiben): string {
	const vorher = args.overview.slots.find((s) => s.id === args.slotId);
	if (!vorher) return args.inhalt;
	const slot: SlotRead = {
		...vorher,
		...(args.termin ? { thema: args.termin.thema, updated_at: args.termin.updated_at } : {}),
		stunde_node_id: args.stunde?.id ?? vorher.stunde_node_id,
	};
	const unit = slot.ue_node_id ? args.overview.units.find((u) => u.id === slot.ue_node_id) : undefined;
	const serverHash = hashObject(serverNutzlast(slot, unit, args.stunde));
	const ideal = struktur(baueStundennotiz(args.zuordnung, slot, unit, args.stunde, serverHash, ""));
	const felder: Record<string, string | null> = {
		UStand: slotZuUStand(slot, args.stunde?.phasen),
		uplan_updated_at: slot.updated_at,
		uplan_server_hash: serverHash,
		uplan_hash: STRUKTUR + hashObject({ ...ideal, ablauf: args.vaultAblauf ?? null }),
	};
	if (args.stunde) felder["uplan_node_id"] = args.stunde.id;
	return setzeFelder(args.inhalt, felder);
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

/** Felder im Frontmatter, die der Vault zurückschreiben darf — und die ein Konflikt deshalb retten muss. */
const RUECKKANAL_FELDER = ["Inhalte", "Stundenziel"] as const;

/**
 * Gerettet wird nur, was der neue Stand überschreibt: der alte Plattform-Teil des Rumpfs
 * und die Frontmatter-Felder, die der Vault beschreiben darf. Der eigene Abschnitt hinter
 * `REGION_ENDE` bleibt ohnehin erhalten — ihn auch in den Block zu kopieren hieße, ihn
 * doppelt in der Notiz stehen zu haben.
 */
function mitKonfliktblock(neu: string, alt: string): string {
	const { frontmatter, body } = splitNote(plattformRegion(alt));
	const gelesen = readFelder(frontmatter);
	const felder: Record<string, FrontmatterValue> = {};
	for (const key of RUECKKANAL_FELDER) {
		const wert = gelesen[key];
		if (typeof wert === "string" && wert.trim() !== "") felder[key] = wert;
	}
	const kopf = Object.keys(felder).length > 0 ? `${renderFrontmatter(felder).split("\n").slice(1, -1).join("\n")}\n\n` : "";
	const gerettet = `${kopf}${body.trim()}`;
	const zaun = "`".repeat(laengsterZaun(gerettet) + 1);
	return `${neu.trimEnd()}\n\n> [!warning] Sync-Konflikt\n> Die Plattform hatte den neueren Stand. Die vorherige Vault-Fassung steht unten und wird beim nächsten Sync nicht angefasst.\n\n${zaun}markdown\n${gerettet}\n${zaun}\n`;
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
