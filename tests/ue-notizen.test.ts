import { describe, expect, it } from "vitest";
import overview from "../fixtures/overview-group1.json";
import type { OverviewRead } from "../src/api/types";
import {
	materialize,
	lehrauftragName,
	type GruppenZuordnung,
} from "../src/sync/materialize";

const zuordnung: GruppenZuordnung = {
	groupId: 1,
	lehrauftragLink: "",
	fach: "NwT",
	stufe: 9,
	ordner: "Bereiche/11 Unterricht/NwT 9",
	stundenOrdner: "Unterrichtsstunden",
};

const stand = overview as unknown as OverviewRead;
const UE_PFAD =
	"Bereiche/11 Unterricht/NwT 9/UE1 - Mechanische Übertragung/UE1 - Mechanische Übertragung.md";

function lauf(vorhanden: { pfad: string; inhalt: string }[] = [], vorlage?: string | null) {
	return materialize({ zuordnung, overview: stand, vorhanden, lehrauftragVorlage: vorlage });
}

function alsVorhanden(plan: ReturnType<typeof lauf>) {
	return plan.ops
		.filter((o) => o.inhalt)
		.map((o) => ({ pfad: o.pfad, inhalt: o.inhalt as string }));
}

describe("Lehrauftragsnotiz", () => {
	it("leitet den Namen aus dem Ordner ab", () => {
		expect(lehrauftragName(zuordnung)).toBe("NwT 9");
		expect(lehrauftragName({ ...zuordnung, lehrauftragLink: "NwT 9 2627" })).toBe("NwT 9 2627");
	});

	it("legt sie an, wenn sie fehlt — mit Fach und Stufe", () => {
		const op = lauf().ops.find((o) => o.pfad.endsWith("/NwT 9.md"));
		expect(op?.art).toBe("erstellen");
		expect(op?.inhalt).toContain('Fach: "[[NwT]]"');
		expect(op?.inhalt).toContain("Stufe: 9");
		expect(op?.inhalt).toContain('Kategorien:\n  - "[[Lehraufträge]]"');
	});

	it("übernimmt den Rumpf der Vault-Vorlage", () => {
		const vorlage = "---\nKategorien:\nFach:\nStufe:\n---\n\n## Notenbildung\n\n```dataviewjs\nlet x = 1\n```\n";
		const op = lauf([], vorlage).ops.find((o) => o.pfad.endsWith("/NwT 9.md"));
		expect(op?.inhalt).toContain("```dataviewjs");
		expect(op?.inhalt).toContain('Fach: "[[NwT]]"');
	});

	it("fasst eine vorhandene Lehrauftragsnotiz nicht an", () => {
		const plan = lauf([
			{ pfad: "Bereiche/11 Unterricht/NwT 9/NwT 9.md", inhalt: "---\nFach: eigenes\n---\nMeins\n" },
		]);
		expect(plan.ops.some((o) => o.pfad.endsWith("/NwT 9.md"))).toBe(false);
	});
});

describe("UE-Notizen", () => {
	it("liegen im gleichnamigen Unterordner", () => {
		const op = lauf().ops.find((o) => o.pfad === UE_PFAD);
		expect(op?.art).toBe("erstellen");
		expect(op?.inhalt).toContain("![[Unterrichtsstunden.base#Einheit]]");
		expect(op?.inhalt).toContain('Lehrauftrag: "[[NwT 9]]"');
	});

	it("zählen die zugewiesenen Stunden", () => {
		const op = lauf().ops.find((o) => o.pfad === UE_PFAD);
		expect(op?.inhalt).toContain("Stunden: 2");
	});

	it("werden von den Stundennotizen verlinkt", () => {
		const stunde = lauf().ops.find((o) => o.pfad.endsWith("NwT 9 2026-09-15.md"));
		expect(stunde?.inhalt).toContain('UEinheit: "[[UE1 - Mechanische Übertragung]]"');
	});

	it("bleiben im zweiten Lauf unverändert", () => {
		const zweit = lauf(alsVorhanden(lauf()));
		expect(zweit.ops.filter((o) => o.pfad === UE_PFAD).every((o) => o.art === "unveraendert")).toBe(true);
	});

	it("behalten ihren Rumpf, wenn sich auf der Plattform etwas ändert", () => {
		const vorhanden = alsVorhanden(lauf());
		const ue = vorhanden.find((v) => v.pfad === UE_PFAD)!;
		ue.inhalt = ue.inhalt.replace(
			"## Inhaltliche Überlegungen",
			"## Inhaltliche Überlegungen\nHandaufschrieb, den niemand überschreiben darf.",
		);

		const geaendert = structuredClone(stand);
		geaendert.units[0]!.title = "UE1 - Mechanische Übertragung (überarbeitet)";
		geaendert.units[0]!.updated_at = "2026-10-01T09:00:00Z";

		const op = materialize({ zuordnung, overview: geaendert, vorhanden }).ops.find(
			(o) => o.pfad === UE_PFAD,
		);
		expect(op?.art).toBe("aktualisieren");
		expect(op?.inhalt).toContain("Handaufschrieb, den niemand überschreiben darf.");
		// Der Ordner mit dem Material wandert nicht mit — das wäre ein Nebeneffekt zu viel.
		expect(op?.pfad).toBe(UE_PFAD);
		expect(op?.grund).toContain("Ordner bleibt");
	});
});
