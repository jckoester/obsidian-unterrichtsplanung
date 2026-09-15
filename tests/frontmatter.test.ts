import { describe, expect, it } from "vitest";
import {
	extractOwnSection,
	MARKER_UEBERSCHRIFT,
	readScalars,
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
		const felder = readScalars('Kategorien:\n  - "[[UStunden]]"\nDatum: 2026-09-15\nggd_hash: abc');
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

	it("findet den vault-eigenen Abschnitt", () => {
		const body = `## Verlauf\n1.\n\n${MARKER_UEBERSCHRIFT}\nMeins\n`;
		expect(extractOwnSection(body)).toBe(`${MARKER_UEBERSCHRIFT}\nMeins\n`);
	});
});
