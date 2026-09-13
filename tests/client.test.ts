import { describe, expect, it } from "vitest";
import overview from "../fixtures/overview-group1.json";
import gruppen from "../fixtures/groups-me.json";
import { GgdApiClient } from "../src/api/client";
import { FixtureHttpClient, HttpError } from "../src/api/http";

describe("GgdApiClient", () => {
	it("liest die eigenen Gruppen aus `items`, nicht aus `groups`", async () => {
		const http = new FixtureHttpClient({ "GET /groups/me": gruppen });
		const liste = await new GgdApiClient(http).myGroups();
		expect(liste.map((g) => g.id)).toEqual([1]);
		expect(liste[0]?.name).toBe("NwT 9");
	});

	it("verträgt eine Antwort ohne items", async () => {
		const http = new FixtureHttpClient({ "GET /groups/me": {} });
		await expect(new GgdApiClient(http).myGroups()).resolves.toEqual([]);
	});

	it("probt eine Gruppe über /planning", async () => {
		const http = new FixtureHttpClient({ "GET /planning/groups/1/overview": overview });
		await expect(new GgdApiClient(http).gruppenprobe(1)).resolves.toEqual({
			schuljahr: "2026/27",
			slots: 2,
		});
	});

	it("reicht den 403 des Scope-Gatters durch", async () => {
		const http = new FixtureHttpClient({ "GET /groups/me": {} }, { "GET /groups/me": 403 });
		await expect(new GgdApiClient(http).myGroups()).rejects.toBeInstanceOf(HttpError);
	});
});
