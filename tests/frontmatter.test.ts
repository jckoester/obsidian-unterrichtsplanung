import { describe, expect, it } from "vitest";
import {
	extractOwnSection,
	MARKER_UEBERSCHRIFT,
	plattformRegion,
	readScalars,
	REGION_ENDE,
	renderFrontmatter,
	splitNote,
} from "../src/sync/frontmatter";

describe("frontmatter", () => {
	it("trennt Block und Rumpf", () => {
		const { frontmatter, body } = splitNote("---\nDatum: 2026-09-15\n---\nText\n");
		expect(frontmatter).toBe("Datum: 2026-09-15");
		expect(body).toBe("Text\n");
	});

	it("liest Skalare und überspringt Listen", () => {
		const felder = readScalars('Kategorien:\n  - "[[UStunden]]"\nDatum: 2026-09-15\nuplan_hash: abc');
		expect(felder["Datum"]).toBe("2026-09-15");
		expect(felder["uplan_hash"]).toBe("abc");
		expect(felder["Kategorien"]).toBeUndefined();
	});

	it("quotiert Wikilinks", () => {
		const yaml = renderFrontmatter({ Lehrauftrag: "[[NwT 9 2526|NwT 9]]" });
		expect(yaml).toContain('Lehrauftrag: "[[NwT 9 2526|NwT 9]]"');
	});

	it("lässt Emoji-Statuswerte unquotiert", () => {
		expect(renderFrontmatter({ UStatus: ["🟢 vorbereitet"] })).toContain("  - 🟢 vorbereitet");
	});

	it("findet im Altbestand ohne Marker den Abschnitt ab der Überschrift", () => {
		const body = `## Verlauf\n1.\n\n${MARKER_UEBERSCHRIFT}\nMeins\n`;
		expect(extractOwnSection(body)).toBe(`${MARKER_UEBERSCHRIFT}\nMeins\n`);
	});

	it("schneidet den Vault-Teil am Marker ab, nicht an der Überschrift", () => {
		const body = `## Verlauf\n1.\n\n${REGION_ENDE}\n\n## Umbenannt\nMeins\n`;
		expect(extractOwnSection(body)).toBe("## Umbenannt\nMeins\n");
	});

	it("begrenzt die Plattform-Region am Marker — ohne Marker ist es alles", () => {
		const mit = `---\nDatum: 2026-09-15\n---\n## Verlauf\n${REGION_ENDE}\nMeins\n`;
		expect(plattformRegion(mit)).toBe("---\nDatum: 2026-09-15\n---\n## Verlauf\n");
		const ohne = "---\nDatum: 2026-09-15\n---\n## Verlauf\n";
		expect(plattformRegion(ohne)).toBe(ohne);
	});

	it("zählt den Marker nur als ganze Zeile", () => {
		const zitat = `Die Grenze heißt ${REGION_ENDE} und steht weiter unten.\n`;
		expect(plattformRegion(zitat)).toBe(zitat);
	});
});
