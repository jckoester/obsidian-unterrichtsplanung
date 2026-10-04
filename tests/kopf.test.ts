import { describe, expect, it } from "vitest";
import { kopfDaten, verweis, type KopfNotiz } from "../src/kopf";

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
