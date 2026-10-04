import { describe, expect, it } from "vitest";
import { leseAblauf } from "../src/sync/phasen";
import { verfuegbareMinuten, zeitbudget, zeitspanne } from "../src/zeitbudget";

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
