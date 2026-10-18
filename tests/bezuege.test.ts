import { describe, expect, it } from "vitest";
import { bezuegeAus, kompetenzAnzeige } from "../src/sync/bezuege";

describe("Kompetenzen und Fachbegriffe aus refs", () => {
	it("trennt Kompetenzen von Begriffen, Nummer vor dem Wortlaut, partiell wie im Export", () => {
		expect(
			bezuegeAus([
				{ node_id: "k1", typ: "ik", code: "3.2.1 (1)", titel: "Die SuS können Aromaten beschreiben", partiell: false },
				{ node_id: "b1", typ: "concept", titel: "Benzol", content_type: "stoffsteckbrief" },
				{ node_id: "k2", typ: "pk", code: "2.1 (3)", titel: "Modelle nutzen", partiell: true },
				{ node_id: "b2", typ: "concept", titel: "Mesomerie", content_type: "begriff" },
			]),
		).toEqual({
			kompetenzen: ["3.2.1 (1): Die SuS können Aromaten beschreiben", "2.1 (3)[…]: Modelle nutzen"],
			fachbegriffe: ["Benzol", "Mesomerie"],
		});
	});

	it("nennt die Nummer nur einmal, auch wenn der Titel mit ihr beginnt — wie auf der Plattform", () => {
		expect(
			bezuegeAus([
				{ typ: "ik", code: "3.2.2.1(9)", titel: "3.2.2.1(9) ausgewählte chemische Reaktionen zuordnen" },
				{ typ: "pk", code: null, titel: "2.2.5 fachlich korrekt argumentieren", partiell: true },
			]).kompetenzen,
		).toEqual(["3.2.2.1(9): ausgewählte chemische Reaktionen zuordnen", "2.2.5[…]: fachlich korrekt argumentieren"]);
	});

	it("kommt ohne Nummer aus — der Planer speichert sie teils als null", () => {
		expect(bezuegeAus([{ typ: "ik", code: null, titel: "Reaktionen deuten", partiell: true }]).kompetenzen).toEqual([
			"Reaktionen deuten[…]",
		]);
	});

	it("lässt Leeres, Doppeltes und Unbekanntes weg", () => {
		expect(
			bezuegeAus([
				{ typ: "ik", code: null, titel: null },
				{ typ: "concept", titel: "Benzol" },
				{ typ: "concept", titel: " Benzol " },
				{ typ: "material", titel: "AB" },
				"kaputt",
			]),
		).toEqual({ kompetenzen: [], fachbegriffe: ["Benzol"] });
		expect(bezuegeAus(undefined)).toEqual({ kompetenzen: [], fachbegriffe: [] });
	});

	it("zeigt kurz die Nummer, lang den ganzen Text — einen Titel mit Doppelpunkt aber ganz", () => {
		expect(kompetenzAnzeige("3.2.1 (1)[…]: Die SuS können: deuten")).toEqual({
			kurz: "3.2.1 (1)[…]",
			lang: "3.2.1 (1)[…]: Die SuS können: deuten",
		});
		expect(kompetenzAnzeige("Energie: Formen und Umwandlung").kurz).toBe("Energie: Formen und Umwandlung");
		expect(kompetenzAnzeige("Reaktionen deuten[…]").kurz).toBe("Reaktionen deuten[…]");
	});
});
