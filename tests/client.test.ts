import { describe, expect, it } from "vitest";
import overview from "../fixtures/overview-group1.json";
import { GgdApiClient } from "../src/api/client";
import { FixtureHttpClient, HttpError } from "../src/api/http";

describe("GgdApiClient", () => {
	it("testet die Verbindung über /planning", async () => {
		const http = new FixtureHttpClient({ "GET /planning/groups/1/overview": overview });
		const ergebnis = await new GgdApiClient(http).verbindungstest(1);
		expect(ergebnis).toEqual({ schuljahr: "2026/27", slots: 2 });
		// Kein Aufruf außerhalb von /planning — alles andere sperrt das Scope-Gatter.
		expect(http.calls.every((c) => c.path.startsWith("/planning"))).toBe(true);
	});

	it("reicht den 403 des Scope-Gatters durch", async () => {
		const http = new FixtureHttpClient(
			{ "GET /planning/groups/1/overview": {} },
			{ "GET /planning/groups/1/overview": 403 },
		);
		await expect(new GgdApiClient(http).verbindungstest(1)).rejects.toBeInstanceOf(HttpError);
	});
});
