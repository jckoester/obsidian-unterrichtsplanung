import { describe, expect, it } from "vitest";
import overview from "../fixtures/overview-group1.json";
import gruppen from "../fixtures/groups-me.json";
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

function api() {
	return new GgdApiClient(
		new FixtureHttpClient({
			"GET /planning/groups/1/overview": overview,
			"GET /groups/me": gruppen,
		}),
	);
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
