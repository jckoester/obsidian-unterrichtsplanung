import { describe, expect, it } from "vitest";
import overview from "../fixtures/overview-group1.json";
import gruppen from "../fixtures/groups-me.json";
import type { OverviewRead, SlotRead } from "../src/api/types";
import { GgdApiClient } from "../src/api/client";
import { FixtureHttpClient } from "../src/api/http";
import { STANDARD_DATEIMUSTER, type GruppenZuordnung } from "../src/sync/materialize";
import { syncGruppe } from "../src/sync/runner";
import { InMemoryVaultAdapter } from "../src/sync/vault-adapter";

const zuordnung: GruppenZuordnung = {
	groupId: 1,
	lehrauftragLink: "",
	fach: "NwT",
	stufe: 9,
	ordner: "Bereiche/11 Unterricht/NwT 9",
	stundenOrdner: "Unterrichtsstunden",
	dateiMuster: STANDARD_DATEIMUSTER,
};

const stand = overview as unknown as OverviewRead;

function apiMit(serverstand: OverviewRead) {
	return new GgdApiClient(
		new FixtureHttpClient({
			"GET /planning/groups/1/overview": serverstand,
			"GET /groups/me": gruppen,
		}),
	);
}

function api() {
	return apiMit(stand);
}

const STUNDEN = "Bereiche/11 Unterricht/NwT 9/Unterrichtsstunden";

/** Welche Slots im Vault angekommen sind — die Frage hinter „keine Notiz verloren". */
function slotIds(vault: InMemoryVaultAdapter): Set<string> {
	const ids = new Set<string>();
	for (const [pfad, inhalt] of vault.files) {
		if (!pfad.startsWith(STUNDEN)) continue;
		const treffer = /^uplan_slot_id: (.*)$/m.exec(inhalt);
		if (treffer?.[1]) ids.add(treffer[1]);
	}
	return ids;
}

/** Ein Slot am n-ten Oktobertag — genug Stunden, damit sich Nummern wirklich schieben. */
function baueSlot(nr: number, tag: number): SlotRead {
	return {
		...structuredClone(stand.slots[0] as SlotRead),
		id: `slot-${nr}`,
		date: `2026-10-${String(tag).padStart(2, "0")}`,
		thema: `Thema ${nr}`,
	};
}

function schuljahr(stunden: number): OverviewRead {
	const serverstand = structuredClone(stand);
	serverstand.slots = Array.from({ length: stunden }, (_, i) => baueSlot(i + 1, i + 1));
	return serverstand;
}

describe("syncGruppe", () => {
	it("schreibt im Probelauf nichts", async () => {
		const vault = new InMemoryVaultAdapter();
		const ergebnis = await syncGruppe(api(), vault, zuordnung, true);
		expect(ergebnis.ausgefuehrt).toBe(false);
		expect(vault.files.size).toBe(0);
		// Lehrauftragsnotiz + eine UE + zwei Stunden.
		expect(ergebnis.plan.ops).toHaveLength(4);
	});

	it("schreibt scharf geschaltet die Notizen", async () => {
		const vault = new InMemoryVaultAdapter();
		const ergebnis = await syncGruppe(api(), vault, zuordnung, false);
		expect(ergebnis.fehler).toHaveLength(0);
		expect(vault.files.size).toBe(4);
		expect([...vault.files.keys()]).toContain("Bereiche/11 Unterricht/NwT 9/NwT 9.md");
	});

	// Die drei folgenden Zusagen prüfen nicht den Plan, sondern seine Ausführung: Der
	// Plan entsteht gegen das alte Dateibild, geschrieben wird gegen das mitwandernde.
	it("verliert keine Notiz, wenn vorne eine Stunde dazukommt", async () => {
		const vault = new InMemoryVaultAdapter();
		await syncGruppe(api(), vault, zuordnung, false);

		const mitAuftakt = structuredClone(stand);
		mitAuftakt.slots.push({
			...structuredClone(stand.slots[0]!),
			id: "99999999-9999-4999-8999-999999999999",
			date: "2026-09-08",
			thema: "Auftakt",
		});
		const ergebnis = await syncGruppe(apiMit(mitAuftakt), vault, zuordnung, false);

		expect(ergebnis.fehler).toHaveLength(0);
		expect(slotIds(vault)).toEqual(new Set(mitAuftakt.slots.map((s) => s.id)));
		expect(vault.files.size).toBe(5); // Lehrauftrag, UE, drei Stunden
	});

	it("löst einen Ringtausch auf, ohne eine Notiz zu verlieren", async () => {
		const vault = new InMemoryVaultAdapter();
		await syncGruppe(api(), vault, zuordnung, false);

		const getauscht = structuredClone(stand);
		getauscht.slots[0]!.date = "2026-09-22";
		getauscht.slots[1]!.date = "2026-09-15";
		const ergebnis = await syncGruppe(apiMit(getauscht), vault, zuordnung, false);

		expect(ergebnis.fehler).toHaveLength(0);
		expect(slotIds(vault)).toEqual(new Set(stand.slots.map((s) => s.id)));
		expect([...vault.files.keys()].some((p) => p.includes("Zwischenschritt"))).toBe(false);
	});

	it("überschreibt keine vault-eigene Datei, sondern meldet sie", async () => {
		const vault = new InMemoryVaultAdapter();
		const besetzt = `${STUNDEN}/NwT 9 Stunde 1.md`;
		await vault.write(besetzt, "# Von Hand angelegt\n");

		const ergebnis = await syncGruppe(api(), vault, zuordnung, false);

		expect(ergebnis.fehler.some((f) => f.includes("Stunde 1"))).toBe(true);
		expect(await vault.read(besetzt)).toBe("# Von Hand angelegt\n");
	});

	// Der Alltagsfall in einem Stück: ein Schuljahr in klein, von Hand ergänzte Notizen,
	// und eine Änderung, die alles auf einmal tut — streichen, einfügen, verschieben.
	it("übersteht eine durchmischte Änderung und beruhigt sich danach", async () => {
		const vault = new InMemoryVaultAdapter();
		await syncGruppe(apiMit(schuljahr(12)), vault, zuordnung, false);
		expect(slotIds(vault).size).toBe(12);

		for (const nr of [3, 7, 11]) {
			const pfad = `${STUNDEN}/NwT 9 Stunde ${nr}.md`;
			const eigen = (await vault.read(pfad)).replace(
				"## Eigene Notizen",
				"## Eigene Notizen\nMaterial liegt im Schrank.",
			);
			await vault.write(pfad, eigen);
		}

		const geaendert = schuljahr(12);
		geaendert.slots = geaendert.slots.filter((s) => s.id !== "slot-4" && s.id !== "slot-9");
		geaendert.slots.push(baueSlot(13, 1)); // rutscht ganz nach vorne
		geaendert.slots.push(baueSlot(14, 6)); // und eine in die Mitte
		const verschoben = geaendert.slots.find((s) => s.id === "slot-12");
		if (verschoben) verschoben.date = "2026-10-02";
		for (const s of geaendert.slots) s.thema = `${s.thema}, überarbeitet`;

		const ergebnis = await syncGruppe(apiMit(geaendert), vault, zuordnung, false);
		expect(ergebnis.fehler).toHaveLength(0);
		// Zwölf aktive und zwei archivierte Notizen — keine ist verloren gegangen.
		expect(slotIds(vault).size).toBe(14);

		const dritt = await syncGruppe(apiMit(geaendert), vault, zuordnung, false);
		expect(dritt.plan.ops.every((o) => o.art === "unveraendert")).toBe(true);
	});

	it("läuft zweimal hintereinander ohne Änderung", async () => {
		const vault = new InMemoryVaultAdapter();
		await syncGruppe(api(), vault, zuordnung, false);
		const zweit = await syncGruppe(api(), vault, zuordnung, false);
		// Die Lehrauftragsnotiz taucht gar nicht mehr auf — sie existiert und gehört dem
		// Vault; die übrigen sind unverändert.
		expect(zweit.plan.ops.every((o) => o.art === "unveraendert")).toBe(true);
		expect(zweit.plan.ops).toHaveLength(3);
	});
});
