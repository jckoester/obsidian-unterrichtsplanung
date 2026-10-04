import { describe, expect, it } from "vitest";
import { leseAblauf } from "../src/sync/phasen";
import { balken, ERSATZ_MINUTEN, verfuegbareMinuten, zeitbudget, zeitleisteAus, zeitspanne } from "../src/zeitbudget";

describe("Zeitbudget", () => {
	it("rechnet geplant, frei und die Zeitspannen", () => {
		const budget = zeitbudget(
			[
				{ name: "Einstieg", dauer_min: 10, prio: "kern" },
				{ name: "Erarbeitung", dauer_min: 25, prio: "kern" },
			],
			45,
		);
		expect(budget).toMatchObject({ verfuegbar: 45, geplant: 35, frei: 10, ueberhang: 0, ohneDauer: 0, massstab: 45 });
		expect(budget.abschnitte.map((a) => a.spanne)).toEqual(["0–10′", "10–35′"]);
	});

	it("meldet einen Überhang und misst den Balken an der geplanten Zeit", () => {
		const budget = zeitbudget(
			[
				{ name: "Einstieg", dauer_min: 20 },
				{ name: "Erarbeitung", dauer_min: 30 },
			],
			45,
		);
		expect(budget).toMatchObject({ geplant: 50, frei: 0, ueberhang: 5, massstab: 50 });
	});

	// Wie `startzeiten` auf der Plattform: Ohne Dauer steht die Uhr — die Phase selbst hat
	// noch einen Beginn, alle folgenden nicht mehr.
	it("hält die Uhr nach einer Phase ohne Dauer an", () => {
		const budget = zeitbudget(
			[
				{ name: "Einstieg", dauer_min: 10 },
				{ name: "Erarbeitung", dauer_min: null },
				{ name: "Sicherung", dauer_min: 10 },
			],
			45,
		);
		expect(budget.abschnitte.map((a) => a.spanne)).toEqual(["0–10′", "ab 10′", "–"]);
		expect(budget.abschnitte.map((a) => a.beginn)).toEqual([0, 10, null]);
		expect(budget).toMatchObject({ geplant: 20, frei: 25, ohneDauer: 1 });
	});

	it("zählt jede Phase, gleich welche Prio — und eine Liste ohne Prio", () => {
		const budget = zeitbudget(
			[
				{ name: "Vertiefung", dauer_min: 15, prio: "vertiefung" },
				{ name: "Skizze", dauer_min: 10 },
			],
			45,
		);
		expect(budget.geplant).toBe(25);
		expect(budget.abschnitte.map((a) => a.prio)).toEqual(["vertiefung", null]);
	});

	it("kommt mit einem leeren Ablauf aus", () => {
		expect(zeitbudget([], 90)).toMatchObject({ geplant: 0, frei: 90, ueberhang: 0, massstab: 90, abschnitte: [] });
	});

	it("rechnet auf dem, was `leseAblauf` aus der Notiz liest", () => {
		const ablauf = leseAblauf(
			[
				"## Ablauf",
				"| Prio | Min | Phase | Inhalt | Sozialform | Methode | Material |",
				"| --- | --- | --- | --- | --- | --- | --- |",
				"| Kern | 10 | Einstieg | | Plenum | | |",
				"| Übung | 25 | Erarbeitung | | PA | | |",
				"| Kern | | Ausblick | | | | |",
			].join("\n"),
		);
		const budget = zeitbudget(ablauf?.phasen ?? [], verfuegbareMinuten(1));
		expect(budget).toMatchObject({ geplant: 35, frei: 10, ohneDauer: 1 });
		expect(budget.abschnitte.map((a) => `${a.spanne} ${a.name} (${a.prio})`)).toEqual([
			"0–10′ Einstieg (kern)",
			"10–35′ Erarbeitung (uebung)",
			"ab 35′ Ausblick (kern)",
		]);
	});
});

describe("verfügbare Minuten", () => {
	it("rechnet 45 Minuten je Stunde", () => {
		expect(verfuegbareMinuten(1)).toBe(45);
		expect(verfuegbareMinuten(2)).toBe(90);
		expect(verfuegbareMinuten("2")).toBe(90);
	});

	it("nimmt ohne brauchbaren Wert eine Einzelstunde an", () => {
		for (const wert of [undefined, null, "", 0, -1, 1.5, "zwei"]) {
			expect(verfuegbareMinuten(wert)).toBe(45);
		}
	});
});

describe("Zeitspanne", () => {
	it("schreibt wie die Zeit-Spalte der Plattform", () => {
		expect(zeitspanne(0, 10)).toBe("0–10′");
		expect(zeitspanne(10, null)).toBe("ab 10′");
		expect(zeitspanne(null, 10)).toBe("–");
	});
});

describe("Zeitleiste aus der Notiz", () => {
	const notiz = (ablauf: string[], uStunden = "2") =>
		[
			"---",
			`UStunden: ${uStunden}`,
			"uplan_slot_id: s1",
			"---",
			"```uplan-kopf",
			"```",
			"",
			"## Ablauf",
			"```uplan-zeit",
			"```",
			"",
			...ablauf,
			"",
			"<!-- uplan:ende -->",
			"",
			"## Notizen",
			"## Ablauf",
			"1. Das hier gehört dem Vault (90 min)",
		].join("\n");
	const TABELLE = [
		"| Prio | Min | Phase | Inhalt | Sozialform | Methode | Material |  |",
		"| --- | --- | --- | --- | --- | --- | --- | --- |",
		"| Kern | 20 | Einstieg |  |  |  |  | `✎` |",
		"| Übung | 40 | Erarbeitung |  |  |  |  | `✎` |",
	];

	it("liest Ablauf und UStunden aus der Plattform-Region, nicht aus dem eigenen Teil", () => {
		const daten = zeitleisteAus(notiz(TABELLE));
		expect(daten?.budget).toMatchObject({ verfuegbar: 90, geplant: 60, frei: 30 });
		expect(daten?.fehler).toEqual([]);
	});

	// Die Zeitleiste sagt es gleich — der Sync hielte die Stunde sonst erst zurück.
	it("zeigt, was die Plattform ablehnen würde", () => {
		const daten = zeitleisteAus(notiz([...TABELLE, "| Wichtig | 10 | Sicherung |  |  |  |  | `✎` |"]));
		expect(daten?.fehler).toEqual(["Phase 3: Prio „Wichtig“ unbekannt"]);
	});

	it("gibt ohne Ablauf nichts", () => {
		expect(zeitleisteAus("---\nUStunden: 1\n---\nNur Text")).toBeNull();
	});
});

describe("Balken", () => {
	const summe = (anteile: number[]) => anteile.reduce((a, b) => a + b, 0);

	it("füllt die verfügbare Zeit und lässt den Rest frei", () => {
		const { teile, ziel } = balken(zeitbudget([{ name: "A", dauer_min: 9 }, { name: "B", dauer_min: 18 }], 45));
		expect(teile.map((t) => [t.art, Math.round(t.anteil)])).toEqual([["phase", 20], ["phase", 40], ["frei", 40]]);
		expect(ziel).toBe(100);
	});

	it("misst einen Überhang an der geplanten Zeit — ohne freien Rest, die Ziellinie mittendrin", () => {
		const { teile, ziel } = balken(zeitbudget([{ name: "A", dauer_min: 30 }, { name: "B", dauer_min: 30 }], 45));
		expect(teile.map((t) => t.art)).toEqual(["phase", "phase"]);
		expect(summe(teile.map((t) => t.anteil))).toBeCloseTo(100);
		expect(ziel).toBe(75);
	});

	it("gibt einer Phase ohne Dauer eine schmale, aber sichtbare Breite", () => {
		const { teile } = balken(zeitbudget([{ name: "A", dauer_min: 10 }, { name: "B", dauer_min: null }], 45));
		expect(teile[1]).toMatchObject({ art: "phase", nummer: 1 });
		expect(teile[1]?.anteil).toBeCloseTo((ERSATZ_MINUTEN / 45) * 100);
		expect(summe(teile.map((t) => t.anteil))).toBeCloseTo(100);
	});
});

