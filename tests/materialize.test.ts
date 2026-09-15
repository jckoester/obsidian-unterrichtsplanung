import { describe, expect, it } from "vitest";
import overview from "../fixtures/overview-group1.json";
import type { OverviewRead } from "../src/api/types";
import { MARKER_UEBERSCHRIFT } from "../src/sync/frontmatter";
import {
	materialize,
	STANDARD_DATEIMUSTER,
	ZuordnungFehler,
	type GruppenZuordnung,
} from "../src/sync/materialize";

const zuordnung: GruppenZuordnung = {
	groupId: 1,
	lehrauftragLink: "",
	fach: "NwT",
	stufe: 9,
	ordner: "Bereiche/11 Unterricht/NwT 9",
	stundenOrdner: "Unterrichtsstunden",
	dateiMuster: STANDARD_DATEIMUSTER,
};

const stand = overview as unknown as OverviewRead;

function ersterLauf() {
	return materialize({ zuordnung, overview: stand, vorhanden: [] });
}

const STUNDEN = "Bereiche/11 Unterricht/NwT 9/Unterrichtsstunden";

/** Nur die Stundennotizen — der Plan enthält jetzt auch Lehrauftrag und UE. */
function stundenOps(plan: ReturnType<typeof ersterLauf>) {
	return plan.ops.filter((o) => o.pfad.startsWith(STUNDEN));
}

function alsVorhanden(plan: ReturnType<typeof ersterLauf>) {
	return plan.ops
		.filter((o) => o.inhalt)
		.map((o) => ({ pfad: o.pfad, inhalt: o.inhalt as string }));
}

function stunde(vorhanden: { pfad: string; inhalt: string }[], nr: number) {
	const treffer = vorhanden.find((v) => v.pfad.includes(`Stunde ${nr}`));
	if (!treffer) throw new Error(`Stunde ${nr} nicht im Plan`);
	return treffer;
}

/** Erster Lauf, dann beidseitige Änderung — der Ausgangspunkt beider Konflikt-Tests. */
function konfliktLauf() {
	const vorhanden = alsVorhanden(ersterLauf());
	const eins = stunde(vorhanden, 1);
	eins.inhalt = eins.inhalt.replace(
		MARKER_UEBERSCHRIFT,
		`${MARKER_UEBERSCHRIFT}\nMaterial liegt im Schrank.`,
	);
	const serverstand = structuredClone(stand);
	serverstand.slots[0]!.thema = "Getriebe, zweitens";
	const konflikt = materialize({ zuordnung, overview: serverstand, vorhanden }).ops.find(
		(o) => o.art === "konflikt",
	);
	if (!konflikt) throw new Error("kein Konflikt im Plan");
	return { konflikt, serverstand, vorhanden };
}

describe("materialize", () => {
	it("legt für jeden Slot genau eine Notiz an", () => {
		const plan = ersterLauf();
		expect(stundenOps(plan).filter((o) => o.art === "erstellen")).toHaveLength(2);
		expect(stundenOps(plan)[0]?.pfad).toBe(`${STUNDEN}/NwT 9 Stunde 1.md`);
	});

	it("nummeriert chronologisch und übersetzt die Kategorie", () => {
		const plan = ersterLauf();
		const zweite = stundenOps(plan)[1]?.inhalt ?? "";
		expect(zweite).toContain("# Stunde 2 - 22.09.2026");
		expect(zweite).toContain("🟣 Prüfung");
		expect(zweite).toContain('UEinheit: "[[UE1 - Mechanische Übertragung]]"');
	});

	it("ist idempotent — zweiter Lauf ändert nichts", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const zweit = materialize({ zuordnung, overview: stand, vorhanden });
		expect(zweit.ops.every((o) => o.art === "unveraendert")).toBe(true);
	});

	it("erkennt eine Änderung auf der Plattform", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const geaendert = structuredClone(stand);
		geaendert.slots[0]!.thema = "Getriebe, Teil 2";
		const zweit = materialize({ zuordnung, overview: geaendert, vorhanden });
		expect(zweit.ops.filter((o) => o.art === "aktualisieren")).toHaveLength(1);
	});

	it("meldet beidseitige Änderung als Konflikt und rettet die Vault-Fassung", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const eins = stunde(vorhanden, 1);
		eins.inhalt = eins.inhalt.replace("## Verlauf", "## Verlauf\n1. Von Hand ergänzt");
		const geaendert = structuredClone(stand);
		geaendert.slots[0]!.thema = "Getriebe, Teil 2";
		const zweit = materialize({ zuordnung, overview: geaendert, vorhanden });
		const konflikt = zweit.ops.find((o) => o.art === "konflikt");
		expect(konflikt).toBeDefined();
		expect(konflikt?.inhalt).toContain("Von Hand ergänzt");
		expect(konflikt?.inhalt).toContain("Sync-Konflikt");
	});

	it("bewahrt den vault-eigenen Abschnitt bei Aktualisierung", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		stunde(vorhanden, 1).inhalt = stunde(vorhanden, 1).inhalt.replace(
			MARKER_UEBERSCHRIFT,
			`${MARKER_UEBERSCHRIFT}\nMaterial liegt im Schrank.`,
		);
		const geaendert = structuredClone(stand);
		geaendert.slots[0]!.thema = "Getriebe, Teil 2";
		const op = materialize({ zuordnung, overview: geaendert, vorhanden }).ops.find((o) =>
			o.pfad.includes("Stunde 1"),
		);
		expect(op?.inhalt).toContain("Material liegt im Schrank.");
	});

	it("archiviert statt zu löschen, wenn ein Slot verschwindet", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const geschrumpft = structuredClone(stand);
		geschrumpft.slots = [geschrumpft.slots[0]!];
		const plan = materialize({ zuordnung, overview: geschrumpft, vorhanden });
		const archiv = plan.ops.find((o) => o.art === "archivieren");
		expect(archiv?.inhalt).toContain("uplan_status: archiviert");
		expect(archiv?.pfad).toContain("Stunde 2");
		expect(plan.ops.some((o) => o.art === "erstellen")).toBe(false);
	});

	it("gibt beim Archivieren den Dateinamen frei", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const geschrumpft = structuredClone(stand);
		geschrumpft.slots = [geschrumpft.slots[1]!]; // die erste Stunde fällt weg
		const plan = materialize({ zuordnung, overview: geschrumpft, vorhanden });

		const archiv = plan.ops.find((o) => o.art === "archivieren");
		expect(archiv?.pfad).toBe(`${STUNDEN}/NwT 9 Stunde 1 (archiviert 2026-09-15).md`);

		// … und die überlebende Stunde rückt auf den frei gewordenen Namen auf.
		const aufrueckend = plan.ops.findIndex(
			(o) => o.art === "umbenennen" && o.pfad === `${STUNDEN}/NwT 9 Stunde 1.md`,
		);
		const freigebend = plan.ops.findIndex(
			(o) => o.art === "umbenennen" && o.pfad.includes("(archiviert"),
		);
		expect(freigebend).toBeGreaterThanOrEqual(0);
		expect(freigebend).toBeLessThan(aufrueckend);
	});

	it("archiviert eine Einheit, die auf der Plattform verschwindet", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const ohneEinheit = structuredClone(stand);
		ohneEinheit.units = [];
		for (const slot of ohneEinheit.slots) slot.ue_node_id = null;
		const plan = materialize({ zuordnung, overview: ohneEinheit, vorhanden });

		const archiv = plan.ops.find((o) => o.art === "archivieren");
		expect(archiv?.pfad).toContain("UE1 - Mechanische Übertragung.md");
		expect(archiv?.inhalt).toContain("uplan_status: archiviert");
		// Der Ordner bleibt, wo er ist — darin liegt das Material.
		expect(plan.ops.some((o) => o.art === "umbenennen")).toBe(false);
	});

	it("lässt eine Konfliktnotiz beim nächsten Lauf in Ruhe", () => {
		const { konflikt, serverstand, vorhanden } = konfliktLauf();
		const danach = vorhanden.map((v) =>
			v.pfad === konflikt.pfad ? { pfad: v.pfad, inhalt: konflikt.inhalt as string } : v,
		);
		const zweit = materialize({ zuordnung, overview: serverstand, vorhanden: danach });
		const op = zweit.ops.find((o) => o.pfad === konflikt.pfad);
		expect(op?.art).toBe("unveraendert");
		// Kein „nur Vault geändert": Der Hash steht über der fertigen Notiz, samt Block.
		expect(op?.grund).toBeUndefined();
	});

	it("schachtelt Codezäune nicht ineinander", () => {
		const { konflikt, serverstand, vorhanden } = konfliktLauf();
		const danach = vorhanden.map((v) =>
			v.pfad === konflikt.pfad
				? { pfad: v.pfad, inhalt: `${konflikt.inhalt as string}\nUnd noch etwas.\n` }
				: v,
		);
		const nochmal = structuredClone(serverstand);
		nochmal.slots[0]!.thema = "Getriebe, drittens";
		const zweiter = materialize({ zuordnung, overview: nochmal, vorhanden: danach }).ops.find(
			(o) => o.art === "konflikt",
		);
		expect(zweiter?.inhalt).toContain("````markdown");
		expect(zweiter?.inhalt).toContain("```markdown");
	});

	it("benennt um statt zu duplizieren, wenn sich das Datum verschiebt", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const getauscht = structuredClone(stand);
		getauscht.slots[0]!.date = "2026-09-29"; // rutscht hinter den zweiten Slot
		const plan = materialize({ zuordnung, overview: getauscht, vorhanden });
		expect(plan.ops.filter((o) => o.art === "umbenennen").length).toBeGreaterThan(0);
		expect(plan.ops.some((o) => o.art === "erstellen")).toBe(false);
	});
});

describe("pruefeZuordnung", () => {
	it("weigert sich bei leerem Ordner, statt irgendwohin zu schreiben", () => {
		expect(() =>
			materialize({
				zuordnung: { ...zuordnung, ordner: "" },
				overview: stand,
				vorhanden: [],
			}),
		).toThrow(ZuordnungFehler);
	});

	it("weigert sich ohne group_id", () => {
		expect(() =>
			materialize({
				zuordnung: { ...zuordnung, groupId: 0 },
				overview: stand,
				vorhanden: [],
			}),
		).toThrow(ZuordnungFehler);
	});

	// Früher war der Link Pflicht. Seit der Name aus dem Ordner fällt, ist ein leeres
	// Feld der Normalfall — der Test hält fest, was gilt, statt was einmal galt.
	it("nimmt einen leeren Lehrauftrag-Link hin — dann gilt der Ordnername", () => {
		const plan = materialize({
			zuordnung: { ...zuordnung, lehrauftragLink: "" },
			overview: stand,
			vorhanden: [],
		});
		expect(plan.ops.some((o) => o.pfad === "Bereiche/11 Unterricht/NwT 9/NwT 9.md")).toBe(true);
	});
});
