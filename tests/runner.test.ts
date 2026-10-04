import { describe, expect, it } from "vitest";
import overview from "../fixtures/overview-group1.json";
import gruppen from "../fixtures/groups-me.json";
import knoten from "../fixtures/context-nodes-group1.json";
import type { OverviewRead, SlotRead } from "../src/api/types";
import { GgdApiClient } from "../src/api/client";
import { FixtureHttpClient } from "../src/api/http";
import type { GruppenZuordnung } from "../src/sync/materialize";
import { syncGruppe } from "../src/sync/runner";
import { InMemoryVaultAdapter } from "../src/sync/vault-adapter";

const zuordnung: GruppenZuordnung = {
	groupId: 1,
	lehrauftragLink: "",
	fach: "NwT",
	stufe: 9,
	ordner: "Bereiche/11 Unterricht/NwT 9",
	stundenOrdner: "Unterrichtsstunden",
};

const stand = overview as unknown as OverviewRead;

function apiMit(
	serverstand: OverviewRead,
	weitere: Record<string, unknown> = {},
	statuses: Record<string, number> = {},
) {
	return new GgdApiClient(
		new FixtureHttpClient(
			{
				"GET /planning/groups/1/overview": serverstand,
				"GET /context/nodes": knoten,
				"GET /groups/me": gruppen,
				...weitere,
			},
			statuses,
		),
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
		const besetzt = `${STUNDEN}/NwT 9 2026-09-15.md`;
		await vault.write(besetzt, "# Von Hand angelegt\n");

		const ergebnis = await syncGruppe(api(), vault, zuordnung, false);

		expect(ergebnis.fehler.some((f) => f.includes("2026-09-15"))).toBe(true);
		expect(await vault.read(besetzt)).toBe("# Von Hand angelegt\n");
	});

	// Der Alltagsfall in einem Stück: ein Schuljahr in klein, von Hand ergänzte Notizen,
	// und eine Änderung, die alles auf einmal tut — streichen, einfügen, verschieben, und
	// ein zweiter Termin an einem Tag, der schon einen hat.
	it("übersteht eine durchmischte Änderung und beruhigt sich danach", async () => {
		const vault = new InMemoryVaultAdapter();
		await syncGruppe(apiMit(schuljahr(12)), vault, zuordnung, false);
		expect(slotIds(vault).size).toBe(12);

		for (const tag of ["03", "07", "11"]) {
			const pfad = `${STUNDEN}/NwT 9 2026-10-${tag}.md`;
			const eigen = (await vault.read(pfad)).replace(
				"## Notizen",
				"## Notizen\nMaterial liegt im Schrank.",
			);
			await vault.write(pfad, eigen);
		}

		const geaendert = schuljahr(12);
		geaendert.slots = geaendert.slots.filter((s) => s.id !== "slot-4" && s.id !== "slot-9");
		geaendert.slots.push({ ...baueSlot(13, 1), date: "2026-09-30" }); // ganz nach vorne
		geaendert.slots.push({ ...baueSlot(14, 6), start_period: 5 }); // zweiter Termin am 6.
		const verschoben = geaendert.slots.find((s) => s.id === "slot-12");
		if (verschoben) verschoben.date = "2026-10-04"; // auf den Tag der gestrichenen Stunde 4
		for (const s of geaendert.slots) s.thema = `${s.thema}, überarbeitet`;

		const ergebnis = await syncGruppe(apiMit(geaendert), vault, zuordnung, false);
		expect(ergebnis.fehler).toHaveLength(0);
		// Zwölf aktive und zwei archivierte Notizen — keine ist verloren gegangen.
		expect(slotIds(vault).size).toBe(14);
		expect(vault.files.has(`${STUNDEN}/NwT 9 2026-10-06 (5. Std.).md`)).toBe(true);
		// Eigene Zeilen sind kein Konflikt mehr — sie stehen genau einmal da.
		const sieben = await vault.read(`${STUNDEN}/NwT 9 2026-10-07.md`);
		expect(sieben.split("Material liegt im Schrank.")).toHaveLength(2);
		expect(sieben).not.toContain("Sync-Konflikt");

		const dritt = await syncGruppe(apiMit(geaendert), vault, zuordnung, false);
		expect(dritt.plan.ops.every((o) => o.art === "unveraendert")).toBe(true);
	});

	it("holt eine archivierte Notiz zurück, wenn ihr Termin wiederkommt", async () => {
		const vault = new InMemoryVaultAdapter();
		await syncGruppe(api(), vault, zuordnung, false);

		const ohneZweite = structuredClone(stand);
		ohneZweite.slots = [ohneZweite.slots[0]!];
		await syncGruppe(apiMit(ohneZweite), vault, zuordnung, false);
		expect(vault.files.has(`${STUNDEN}/NwT 9 2026-09-22 (archiviert).md`)).toBe(true);

		const ergebnis = await syncGruppe(api(), vault, zuordnung, false);
		expect(ergebnis.fehler).toHaveLength(0);
		expect(vault.files.has(`${STUNDEN}/NwT 9 2026-09-22 (archiviert).md`)).toBe(false);
		expect(await vault.read(`${STUNDEN}/NwT 9 2026-09-22.md`)).toContain("uplan_status: aktiv");
	});

	it("schreibt das Stundenziel aus dem Sammelabruf ins Frontmatter", async () => {
		const vault = new InMemoryVaultAdapter();
		await syncGruppe(api(), vault, zuordnung, false);
		expect(await vault.read(`${STUNDEN}/NwT 9 2026-09-22.md`)).toContain(
			"Stundenziel: Übersetzungsverhältnisse an Zahnradgetrieben berechnen",
		);
	});

	// Der Sammelabruf filtert über die Gruppe des Knotens. Ein Knoten aus der Vorjahresgruppe,
	// per Kopie oder von Hand an den Slot gehängt, fällt dort heraus.
	it("holt einen Stundenknoten aus fremder Gruppe einzeln nach", async () => {
		const vault = new InMemoryVaultAdapter();
		const fremd = { stundenziel: "Aus dem Vorjahr übernommen" };
		await syncGruppe(
			apiMit(stand, {
				"GET /context/nodes": [],
				"GET /planning/lessons/bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb": fremd,
			}),
			vault,
			zuordnung,
			false,
		);
		expect(await vault.read(`${STUNDEN}/NwT 9 2026-09-22.md`)).toContain(
			"Stundenziel: Aus dem Vorjahr übernommen",
		);
	});

	it("bricht nicht ab, wenn ein Stundenknoten gar nicht lesbar ist", async () => {
		const vault = new InMemoryVaultAdapter();
		const ergebnis = await syncGruppe(apiMit(stand, { "GET /context/nodes": [] }), vault, zuordnung, false);
		expect(ergebnis.fehler).toHaveLength(0);
		expect(await vault.read(`${STUNDEN}/NwT 9 2026-09-22.md`)).toMatch(/^Stundenziel:$/m);
	});

	it("sagt bei gesperrtem Sammelabruf, welcher Scope fehlt", async () => {
		const vault = new InMemoryVaultAdapter();
		await expect(
			syncGruppe(apiMit(stand, {}, { "GET /context/nodes": 403 }), vault, zuordnung, false),
		).rejects.toThrow("context:read");
		expect(vault.files.size).toBe(0);
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

describe("syncGruppe — Rückkanal", () => {
	const B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
	const ZWEITE = `${STUNDEN}/NwT 9 2026-09-22.md`;
	const ERSTE = `${STUNDEN}/NwT 9 2026-09-15.md`;
	const NEU = "cccccccc-3333-4333-8333-cccccccccccc";

	/** Die Antwort der Plattform auf das PATCH: gespeichert, mit Kennung für die neue Phase. */
	const antwort = {
		ok: true,
		updated_at: "2026-10-03T19:49:20.811852Z",
		stundenziel: "Übersetzungsverhältnisse an Zahnradgetrieben berechnen",
		phasen: [
			{ id: "p1", name: "Hinweise zur Arbeit", dauer_min: 5, prio: "kern" },
			{ id: "p2", name: "Bearbeitung", dauer_min: 75, prio: "kern" },
			{ id: "p3", name: "Abgabe", dauer_min: 5, prio: "kern" },
		],
	};

	function plattform(weitere: Record<string, unknown> = {}, statuses: Record<string, number> = {}) {
		const http = new FixtureHttpClient(
			{
				"GET /planning/groups/1/overview": stand,
				"GET /context/nodes": knoten,
				"GET /health": { status: "ok", version: "0.13.0" },
				[`PATCH /planning/lessons/${B}`]: antwort,
				...weitere,
			},
			statuses,
		);
		return { http, api: new GgdApiClient(http) };
	}

	async function mitBearbeiteterStunde() {
		const vault = new InMemoryVaultAdapter();
		await syncGruppe(api(), vault, zuordnung, false);
		const vorher = await vault.read(ZWEITE);
		expect(vorher).toContain("2. Bearbeitung (80 min)");
		await vault.write(ZWEITE, vorher.replace("2. Bearbeitung (80 min)", "2. Bearbeitung (75 min)\n3. Abgabe (5 min)"));
		return vault;
	}

	it("schreibt zurück, trägt die Buchführung ein, und der nächste Lauf ist ruhig", async () => {
		const vault = await mitBearbeiteterStunde();
		const { http, api: schreibend } = plattform();
		const ergebnis = await syncGruppe(schreibend, vault, zuordnung, false);
		expect(ergebnis.fehler).toEqual([]);

		const patch = http.calls.find((c) => c.method === "PATCH");
		const body = patch?.body as { expected_updated_at: string; phasen: { id: string | null; dauer_min: number }[] };
		expect(body.expected_updated_at).toBe("2026-09-10T12:00:00Z");
		expect(body.phasen.map((p) => [p.id, p.dauer_min])).toEqual([["p1", 5], ["p2", 75], [null, 5]]);
		// Der Rumpf bleibt, wie er im Vault steht.
		expect(await vault.read(ZWEITE)).toContain("3. Abgabe (5 min)");

		// Der nächste Lauf sieht den gespeicherten Stand — und hat nichts zu tun.
		const danach = [{ ...knoten[0], updated_at: antwort.updated_at, metadata: { ...knoten[0]!.metadata, phasen: antwort.phasen } }];
		const zweit = await syncGruppe(apiMit(stand, { "GET /context/nodes": danach }), vault, zuordnung, false);
		expect(zweit.plan.ops.every((o) => o.art === "unveraendert")).toBe(true);
	});

	it("schreibt gegen eine zu alte Plattform nicht zurück", async () => {
		const vault = await mitBearbeiteterStunde();
		const { http, api: alt } = plattform({ "GET /health": { status: "ok", version: "0.12.1" } });
		const ergebnis = await syncGruppe(alt, vault, zuordnung, false);
		expect(ergebnis.fehler.join()).toContain("0.12.1");
		expect(http.calls.some((c) => c.method === "PATCH")).toBe(false);
	});

	it("überschreibt bei 409 nichts und meldet es", async () => {
		const vault = await mitBearbeiteterStunde();
		const vorher = await vault.read(ZWEITE);
		const { api: veraltet } = plattform({}, { [`PATCH /planning/lessons/${B}`]: 409 });
		const ergebnis = await syncGruppe(veraltet, vault, zuordnung, false);
		expect(ergebnis.fehler.join()).toContain("inzwischen geändert");
		expect(await vault.read(ZWEITE)).toBe(vorher);
	});

	it("legt für einen gefüllten Platzhalter erst den Entwurf an, dann schreibt es", async () => {
		const vault = new InMemoryVaultAdapter();
		await syncGruppe(api(), vault, zuordnung, false);
		await vault.write(ERSTE, (await vault.read(ERSTE)).replace("## Ablauf\n1.", "## Ablauf\n1. Einstieg (10 min)"));
		const { http, api: schreibend } = plattform({
			[`POST /planning/slots/${stand.slots[0]!.id}/lesson`]: { id: NEU, neu: true },
			[`PATCH /planning/lessons/${NEU}`]: { ...antwort, stundenziel: null, phasen: [{ id: "q1", name: "Einstieg", dauer_min: 10 }] },
		});
		const ergebnis = await syncGruppe(schreibend, vault, zuordnung, false);
		expect(ergebnis.fehler).toEqual([]);
		expect(http.calls.map((c) => `${c.method} ${c.path}`)).toContain(`PATCH /planning/lessons/${NEU}`);
		expect(http.calls.find((c) => c.method === "PATCH")?.body).not.toHaveProperty("expected_updated_at");
		expect(await vault.read(ERSTE)).toContain(`uplan_node_id: ${NEU}`);
	});

	it("zeigt im Probelauf, was zurückginge, und schickt nichts", async () => {
		const vault = await mitBearbeiteterStunde();
		const { http, api: schreibend } = plattform();
		const ergebnis = await syncGruppe(schreibend, vault, zuordnung, true);
		expect(ergebnis.plan.ops.find((o) => o.pfad === ZWEITE)?.art).toBe("zurueckschreiben");
		expect(http.calls.some((c) => c.method === "PATCH" || c.path === "/health")).toBe(false);
	});
});
