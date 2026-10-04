import { describe, expect, it } from "vitest";
import {
	gleichePhasen,
	leseAblauf,
	mischePhasen,
	normalisierePhasen,
	rendereAblauf,
	type Phase,
	type PhaseNutzlast,
} from "../src/sync/phasen";

function ablauf(zeilen: string[]): string {
	return ["## Ablauf", ...zeilen, ""].join("\n");
}

/** Was die Plattform aus einer Nutzlast macht: Kennungen vergeben, sonst wie geschickt. */
function gespeichert(nutzlast: PhaseNutzlast[]): Phase[] {
	return normalisierePhasen(nutzlast.map((p, i) => ({ ...p, id: p.id ?? `neu-${i}` })));
}

const PLAN: Phase[] = normalisierePhasen([
	{
		id: "p1",
		name: "Einstieg",
		dauer_min: 10,
		beschreibung: "Fahrrad zeigen\nGänge zählen",
		prio: "kern",
		sozialform: { typ: "text", wert: "Plenum" },
		methode: { typ: "node", node_id: "m-1", titel: "Unterrichtsgespräch" },
		material: [{ typ: "node", node_id: "a-1", titel: "AB Zahnräder" }, { typ: "text", wert: "Fahrrad" }],
	},
	{ id: "p2", name: "Erarbeitung", dauer_min: 25, prio: "uebung", material: [] },
	{ id: "p3", name: "Sicherung", dauer_min: null, status: "offen" },
]);

describe("Ablauf — Roundtrip", () => {
	it("Skizze → Plattform → Skizze ist zeichengleich und bleibt eine Liste", () => {
		const zeilen = ["1. Einstieg: Video Zahnräder (5 min)", "2. Erarbeitung AB", "3. Sicherung (10 min)"];
		const gelesen = leseAblauf(ablauf(zeilen));
		const server = gespeichert(mischePhasen([], gelesen?.phasen ?? []));
		expect(rendereAblauf(server)).toEqual(zeilen);
	});

	it("eine vollständige Planung ist zeichengleich und bleibt eine Tabelle", () => {
		const zeilen = rendereAblauf(PLAN);
		expect(zeilen[0]).toBe("| Prio | Min | Phase | Inhalt | Sozialform | Methode | Material |  |");
		expect(zeilen.slice(2).every((z) => z.endsWith("| `✎` |"))).toBe(true);
		const gelesen = leseAblauf(ablauf(zeilen));
		expect(gelesen?.fehler).toEqual([]);
		const nutzlast = mischePhasen(PLAN, gelesen?.phasen ?? []);
		expect(gleichePhasen(nutzlast, PLAN)).toBe(true);
		expect(rendereAblauf(gespeichert(nutzlast).map((p, i) => ({ ...p, status: PLAN[i]?.status ?? null })))).toEqual(zeilen);
	});

	it("eine Skizze, die auf der Plattform Material bekommt, wird zur Tabelle", () => {
		const skizze = normalisierePhasen([{ id: "p1", name: "Einstieg", dauer_min: 5 }]);
		expect(rendereAblauf(skizze)[0]).toBe("1. Einstieg (5 min)");
		const mitMaterial = normalisierePhasen([{ id: "p1", name: "Einstieg", dauer_min: 5, material: [{ typ: "text", wert: "Video" }] }]);
		expect(rendereAblauf(mitMaterial)[0]).toContain("| Prio |");
	});

	it("schreibt einen leeren Punkt, wenn es keine Phasen gibt — und liest ihn als keine", () => {
		expect(rendereAblauf([])).toEqual(["1."]);
		expect(leseAblauf(ablauf(["1."]))?.phasen).toEqual([]);
	});

	it("streicht gestrichene Phasen durch und liest den Namen ohne Tilden", () => {
		const gestrichen = normalisierePhasen([{ id: "p1", name: "Einstieg", dauer_min: 5, status: "gestrichen" }]);
		expect(rendereAblauf(gestrichen)).toEqual(["1. ~~Einstieg~~ (5 min)"]);
		expect(leseAblauf(ablauf(["1. ~~Einstieg~~ (5 min)"]))?.phasen[0]?.name).toBe("Einstieg");
	});
});

describe("Ablauf — Tabelle lesen", () => {
	it("liest über die Kopfzeile: die handgeschriebene Tabelle mit Zeit und Medien", () => {
		const gelesen = leseAblauf(
			ablauf([
				"| Zeit | Phase       | Inhalt                         | Methode               | Medien           |",
				"| ---- | ----------- | ------------------------------ | --------------------- | ---------------- |",
				"| 3'   | Begrüßung   |                                |                       |                  |",
				"| 15'  | Erarbeitung | Suchmaschine im Raum<br>KI mit iPads | EA, Internetrecherche | Video/iPad<br>AB |",
			]),
		);
		expect(gelesen?.fehler).toEqual([]);
		expect(gelesen?.phasen[1]).toEqual({
			name: "Erarbeitung",
			dauer_min: 15,
			beschreibung: "Suchmaschine im Raum\nKI mit iPads",
			methode: "EA, Internetrecherche",
			material: ["Video/iPad", "AB"],
		});
		// Ohne Prio-Spalte sagt die Tabelle nichts über die Prio.
		expect(gelesen?.phasen[0]).not.toHaveProperty("prio");
	});

	it("lässt eine leere Phase-Zelle den Namen der Zeile darüber erben", () => {
		const gelesen = leseAblauf(ablauf(["| Min | Phase | Inhalt |", "| --- | --- | --- |", "| 5 | Erarbeitung | Teil 1 |", "| 5 | | Teil 2 |"]));
		expect(gelesen?.phasen.map((p) => p.name)).toEqual(["Erarbeitung", "Erarbeitung"]);
	});

	it("liest 10, 10', 10′ und 10 min als dieselbe Dauer; leer bleibt leer", () => {
		const gelesen = leseAblauf(
			ablauf(["| Min | Phase |", "| --- | --- |", "| 10 | A |", "| 10' | B |", "| 10′ | C |", "| 10 min | D |", "|  | E |"]),
		);
		expect(gelesen?.phasen.map((p) => p.dauer_min)).toEqual([10, 10, 10, 10, null]);
	});

	it("macht aus <br> einen Zeilenumbruch und zurück, und hält | in einer Zelle aus", () => {
		const phasen = normalisierePhasen([{ id: "p1", name: "A | B", dauer_min: 5, beschreibung: "Zeile 1\nZeile 2" }]);
		const zeilen = rendereAblauf(phasen);
		expect(zeilen[2]).toContain("A \\| B");
		expect(zeilen[2]).toContain("Zeile 1<br>Zeile 2");
		const gelesen = leseAblauf(ablauf(zeilen))?.phasen[0];
		expect(gelesen?.name).toBe("A | B");
		expect(gelesen?.beschreibung).toBe("Zeile 1\nZeile 2");
	});

	it("meldet, was die Plattform ablehnen würde, statt es zu raten", () => {
		const gelesen = leseAblauf(
			ablauf(["| Prio | Min | Phase |", "| --- | --- | --- |", "| Kern | ca. 10 | A |", "| Wichtig | 5 | B |", "| Kern | 600 | C |", `| Kern | 5 | ${"x".repeat(201)} |`]),
		);
		expect(gelesen?.fehler).toHaveLength(4);
	});
});

describe("Ablauf — Liste lesen", () => {
	it("liest Dauer, Sozialform und Methode aus der Klammer und eingerückte Zeilen als Inhalt", () => {
		const gelesen = leseAblauf(
			ablauf([
				"1. Einstieg: Video Zahnräder",
				"2. Erarbeitung AB Übersetzung (25 min · PA)",
				"3. Sicherung (10 min · Plenum · Unterrichtsgespräch)",
				"   Übersetzungsverhältnis an zwei Beispielen nachrechnen lassen.",
			]),
		);
		expect(gelesen?.phasen).toEqual([
			{ name: "Einstieg: Video Zahnräder", dauer_min: null },
			{ name: "Erarbeitung AB Übersetzung", dauer_min: 25, sozialform: "PA" },
			{
				name: "Sicherung",
				dauer_min: 10,
				sozialform: "Plenum",
				methode: "Unterrichtsgespräch",
				beschreibung: "Übersetzungsverhältnis an zwei Beispielen nachrechnen lassen.",
			},
		]);
	});

	it("lässt eine Klammer ohne Dauer und ohne · im Namen", () => {
		expect(leseAblauf(ablauf(["1. Erarbeitung (Aufg. 1+2)"]))?.phasen[0]?.name).toBe("Erarbeitung (Aufg. 1+2)");
	});

	it("nimmt auch Spiegelstriche", () => {
		expect(leseAblauf(ablauf(["- Einstieg", "- Sicherung (5 min)"]))?.phasen.map((p) => p.name)).toEqual(["Einstieg", "Sicherung"]);
	});

	it("sagt nichts über die Phasen, wenn es keinen Abschnitt gibt", () => {
		expect(leseAblauf("## Verlauf\n1. Alt\n")).toBeNull();
	});
});

describe("Ablauf — Zeitleiste und Knopfspalte (NOTIZFORMAT 7)", () => {
	const TABELLE = [
		"| Prio | Min | Phase | Inhalt | Sozialform | Methode | Material |  |",
		"| --- | --- | --- | --- | --- | --- | --- | --- |",
		"| Kern | 10 | Einstieg | Bilder zeigen | Plenum |  |  | `✎` |",
		"| Übung | 25 | Erarbeitung |  | PA |  | AB | `✎` |",
	];
	const ohneKnopf = TABELLE.map((z) => z.replace(/ \| (?:`✎`)? \|$/, " |").replace(" | --- | --- |", " | --- |"));
	const ZEITLEISTE = ["```uplan-zeit", "```", ""];

	it("liest eine Tabelle unter der Zeitleiste als Tabelle", () => {
		const gelesen = leseAblauf(ablauf([...ZEITLEISTE, ...TABELLE]));
		expect(gelesen?.fehler).toEqual([]);
		expect(gelesen?.phasen.map((p) => [p.name, p.prio, p.dauer_min])).toEqual([
			["Einstieg", "kern", 10],
			["Erarbeitung", "uebung", 25],
		]);
	});

	it("liest eine Tabelle ohne Knopfspalte wie eine mit — Bestand bleibt lesbar", () => {
		expect(ohneKnopf[0]).toBe("| Prio | Min | Phase | Inhalt | Sozialform | Methode | Material |");
		expect(leseAblauf(ablauf(ohneKnopf))).toEqual(leseAblauf(ablauf(TABELLE)));
	});

	it("lässt sich von einer Spalte ohne Überschrift nicht verschieben, auch nicht links", () => {
		const links = ohneKnopf.map((z, i) => (i === 1 ? `| --- ${z}` : `| ${i === 0 ? "" : "`✎`"} ${z}`));
		expect(leseAblauf(ablauf(links))).toEqual(leseAblauf(ablauf(TABELLE)));
	});

	it("nimmt die Zaunzeilen unter einer Liste nicht in die Beschreibung", () => {
		const gelesen = leseAblauf(ablauf(["1. Einstieg (10 min)", "   Bilder zeigen", ...ZEITLEISTE, "2. Erarbeitung"]));
		expect(gelesen?.phasen.map((p) => [p.name, p.beschreibung])).toEqual([
			["Einstieg", "Bilder zeigen"],
			["Erarbeitung", undefined],
		]);
	});

	// Eine fehlende Zeile ist eine gelöschte Phase. Verschluckte der fehlende Zaun den Rest,
	// räumte der Rückkanal die Stunde auf der Plattform leer.
	it("verliert ohne schließenden Zaun keine Phase", () => {
		const gelesen = leseAblauf(ablauf(["```uplan-zeit", ...TABELLE]));
		expect(gelesen?.phasen).toHaveLength(2);
	});
});

describe("Mischen", () => {
	it("lässt Prio und Material stehen, wenn die Liste sie nicht ausdrückt", () => {
		const server = normalisierePhasen([
			{ id: "p1", name: "Einstieg", dauer_min: 5, prio: "vertiefung", material: [{ typ: "text", wert: "Video" }] },
		]);
		const [p] = mischePhasen(server, [{ name: "Einstieg", dauer_min: 8 }]);
		expect(p).toMatchObject({ id: "p1", dauer_min: 8, prio: "vertiefung", material: [{ wert: "Video" }] });
	});

	it("schickt keinen Status mit — den behält die Plattform", () => {
		const [, , sicherung] = mischePhasen(PLAN, leseAblauf(ablauf(rendereAblauf(PLAN)))?.phasen ?? []);
		expect(sicherung).toMatchObject({ id: "p3" });
		expect(sicherung).not.toHaveProperty("status");
	});

	it("behält den Bausteinverweis bei gleichem Titel, Umgeschriebenes wird Freitext", () => {
		const zeilen = rendereAblauf(PLAN).map((z) => z.replace("AB Zahnräder, Fahrrad", "AB Zahnräder, Fahrradpumpe"));
		const [einstieg] = mischePhasen(PLAN, leseAblauf(ablauf(zeilen))?.phasen ?? []);
		expect(einstieg?.material).toEqual([
			{ typ: "node", node_id: "a-1", titel: "AB Zahnräder", wert: null },
			{ typ: "text", wert: "Fahrradpumpe", node_id: null, titel: null },
		]);
		expect(einstieg?.methode).toMatchObject({ node_id: "m-1" });
	});

	it("eine umbenannte Phase behält über die Position ihre Kennung, eine neue bekommt keine", () => {
		const nutzlast = mischePhasen(PLAN, [{ name: "Einstieg" }, { name: "Erarbeitung in Gruppen" }, { name: "Sicherung" }, { name: "Ausblick" }]);
		expect(nutzlast.map((p) => p.id)).toEqual(["p1", "p2", "p3", null]);
	});

	it("eine gelöschte Zeile löscht die Phase", () => {
		const nutzlast = mischePhasen(PLAN, [{ name: "Einstieg" }, { name: "Sicherung" }]);
		expect(nutzlast.map((p) => p.id)).toEqual(["p1", "p3"]);
	});
});
