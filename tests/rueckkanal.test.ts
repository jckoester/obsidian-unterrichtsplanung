import { describe, expect, it } from "vitest";
import overview from "../fixtures/overview-group1.json";
import type { OverviewRead, SlotRead } from "../src/api/types";
import { readFelder, splitNote } from "../src/sync/frontmatter";
import {
	materialize,
	nachDemZurueckschreiben,
	RUECKSCHREIBUNGEN_JE_LAUF,
	STUNDEN_FELDER,
	type GruppenZuordnung,
	type Stundenknoten,
} from "../src/sync/materialize";
import { normalisierePhasen } from "../src/sync/phasen";
import type { SyncPlan } from "../src/sync/plan";

const zuordnung: GruppenZuordnung = {
	groupId: 1,
	lehrauftragLink: "",
	fach: "NwT",
	stufe: 9,
	ordner: "Bereiche/11 Unterricht/NwT 9",
	stundenOrdner: "Unterrichtsstunden",
};

const stand = overview as unknown as OverviewRead;
const STUNDEN = "Bereiche/11 Unterricht/NwT 9/Unterrichtsstunden";
const ERSTE = `${STUNDEN}/NwT 9 2026-09-15.md`;
const ZWEITE = `${STUNDEN}/NwT 9 2026-09-22.md`;
const B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const STEMPEL = "2026-09-10T12:00:00.123456Z";

const SKIZZE = [
	{ id: "p1", name: "Einstieg", dauer_min: 5 },
	{ id: "p2", name: "Erarbeitung", dauer_min: 25 },
];
const TABELLE = [
	{ id: "p1", name: "Einstieg", dauer_min: 5, prio: "kern", beschreibung: "Video zeigen" },
	{ id: "p2", name: "Erarbeitung", dauer_min: 25, prio: "uebung", material: [{ typ: "text", wert: "AB" }] },
];

function knotenB(phasen: unknown[] = SKIZZE, extra: Partial<Stundenknoten> = {}): Stundenknoten {
	return {
		id: B,
		stundenziel: "Übersetzungen berechnen",
		phasen: normalisierePhasen(phasen),
		updated_at: STEMPEL,
		darf_schreiben: true,
		...extra,
	};
}

type Notiz = { pfad: string; inhalt: string };

function lauf(vorhanden: Notiz[], knoten: Stundenknoten[] = [knotenB()], serverstand: OverviewRead = stand) {
	return materialize({ zuordnung, overview: serverstand, vorhanden, stundenknoten: knoten });
}

function alsVorhanden(plan: SyncPlan): Notiz[] {
	return plan.ops.filter((o) => o.inhalt).map((o) => ({ pfad: o.pfad, inhalt: o.inhalt as string }));
}

function notiz(vorhanden: Notiz[], pfad: string): Notiz {
	const n = vorhanden.find((v) => v.pfad === pfad);
	if (!n) throw new Error(`${pfad} fehlt`);
	return n;
}

function bearbeite(vorhanden: Notiz[], pfad: string, alt: string, neu: string) {
	const n = notiz(vorhanden, pfad);
	expect(n.inhalt).toContain(alt);
	n.inhalt = n.inhalt.replace(alt, neu);
}

function opFuer(plan: SyncPlan, pfad: string) {
	return plan.ops.find((o) => o.pfad === pfad && o.art !== "umbenennen");
}

describe("Rückkanal — planen", () => {
	it("spiegelt die Phasen als Liste, solange sie nur Name und Dauer tragen", () => {
		const n = notiz(alsVorhanden(lauf([])), ZWEITE);
		expect(n.inhalt).toContain("## Ablauf\n1. Einstieg (5 min)\n2. Erarbeitung (25 min)\n");
	});

	it("schreibt eine geänderte Skizze zurück — mit Kennungen, Stempel und nur dem, was sich änderte", () => {
		const vorhanden = alsVorhanden(lauf([]));
		bearbeite(vorhanden, ZWEITE, "2. Erarbeitung (25 min)", "2. Erarbeitung (20 min)\n3. Sicherung");
		const op = opFuer(lauf(vorhanden), ZWEITE);

		expect(op?.art).toBe("zurueckschreiben");
		expect(op?.rueckkanal?.knotenId).toBe(B);
		expect(op?.rueckkanal?.stunde?.expected_updated_at).toBe(STEMPEL);
		expect(op?.rueckkanal?.stunde?.phasen?.map((p) => [p.id, p.name, p.dauer_min])).toEqual([
			["p1", "Einstieg", 5],
			["p2", "Erarbeitung", 20],
			[null, "Sicherung", null],
		]);
		expect(op?.rueckkanal?.stunde).not.toHaveProperty("stundenziel");
	});

	it("schreibt ein geändertes Stundenziel zurück, ohne die Phasen anzufassen", () => {
		const vorhanden = alsVorhanden(lauf([]));
		bearbeite(vorhanden, ZWEITE, "Stundenziel: Übersetzungen berechnen", "Stundenziel: Übersetzungen sicher berechnen");
		const op = opFuer(lauf(vorhanden), ZWEITE);
		expect(op?.rueckkanal?.stunde).toEqual({ stundenziel: "Übersetzungen sicher berechnen", expected_updated_at: STEMPEL });
	});

	it("schreibt geänderte Inhalte an den Termin, mit dessen Stempel", () => {
		const vorhanden = alsVorhanden(lauf([]));
		bearbeite(vorhanden, ZWEITE, "Inhalte: Klassenarbeit 1", "Inhalte: Klassenarbeit 1 — Getriebe");
		const op = opFuer(lauf(vorhanden), ZWEITE);
		expect(op?.art).toBe("zurueckschreiben");
		expect(op?.rueckkanal?.termin).toEqual({ thema: "Klassenarbeit 1 — Getriebe", expected_updated_at: stand.slots[1]!.updated_at });
		expect(op?.rueckkanal?.stunde).toBeUndefined();
		expect(op?.grund).toBe("Inhalte");
	});

	it("leert das Thema mit null, wenn Inhalte leer werden", () => {
		const vorhanden = alsVorhanden(lauf([]));
		bearbeite(vorhanden, ZWEITE, "Inhalte: Klassenarbeit 1", "Inhalte:");
		expect(opFuer(lauf(vorhanden), ZWEITE)?.rueckkanal?.termin?.thema).toBeNull();
	});

	it("schreibt Inhalte auch an einen Platzhalter, ohne einen Entwurf anzulegen", () => {
		const vorhanden = alsVorhanden(lauf([]));
		bearbeite(vorhanden, ERSTE, "Inhalte: Getriebe und Übersetzung", "Inhalte: Getriebe im Alltag");
		const op = opFuer(lauf(vorhanden), ERSTE);
		expect(op?.rueckkanal?.termin?.thema).toBe("Getriebe im Alltag");
		expect(op?.rueckkanal?.stunde).toBeUndefined();
		expect(op?.grund).not.toContain("neuer Entwurf");
	});

	it("legt für einen gefüllten Platzhalter einen Entwurf an", () => {
		const vorhanden = alsVorhanden(lauf([]));
		bearbeite(vorhanden, ERSTE, "## Ablauf\n1.", "## Ablauf\n1. Einstieg (10 min)");
		const op = opFuer(lauf(vorhanden), ERSTE);
		expect(op?.art).toBe("zurueckschreiben");
		expect(op?.rueckkanal?.knotenId).toBeNull();
		expect(op?.grund).toContain("neuer Entwurf");
		expect(op?.rueckkanal?.stunde).not.toHaveProperty("expected_updated_at");
	});

	it("lässt eine Änderung an einem read-only Feld als Vault-Änderung stehen", () => {
		const vorhanden = alsVorhanden(lauf([]));
		bearbeite(vorhanden, ZWEITE, "UArt: Prüfung", "UArt: Unterricht");
		const op = opFuer(lauf(vorhanden), ZWEITE);
		expect(op?.art).toBe("unveraendert");
		expect(op?.grund).toContain("nichts davon gehört zum Rückkanal");
	});

	it("hält eine eigene Eigenschaft im Frontmatter nicht für eine Änderung", () => {
		const vorhanden = alsVorhanden(lauf([]));
		bearbeite(vorhanden, ZWEITE, "uplan_status: aktiv", "uplan_status: aktiv\ntags:\n  - wichtig");
		const op = opFuer(lauf(vorhanden), ZWEITE);
		expect(op?.art).toBe("unveraendert");
		expect(op?.grund).toBeUndefined();
	});

	it("hält eine neu ausgerichtete Tabelle nicht für eine Änderung", () => {
		const vorhanden = alsVorhanden(lauf([], [knotenB(TABELLE)]));
		const n = notiz(vorhanden, ZWEITE);
		expect(n.inhalt).toContain("| Prio | Min | Phase |");
		const vorher = n.inhalt;
		n.inhalt = n.inhalt.replace(/^\|.*\|$/gm, (zeile) => zeile.replace(/ \| /g, "   |   "));
		expect(n.inhalt).not.toBe(vorher);
		const op = opFuer(lauf(vorhanden, [knotenB(TABELLE)]), ZWEITE);
		expect(op?.art).toBe("unveraendert");
		expect(op?.grund).toBeUndefined();
	});

	it("hält zurück, was die Plattform ablehnen würde", () => {
		const vorhanden = alsVorhanden(lauf([], [knotenB(TABELLE)]));
		bearbeite(vorhanden, ZWEITE, "| Übung | 25 |", "| Übung | ca. 20 |");
		const op = opFuer(lauf(vorhanden, [knotenB(TABELLE)]), ZWEITE);
		expect(op?.art).toBe("zurueckgehalten");
		expect(op?.grund).toContain("Dauer „ca. 20“ nicht lesbar");
	});

	it("hält zurück, was auf der Plattform nur lesbar ist", () => {
		const nurLesbar = [knotenB(SKIZZE, { darf_schreiben: false })];
		const vorhanden = alsVorhanden(lauf([], nurLesbar));
		bearbeite(vorhanden, ZWEITE, "(25 min)", "(20 min)");
		expect(opFuer(lauf(vorhanden, nurLesbar), ZWEITE)?.art).toBe("zurueckgehalten");
	});

	it("macht aus einer beidseitigen Änderung einen Konflikt, kein Zurückschreiben", () => {
		const vorhanden = alsVorhanden(lauf([]));
		bearbeite(vorhanden, ZWEITE, "(25 min)", "(20 min)");
		const geaendert = structuredClone(stand);
		geaendert.slots[1]!.thema = "Klassenarbeit 1 (verlegt)";
		expect(opFuer(lauf(vorhanden, [knotenB()], geaendert), ZWEITE)?.art).toBe("konflikt");
	});

	it(`schreibt höchstens ${RUECKSCHREIBUNGEN_JE_LAUF} Stunden je Lauf zurück, der Rest wartet`, () => {
		const viele = structuredClone(stand);
		const knoten: Stundenknoten[] = [];
		viele.slots = Array.from({ length: RUECKSCHREIBUNGEN_JE_LAUF + 1 }, (_, i) => {
			const id = `knoten-${i}`;
			knoten.push({ ...knotenB(), id });
			return {
				...structuredClone(stand.slots[1] as SlotRead),
				id: `slot-${i}`,
				date: `2026-10-${String(i + 1).padStart(2, "0")}`,
				stunde_node_id: id,
			};
		});
		const vorhanden = alsVorhanden(lauf([], knoten, viele));
		for (const n of vorhanden.filter((v) => v.pfad.startsWith(STUNDEN))) n.inhalt = n.inhalt.replace("(25 min)", "(20 min)");
		const plan = lauf(vorhanden, knoten, viele);
		expect(plan.ops.filter((o) => o.art === "zurueckschreiben")).toHaveLength(RUECKSCHREIBUNGEN_JE_LAUF);
		expect(plan.ops.filter((o) => o.art === "zurueckgehalten")).toHaveLength(1);
	});
});

describe("Rückkanal — nach dem Schreiben", () => {
	/** Was die Plattform aus der Nutzlast macht: speichern, neuen Phasen Kennungen geben. */
	function gespeichert(phasen: unknown[] | undefined, extra: Partial<Stundenknoten> = {}): Stundenknoten {
		const mitIds = (phasen ?? []).map((p, i) => ({ ...(p as object), id: (p as { id: string | null }).id ?? `neu-${i}` }));
		return knotenB(mitIds, { updated_at: "2026-10-03T19:49:20.811852Z", ...extra });
	}

	function schreibeUndPruefe(vorhanden: Notiz[]) {
		const op = opFuer(lauf(vorhanden), ZWEITE);
		const nachher = gespeichert(op?.rueckkanal?.stunde?.phasen);
		const n = notiz(vorhanden, ZWEITE);
		n.inhalt = nachDemZurueckschreiben({
			zuordnung,
			overview: stand,
			inhalt: n.inhalt,
			slotId: stand.slots[1]!.id,
			stunde: nachher,
			vaultAblauf: op?.rueckkanal?.vaultAblauf,
		});
		return { n, nachher };
	}

	it("lässt den Rumpf stehen — eine Liste mit Inhalt bleibt eine Liste — und der nächste Lauf ist ruhig", () => {
		const vorhanden = alsVorhanden(lauf([]));
		bearbeite(vorhanden, ZWEITE, "2. Erarbeitung (25 min)", "2. Erarbeitung (25 min)\n3. Sicherung\n   Ergebnisse vergleichen");
		const { n, nachher } = schreibeUndPruefe(vorhanden);

		expect(n.inhalt).toContain("3. Sicherung\n   Ergebnisse vergleichen");
		expect(n.inhalt).toContain("UStand: Skizze"); // Sicherung hat keine Dauer
		const zweit = opFuer(lauf(vorhanden, [nachher]), ZWEITE);
		expect(zweit?.art).toBe("unveraendert");
		expect(zweit?.grund).toBeUndefined();
	});

	it("gemeindet eine Änderung an einem read-only Feld nicht ein", () => {
		const vorhanden = alsVorhanden(lauf([]));
		bearbeite(vorhanden, ZWEITE, "(25 min)", "(20 min)");
		bearbeite(vorhanden, ZWEITE, "UArt: Prüfung", "UArt: Unterricht");
		const { nachher } = schreibeUndPruefe(vorhanden);
		const zweit = opFuer(lauf(vorhanden, [nachher]), ZWEITE);
		expect(zweit?.grund).toContain("nichts davon gehört zum Rückkanal");
	});

	it("trägt nach geschriebenen Inhalten den neuen Stempel ein — der nächste Lauf ist ruhig", () => {
		const vorhanden = alsVorhanden(lauf([]));
		bearbeite(vorhanden, ZWEITE, "Inhalte: Klassenarbeit 1", "Inhalte: Klassenarbeit 1 — Getriebe");
		const n = notiz(vorhanden, ZWEITE);
		const vaultAblauf = opFuer(lauf(vorhanden), ZWEITE)?.rueckkanal?.vaultAblauf;
		const neuerStempel = "2026-10-04T08:00:00.000001Z";
		n.inhalt = nachDemZurueckschreiben({
			zuordnung,
			overview: stand,
			inhalt: n.inhalt,
			slotId: stand.slots[1]!.id,
			stunde: knotenB(),
			termin: { thema: "Klassenarbeit 1 — Getriebe", updated_at: neuerStempel },
			vaultAblauf,
		});
		expect(n.inhalt).toContain(`uplan_updated_at: "${neuerStempel}"`);
		const danach = structuredClone(stand);
		danach.slots[1]!.thema = "Klassenarbeit 1 — Getriebe";
		danach.slots[1]!.updated_at = neuerStempel;
		const zweit = opFuer(lauf(vorhanden, [knotenB()], danach), ZWEITE);
		expect(zweit?.art).toBe("unveraendert");
		expect(zweit?.grund).toBeUndefined();
	});

	it("schreibt die Kennung eines neu angelegten Entwurfs in die Notiz", () => {
		const vorhanden = alsVorhanden(lauf([]));
		bearbeite(vorhanden, ERSTE, "## Ablauf\n1.", "## Ablauf\n1. Einstieg (10 min)");
		const neuerKnoten = { ...gespeichert([{ id: null, name: "Einstieg", dauer_min: 10 }]), id: "cccccccc-3333-4333-8333-cccccccccccc", stundenziel: null };
		const n = notiz(vorhanden, ERSTE);
		n.inhalt = nachDemZurueckschreiben({
			zuordnung,
			overview: stand,
			inhalt: n.inhalt,
			slotId: stand.slots[0]!.id,
			stunde: neuerKnoten,
			vaultAblauf: [{ name: "Einstieg", dauer_min: 10 }],
		});
		expect(n.inhalt).toContain(`uplan_node_id: ${neuerKnoten.id}`);
		// Im nächsten Lauf hängt der Entwurf am Slot — und die Notiz ist ruhig.
		const danach = structuredClone(stand);
		danach.slots[0]!.stunde_node_id = neuerKnoten.id;
		expect(opFuer(lauf(vorhanden, [knotenB(), neuerKnoten], danach), ERSTE)?.art).toBe("unveraendert");
	});
});

describe("Notizformat", () => {
	it("schreibt genau die Felder, die der Hash kennt", () => {
		const n = notiz(alsVorhanden(lauf([])), ZWEITE);
		expect(Object.keys(readFelder(splitNote(n.inhalt).frontmatter))).toEqual([...STUNDEN_FELDER]);
	});

	it("streicht gestrichene Phasen durch", () => {
		const gestrichen = [knotenB([{ id: "p1", name: "Einstieg", dauer_min: 5, status: "gestrichen" }])];
		expect(notiz(alsVorhanden(lauf([], gestrichen)), ZWEITE).inhalt).toContain("1. ~~Einstieg~~ (5 min)");
	});
});
