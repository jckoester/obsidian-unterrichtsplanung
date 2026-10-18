import { describe, expect, it } from "vitest";
import { kopfDaten, plattformLinks, verweis, type KopfGruppe, type KopfNotiz } from "../src/kopf";

const ORDNER = "Bereiche/11 Unterricht/NwT 9/Unterrichtsstunden";

function stunde(name: string, frontmatter: Record<string, unknown> = {}): KopfNotiz {
	return {
		pfad: `${ORDNER}/${name}.md`,
		name,
		frontmatter: {
			Lehrauftrag: "[[NwT 9]]",
			UEinheit: "[[UE1 - Getriebe]]",
			Datum: name.slice(6, 16),
			uplan_slot_id: `slot-${name}`,
			uplan_status: "aktiv",
			...frontmatter,
		},
	};
}

describe("Kopf der Stundennotiz", () => {
	const ordner = [
		stunde("NwT 9 2026-09-22"),
		stunde("NwT 9 2026-09-15"),
		stunde("NwT 9 2026-09-29 (10. Std.)"),
		stunde("NwT 9 2026-09-29 (3. Std.)"),
		stunde("NwT 9 2026-09-18 (archiviert)", { uplan_status: "archiviert" }),
		{ pfad: `${ORDNER}/Sammelnotiz.md`, name: "Sammelnotiz", frontmatter: {} },
	];
	const daten = (name: string) =>
		kopfDaten(ordner.find((n) => n.name === name) ?? stunde(name), ordner);

	it("findet die Nachbarn nach Dateinamen, ohne Archiv und fremde Notizen", () => {
		expect(daten("NwT 9 2026-09-15").vorher).toBeNull();
		expect(daten("NwT 9 2026-09-15").nachher).toEqual({ ziel: `${ORDNER}/NwT 9 2026-09-22`, text: "2026-09-22" });
		expect(daten("NwT 9 2026-09-22").vorher?.text).toBe("2026-09-15");
	});

	it("sortiert die Anfangsstunde numerisch", () => {
		expect(daten("NwT 9 2026-09-22").nachher?.text).toBe("2026-09-29 (3. Std.)");
		expect(daten("NwT 9 2026-09-29 (3. Std.)").nachher?.text).toBe("2026-09-29 (10. Std.)");
		expect(daten("NwT 9 2026-09-29 (10. Std.)").nachher).toBeNull();
	});

	it("gibt einer archivierten Notiz die Nachbarn ihres Termins", () => {
		const archiviert = daten("NwT 9 2026-09-18 (archiviert)");
		expect(archiviert.vorher?.text).toBe("2026-09-15");
		expect(archiviert.nachher?.text).toBe("2026-09-22");
	});

	it("zeigt Lehrauftrag, deutsches Datum und Einheit", () => {
		const d = daten("NwT 9 2026-09-15");
		expect(d.lehrauftrag).toEqual({ ziel: "NwT 9", text: "NwT 9" });
		expect(d.datum).toBe("15.09.2026");
		expect(d.einheit).toEqual({ ziel: "UE1 - Getriebe", text: "UE1 - Getriebe" });
	});

	it("liest Kompetenzen und Fachbegriffe aus dem Frontmatter, Kompetenzen kurz mit Nummer", () => {
		const d = kopfDaten(
			stunde("NwT 9 2026-09-15", {
				Kompetenzen: ["3.1 (2): Getriebe beschreiben", "Modelle nutzen[…]"],
				Fachbegriffe: "Übersetzung",
			}),
			[],
		);
		expect(d.kompetenzen).toEqual([
			{ kurz: "3.1 (2)", lang: "3.1 (2): Getriebe beschreiben" },
			{ kurz: "Modelle nutzen[…]", lang: "Modelle nutzen[…]" },
		]);
		expect(d.fachbegriffe).toEqual(["Übersetzung"]);
		expect(daten("NwT 9 2026-09-22").kompetenzen).toEqual([]);
	});

	it("kommt ohne Einheit und ohne Datum aus", () => {
		const d = kopfDaten(stunde("NwT 9 2026-09-15", { UEinheit: null, Datum: null }), []);
		expect(d.einheit).toBeNull();
		expect(d.datum).toBeNull();
		expect(d.vorher).toBeNull();
		expect(d.nachher).toBeNull();
	});
});

describe("verweis", () => {
	it("liest Wikilinks mit Alias, Pfad und Abschnitt", () => {
		expect(verweis("[[NwT 9|Lehrauftrag]]")).toEqual({ ziel: "NwT 9", text: "Lehrauftrag" });
		expect(verweis("[[Ordner/UE1 - Getriebe]]")).toEqual({ ziel: "Ordner/UE1 - Getriebe", text: "UE1 - Getriebe" });
		expect(verweis("[[NwT 9#Statistik]]")).toEqual({ ziel: "NwT 9", text: "NwT 9" });
	});

	it("lässt Text Text sein und Leeres weg", () => {
		expect(verweis("NwT 9")).toEqual({ ziel: null, text: "NwT 9" });
		expect(verweis("")).toBeNull();
		expect(verweis(null)).toBeNull();
	});
});

describe("Links zur Plattform", () => {
	const API = "http://localhost:5173/api";
	const KNOTEN = "790fde89-c303-4141-b56d-fe69363deafe";
	const gruppen: KopfGruppe[] = [{ groupId: 31, fachId: 16, fachSlug: "nwt" }];
	const fm = (extra: Record<string, unknown> = {}) => ({
		UArt: "Unterricht",
		uplan_group_id: 31,
		uplan_node_id: KNOTEN,
		uplan_status: "aktiv",
		...extra,
	});

	it("öffnet einen Entwurf in der Entwurfsansicht und beim Stundenassistenten, wie die Plattform selbst", () => {
		expect(plattformLinks(fm(), API, gruppen)).toEqual([
			{
				art: "entwurf",
				url: `http://localhost:5173/subjects/nwt/groups/31/planner/lessons/${KNOTEN}`,
				titel: "Entwurf auf der Plattform öffnen",
			},
			{
				art: "assistent",
				url: `http://localhost:5173/chat?subject_id=16&group_id=31&stunde_id=${KNOTEN}`,
				titel: "Mit dem Stundenassistenten planen",
			},
		]);
	});

	it("öffnet einen Platzhalter nur in der Jahresplanung — ein Klick legt keinen Entwurf an", () => {
		expect(plattformLinks(fm({ uplan_node_id: null }), API, gruppen)).toEqual([
			{ art: "planer", url: "http://localhost:5173/subjects/nwt/groups/31/planner", titel: "In der Jahresplanung öffnen" },
		]);
	});

	it("bietet für einen Entfall keinen Assistenten an und für eine archivierte Notiz gar nichts", () => {
		expect(plattformLinks(fm({ UArt: "Entfall" }), API, gruppen).map((l) => l.art)).toEqual(["entwurf"]);
		expect(plattformLinks(fm({ uplan_status: "archiviert" }), API, gruppen)).toEqual([]);
	});

	it("kommt ohne Fach aus, soweit es geht, und ohne Basis-URL oder Gruppe gar nicht", () => {
		const ohneFach = plattformLinks(fm(), `${API}/`, [{ groupId: 31, fachId: null, fachSlug: null }]);
		expect(ohneFach).toEqual([
			{
				art: "assistent",
				url: `http://localhost:5173/chat?group_id=31&stunde_id=${KNOTEN}`,
				titel: "Mit dem Stundenassistenten planen",
			},
		]);
		expect(plattformLinks(fm({ uplan_node_id: null }), API, [{ groupId: 31, fachId: null, fachSlug: null }])).toEqual([]);
		expect(plattformLinks(fm(), "", gruppen)).toEqual([]);
		expect(plattformLinks(fm({ uplan_group_id: 99 }), API, gruppen)).toEqual([]);
	});
});
