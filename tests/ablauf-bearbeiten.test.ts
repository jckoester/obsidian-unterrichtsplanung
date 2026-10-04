import { describe, expect, it } from "vitest";
import { ablaufImText, bearbeiteAblauf, leseAblauf, phaseInTabellenzeile, type VaultPhase } from "../src/sync/phasen";

/** Eine Stundennotiz mit Frontmatter, Kopf, Zeitleiste und dem gegebenen Ablauf. */
function notiz(ablauf: string[]): string {
	return [
		"---",
		"Stundenziel: |-",
		"  Zwei Zeilen,",
		"  ## Ablauf", // im Stundenziel — eingerückt, aber `trim()` macht daraus die Überschrift
		"UStunden: 1",
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
		"Eigenes bleibt.",
	].join("\n");
}

const TABELLE = [
	"| Prio | Min | Phase | Inhalt | Sozialform | Methode | Material |  |",
	"| --- | --- | --- | --- | --- | --- | --- | --- |",
	"| Kern | 10 | Einstieg | Bilder zeigen | Plenum |  |  | `✎` |",
	"| Übung | 25 | ~~Erarbeitung~~ | AB \\| Teil 1 | PA |  | AB | `✎` |",
	"| Kern | 10 | Sicherung |  |  |  |  | `✎` |",
];

const phaseAus = (text: string, nummer: number) => ablaufImText(text)?.ablauf.phasen[nummer] as VaultPhase;

describe("Ablauf im Text", () => {
	it("findet den Abschnitt hinter dem Frontmatter und zählt Zeilen im ganzen Text", () => {
		const text = notiz(TABELLE);
		const imText = ablaufImText(text);
		expect(imText?.form).toBe("tabelle");
		expect(imText?.ablauf.phasen.map((p) => p.name)).toEqual(["Einstieg", "Erarbeitung", "Sicherung"]);
		const zeilen = text.split("\n");
		expect(zeilen[imText?.ablauf.kopf as number]).toBe(TABELLE[0]);
		expect(zeilen[imText?.ablauf.stellen[1]?.start as number]).toBe(TABELLE[3]);
		expect(imText?.ablauf.stellen.map((s) => s.gestrichen)).toEqual([false, true, false]);
	});

	it("bietet bei einer Tabelle nur an, wofür sie eine Spalte hat", () => {
		const handgeschrieben = notiz(["| Zeit | Phase | Inhalt | Methode | Medien |", "| --- | --- | --- | --- | --- |", "| 10 | Einstieg |  |  |  |"]);
		expect([...(ablaufImText(handgeschrieben)?.felder ?? [])].sort()).toEqual(
			["beschreibung", "dauer", "material", "methode", "name"].sort(),
		);
		expect(ablaufImText(notiz(["1. Einstieg (10 min)"]))?.felder.size).toBe(7);
	});

	it("ordnet den Knopf einer Tabellenzeile seiner Phase zu, eine leere Zeile keiner", () => {
		const mitLeerzeile = notiz([...TABELLE.slice(0, 3), "|  |  |  |  |  |  |  |  |", ...TABELLE.slice(3)]);
		expect(phaseInTabellenzeile(mitLeerzeile, 0)).toBe(0);
		expect(phaseInTabellenzeile(mitLeerzeile, 1)).toBeNull();
		expect(phaseInTabellenzeile(mitLeerzeile, 2)).toBe(1);
		expect(phaseInTabellenzeile(mitLeerzeile, 9)).toBeNull();
	});
});

describe("Ablauf bearbeiten — Tabelle", () => {
	it("ersetzt nur die eine Zeile und lässt Knopfspalte und Streichung stehen", () => {
		const text = notiz(TABELLE);
		const vorher = phaseAus(text, 1);
		const neu = bearbeiteAblauf(text, {
			art: "ersetzen",
			nummer: 1,
			vorher,
			phase: { ...vorher, dauer_min: 30, prio: "vertiefung", sozialform: "Gruppenarbeit", beschreibung: "AB | Teil 2\nmit Lösung" },
		});
		const alt = text.split("\n");
		const jetzt = neu.split("\n");
		expect(jetzt).toHaveLength(alt.length);
		const geaendert = jetzt.flatMap((z, i) => (z === alt[i] ? [] : [z]));
		expect(geaendert).toEqual(["| Vertiefung | 30 | ~~Erarbeitung~~ | AB \\| Teil 2<br>mit Lösung | Gruppenarbeit |  | AB | `✎` |"]);
		expect(leseAblauf(neu.split("\n").slice(6).join("\n"))?.fehler).toEqual([]);
	});

	it("lässt unbekannte Spalten stehen", () => {
		const text = notiz(["| Phase | Min | Bemerkung |", "| --- | --- | --- |", "| Einstieg | 10 | nicht vergessen |"]);
		const vorher = phaseAus(text, 0);
		const neu = bearbeiteAblauf(text, { art: "ersetzen", nummer: 0, vorher, phase: { ...vorher, dauer_min: 15 } });
		expect(neu).toContain("| Einstieg | 15 | nicht vergessen |");
	});

	it("hängt eine neue Phase ans Ende der Tabelle, mit Knopf", () => {
		const neu = bearbeiteAblauf(notiz(TABELLE), {
			art: "anhaengen",
			phase: { name: "Ausblick", dauer_min: 5, prio: "kern", beschreibung: null, sozialform: null, methode: null, material: [] },
		});
		expect(neu).toContain(`${TABELLE[4]}\n| Kern | 5 | Ausblick |  |  |  |  | \`✎\` |\n\n<!-- uplan:ende -->`);
	});

	it("hängt die neue Zeile an die Tabelle, nicht hinter eine Bemerkung darunter", () => {
		const neu = bearbeiteAblauf(notiz([...TABELLE, "", "Material liegt im Schrank."]), {
			art: "anhaengen",
			phase: { name: "Ausblick", dauer_min: 5, prio: "kern", beschreibung: null, sozialform: null, methode: null, material: [] },
		});
		expect(neu).toContain(`${TABELLE[4]}\n| Kern | 5 | Ausblick |  |  |  |  | \`✎\` |\n\nMaterial liegt im Schrank.`);
		expect(ablaufImText(neu)?.ablauf.fehler).toEqual([]);
	});

	it("löscht die eine Zeile", () => {
		const text = notiz(TABELLE);
		const neu = bearbeiteAblauf(text, { art: "loeschen", nummer: 0, vorher: phaseAus(text, 0) });
		expect(neu).not.toContain("Einstieg");
		expect(ablaufImText(neu)?.ablauf.phasen.map((p) => p.name)).toEqual(["Erarbeitung", "Sicherung"]);
	});

	it("schreibt nichts, wenn an der Stelle inzwischen eine andere Phase steht", () => {
		const text = notiz(TABELLE);
		const vorher = phaseAus(text, 0);
		const umgestellt = text.replace("| Kern | 10 | Einstieg |", "| Kern | 12 | Einstieg |");
		expect(() => bearbeiteAblauf(umgestellt, { art: "ersetzen", nummer: 0, vorher, phase: { ...vorher, name: "Start" } })).toThrow(
			/inzwischen geändert/,
		);
	});
});

describe("Ablauf bearbeiten — Liste", () => {
	const LISTE = ["1. Einstieg (10 min)", "2. ~~Erarbeitung~~ (25 min)", "3. Sicherung"];

	it("bleibt eine Liste, solange nur Name und Dauer sich ändern", () => {
		const text = notiz(LISTE);
		const vorher = phaseAus(text, 2);
		const neu = bearbeiteAblauf(text, { art: "ersetzen", nummer: 2, vorher, phase: { ...vorher, dauer_min: 10 } });
		expect(neu).toContain("## Ablauf\n```uplan-zeit\n```\n\n1. Einstieg (10 min)\n2. ~~Erarbeitung~~ (25 min)\n3. Sicherung (10 min)\n\n<!-- uplan:ende -->");
	});

	it("wird zur Tabelle, sobald eine Phase mehr trägt — die übrigen und die Streichung bleiben", () => {
		const text = notiz(LISTE);
		const vorher = phaseAus(text, 0);
		const neu = bearbeiteAblauf(text, { art: "ersetzen", nummer: 0, vorher, phase: { ...vorher, sozialform: "Plenum" } });
		const imText = ablaufImText(neu);
		expect(imText?.form).toBe("tabelle");
		expect(imText?.ablauf.phasen.map((p) => [p.name, p.dauer_min, p.sozialform ?? null])).toEqual([
			["Einstieg", 10, "Plenum"],
			["Erarbeitung", 25, null],
			["Sicherung", null, null],
		]);
		expect(imText?.ablauf.stellen.map((s) => s.gestrichen)).toEqual([false, true, false]);
		expect(neu).toContain("| Kern | 10 | Einstieg |  | Plenum |  |  | `✎` |");
		expect(neu).toContain("## Notizen\nEigenes bleibt.");
	});

	it("füllt den leeren Platzhalter", () => {
		const neu = bearbeiteAblauf(notiz(["1."]), {
			art: "anhaengen",
			phase: { name: "Einstieg", dauer_min: 10, prio: "kern", beschreibung: null, sozialform: null, methode: null, material: [] },
		});
		expect(neu).toContain("```uplan-zeit\n```\n\n1. Einstieg (10 min)\n\n<!-- uplan:ende -->");
	});

	it("lässt beim Löschen der letzten Phase den Platzhalter zurück", () => {
		const text = notiz(["1. Einstieg (10 min)"]);
		const neu = bearbeiteAblauf(text, { art: "loeschen", nummer: 0, vorher: phaseAus(text, 0) });
		expect(neu).toContain("```uplan-zeit\n```\n\n1.\n\n<!-- uplan:ende -->");
	});
});
