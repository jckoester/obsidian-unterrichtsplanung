import { describe, expect, it } from "vitest";
import gruppenAntwort from "../fixtures/planning-groups.json";
import type { Planungsgruppe } from "../src/api/types";
import {
	gruppenVorschlaege,
	neueGruppen,
	ordnerPfad,
	pruefeOrdnername,
	vorschlagOrdnername,
	zuordnungFuer,
	type GruppenEinstellung,
} from "../src/gruppen";
import { pruefeZuordnung } from "../src/sync/materialize";
import { ladeEinstellungen, STANDARD_EINSTELLUNGEN } from "../src/settings";

const plattform = gruppenAntwort.items as Planungsgruppe[];
const nach = (name: string) => plattform.find((g) => g.name === name) as Planungsgruppe;

function eingerichtet(groupId: number, ordnerName: string): GruppenEinstellung {
	return {
		groupId,
		plattformName: `gruppe-${groupId}`,
		ordnerName,
		lehrauftragLink: "",
		fach: "",
		stufe: null,
		stundenOrdner: "Unterrichtsstunden",
	};
}

describe("Ordnername vorschlagen", () => {
	it("nimmt Fach und Klasse, wie sie im Vault heißen", () => {
		expect(vorschlagOrdnername(nach("9C"))).toBe("M 9c");
		expect(vorschlagOrdnername(nach("ch-ks-9d"))).toBe("CH 9d");
	});

	it("nimmt den Jahrgang, wenn die Gruppe keine einzelne Klasse hat", () => {
		// NwT steht als Name da, nicht als Kürzel NWT — kurze Fachnamen sind schon die Konvention.
		expect(vorschlagOrdnername(nach("nwt-tl-9abcd"))).toBe("NwT 9");
		expect(vorschlagOrdnername({ ...nach("9C"), klassen: ["9A", "9B"] })).toBe("M 9");
		expect(vorschlagOrdnername(nach("ch-tl-abi28"))).toBe("CH 11");
	});

	it("lässt einen vorhandenen Ordner gewinnen, der sich nur in der Schreibung unterscheidet", () => {
		expect(vorschlagOrdnername(nach("ch-ks-9d"), ["IuM 6", "Ch 9d"])).toBe("Ch 9d");
	});

	it("fällt ohne Fach und Jahrgang auf den Plattformnamen zurück", () => {
		expect(vorschlagOrdnername({ ...nach("ch-tl-abi28"), fach: null, jahrgang: null })).toBe("ch-tl-abi28");
	});
});

describe("Gruppen holen", () => {
	it("bietet nur aktuelle Gruppen an, die weder eingerichtet noch ausgeblendet sind", () => {
		const neu = neueGruppen(plattform, [eingerichtet(1, "NwT 9")], [{ groupId: 3, name: "ch-ks-9d" }]);
		// 5 fällt weg, weil sie zu einem früheren Schuljahr gehört.
		expect(neu.map((g) => g.id)).toEqual([2, 4]);
	});

	it("belegt Fach, Stufe und Unterordner vor", () => {
		const [vorschlag] = gruppenVorschlaege([nach("nwt-tl-9abcd")], [], [], []);
		expect(vorschlag).toEqual({
			groupId: 1,
			plattformName: "nwt-tl-9abcd",
			ordnerName: "NwT 9",
			lehrauftragLink: "",
			fach: "NwT",
			stufe: 9,
			stundenOrdner: "Unterrichtsstunden",
		});
	});

	it("vergibt keinen Ordnernamen doppelt", () => {
		const zweiterKurs = { ...nach("ch-tl-abi28"), id: 6, name: "ch-ls-abi28" };
		const vorschlaege = gruppenVorschlaege([nach("ch-tl-abi28"), zweiterKurs], [eingerichtet(1, "NwT 9")], [], []);
		expect(vorschlaege.map((g) => g.ordnerName)).toEqual(["CH 11", "CH 11 (ch-ls-abi28)"]);

		const schonDa = gruppenVorschlaege([nach("nwt-tl-9abcd")], [eingerichtet(7, "nwt 9")], [], []);
		expect(schonDa[0]?.ordnerName).toBe("NwT 9 (nwt-tl-9abcd)");
	});
});

describe("Ordner einer Gruppe", () => {
	it("setzt Basisordner und Namen zusammen", () => {
		expect(ordnerPfad("Bereiche/11 Unterricht/", " NwT 9 ")).toBe("Bereiche/11 Unterricht/NwT 9");
	});

	// Ohne Basisordner lägen die Notizen in der Wurzel des Vaults.
	it("gibt ohne Basisordner oder Namen keinen Pfad — und der Sync weist die Gruppe ab", () => {
		expect(ordnerPfad("", "NwT 9")).toBe("");
		expect(ordnerPfad("Bereiche/11 Unterricht", "  ")).toBe("");
		expect(() => pruefeZuordnung(zuordnungFuer("", eingerichtet(1, "NwT 9")))).toThrow(/Basisordner/);
	});

	it("trimmt erst für den Sync, nicht beim Speichern", () => {
		const gruppe = { ...eingerichtet(1, "NwT 9 "), fach: " NwT ", stundenOrdner: "/Unterrichtsstunden/" };
		expect(zuordnungFuer("Bereiche/11 Unterricht", gruppe)).toMatchObject({
			ordner: "Bereiche/11 Unterricht/NwT 9",
			fach: "NwT",
			stundenOrdner: "Unterrichtsstunden",
		});
	});

	it("prüft den Ordnernamen", () => {
		const alle = [eingerichtet(1, "NwT 9"), eingerichtet(2, "M 9c")];
		expect(pruefeOrdnername("NwT 10", 1, alle)).toBeUndefined();
		expect(pruefeOrdnername("NwT 9", 1, alle)).toBeUndefined();
		expect(pruefeOrdnername(" ", 1, alle)).toMatch(/nicht synchronisiert/);
		expect(pruefeOrdnername("Unterricht/NwT 9", 1, alle)).toMatch(/kein Pfad/);
		expect(pruefeOrdnername("m 9C", 1, alle)).toMatch(/gruppe-2/);
	});
});

describe("Einstellungen laden", () => {
	it("lässt das alte Format ohne Basisordner fallen", () => {
		const geladen = ladeEinstellungen({
			basisUrl: "http://localhost/api",
			zuordnungen: [{ groupId: 31, ordner: "Bereiche/11 Unterricht/NwT 9" }],
		});
		expect(geladen).not.toHaveProperty("zuordnungen");
		expect(geladen.basisUrl).toBe("http://localhost/api");
		expect(geladen.gruppen).toEqual([]);
	});

	it("teilt seine Listen nicht mit den Vorgaben", () => {
		ladeEinstellungen(null).gruppen.push(eingerichtet(1, "NwT 9"));
		expect(STANDARD_EINSTELLUNGEN.gruppen).toEqual([]);
	});
});
