import { describe, expect, it } from "vitest";
import overview from "../fixtures/overview-group1.json";
import type { OverviewRead } from "../src/api/types";
import { MARKER_UEBERSCHRIFT } from "../src/sync/frontmatter";
import {
	materialize,
	STANDARD_DATEIMUSTER,
	type GruppenZuordnung,
} from "../src/sync/materialize";

const zuordnung: GruppenZuordnung = {
	groupId: 1,
	lehrauftragLink: "NwT 9 2627|NwT 9",
	ordner: "Bereiche/11 Unterricht/NwT 9",
	stundenOrdner: "Unterrichtsstunden",
	dateiMuster: STANDARD_DATEIMUSTER,
};

const stand = overview as unknown as OverviewRead;

function ersterLauf() {
	return materialize({ zuordnung, overview: stand, vorhanden: [] });
}

describe("materialize", () => {
	it("legt für jeden Slot genau eine Notiz an", () => {
		const plan = ersterLauf();
		expect(plan.ops.filter((o) => o.art === "erstellen")).toHaveLength(2);
		expect(plan.ops[0]?.pfad).toBe(
			"Bereiche/11 Unterricht/NwT 9/Unterrichtsstunden/NwT 9 Stunde 1.md",
		);
	});

	it("nummeriert chronologisch und übersetzt die Kategorie", () => {
		const plan = ersterLauf();
		const zweite = plan.ops[1]?.inhalt ?? "";
		expect(zweite).toContain("# Stunde 2 - 22.09.2026");
		expect(zweite).toContain("🟣 Prüfung");
		expect(zweite).toContain('UEinheit: "[[UE1 - Mechanische Übertragung]]"');
	});

	it("ist idempotent — zweiter Lauf ändert nichts", () => {
		const erst = ersterLauf();
		const vorhanden = erst.ops
			.filter((o) => o.inhalt)
			.map((o) => ({ pfad: o.pfad, inhalt: o.inhalt as string }));
		const zweit = materialize({ zuordnung, overview: stand, vorhanden });
		expect(zweit.ops.every((o) => o.art === "unveraendert")).toBe(true);
	});

	it("erkennt eine Änderung auf der Plattform", () => {
		const erst = ersterLauf();
		const vorhanden = erst.ops
			.filter((o) => o.inhalt)
			.map((o) => ({ pfad: o.pfad, inhalt: o.inhalt as string }));
		const geaendert = structuredClone(stand);
		geaendert.slots[0]!.thema = "Getriebe, Teil 2";
		const zweit = materialize({ zuordnung, overview: geaendert, vorhanden });
		expect(zweit.ops.filter((o) => o.art === "aktualisieren")).toHaveLength(1);
	});

	it("meldet beidseitige Änderung als Konflikt und rettet die Vault-Fassung", () => {
		const erst = ersterLauf();
		const vorhanden = erst.ops
			.filter((o) => o.inhalt)
			.map((o) => ({ pfad: o.pfad, inhalt: o.inhalt as string }));
		vorhanden[0]!.inhalt = vorhanden[0]!.inhalt.replace("## Verlauf", "## Verlauf\n1. Von Hand ergänzt");
		const geaendert = structuredClone(stand);
		geaendert.slots[0]!.thema = "Getriebe, Teil 2";
		const zweit = materialize({ zuordnung, overview: geaendert, vorhanden });
		const konflikt = zweit.ops.find((o) => o.art === "konflikt");
		expect(konflikt).toBeDefined();
		expect(konflikt?.inhalt).toContain("Von Hand ergänzt");
		expect(konflikt?.inhalt).toContain("Sync-Konflikt");
	});

	it("bewahrt den vault-eigenen Abschnitt bei Aktualisierung", () => {
		const erst = ersterLauf();
		const vorhanden = erst.ops
			.filter((o) => o.inhalt)
			.map((o) => ({ pfad: o.pfad, inhalt: o.inhalt as string }));
		vorhanden[0]!.inhalt = vorhanden[0]!.inhalt.replace(
			MARKER_UEBERSCHRIFT,
			`${MARKER_UEBERSCHRIFT}\nMaterial liegt im Schrank.`,
		);
		const geaendert = structuredClone(stand);
		geaendert.slots[0]!.thema = "Getriebe, Teil 2";
		const op = materialize({ zuordnung, overview: geaendert, vorhanden }).ops[0];
		expect(op?.inhalt).toContain("Material liegt im Schrank.");
	});

	it("archiviert statt zu löschen, wenn ein Slot verschwindet", () => {
		const erst = ersterLauf();
		const vorhanden = erst.ops
			.filter((o) => o.inhalt)
			.map((o) => ({ pfad: o.pfad, inhalt: o.inhalt as string }));
		const geschrumpft = structuredClone(stand);
		geschrumpft.slots = [geschrumpft.slots[0]!];
		const plan = materialize({ zuordnung, overview: geschrumpft, vorhanden });
		const archiv = plan.ops.find((o) => o.art === "archivieren");
		expect(archiv?.inhalt).toContain("ggd_status: archiviert");
		expect(plan.ops.some((o) => o.art === "erstellen")).toBe(false);
	});

	it("benennt um statt zu duplizieren, wenn sich das Datum verschiebt", () => {
		const erst = ersterLauf();
		const vorhanden = erst.ops
			.filter((o) => o.inhalt)
			.map((o) => ({ pfad: o.pfad, inhalt: o.inhalt as string }));
		const getauscht = structuredClone(stand);
		getauscht.slots[0]!.date = "2026-09-29"; // rutscht hinter den zweiten Slot
		const plan = materialize({ zuordnung, overview: getauscht, vorhanden });
		expect(plan.ops.filter((o) => o.art === "umbenennen").length).toBeGreaterThan(0);
		expect(plan.ops.some((o) => o.art === "erstellen")).toBe(false);
	});
});
