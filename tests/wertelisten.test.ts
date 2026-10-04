import { describe, expect, it } from "vitest";
import type { ContextNodeRead } from "../src/api/types";
import { GgdApiClient } from "../src/api/client";
import type { HttpClient, HttpRequest, HttpResponse } from "../src/api/http";
import { mischePhasen, normalisierePhasen } from "../src/sync/phasen";
import { ladeWertelisten } from "../src/sync/runner";
import { eintraegeAus, findeEintrag, type Wertelisten } from "../src/sync/wertelisten";

function knoten(id: string, title: string, aliase: string[] = [], subject_id: number | null = null): ContextNodeRead {
	return {
		id,
		content_type: "sozialform",
		title,
		metadata: {},
		status: "active",
		read_scope_group_id: null,
		updated_at: "2026-10-04T08:00:00Z",
		aliase,
		subject_id,
	};
}

const LISTEN: Wertelisten = {
	sozialform: eintraegeAus([
		knoten("s-pa", "Partnerarbeit"),
		knoten("s-ea", "Einzelarbeit", ["Stillarbeit"]),
		knoten("s-pl", "Plenum", ["Unterrichtsgespräch"]),
	]),
	methode: eintraegeAus([knoten("m-tps", "Think-Pair-Share", ["Ich-Du-Wir"])]),
};

describe("Wertelisten", () => {
	it("sortiert nach Titel und übernimmt Aliase und Fach", () => {
		const liste = eintraegeAus([knoten("b", " Plenum "), knoten("a", "Einzelarbeit", ["Stillarbeit"], 6), knoten("x", "  ")]);
		expect(liste).toEqual([
			{ id: "a", titel: "Einzelarbeit", aliase: ["Stillarbeit"], subject_id: 6 },
			{ id: "b", titel: "Plenum", aliase: [], subject_id: null },
		]);
	});

	it("findet einen Eintrag über Titel oder Alias, ohne auf die Schreibung zu achten", () => {
		expect(findeEintrag(LISTEN.sozialform, "partnerarbeit")?.id).toBe("s-pa");
		expect(findeEintrag(LISTEN.sozialform, " Stillarbeit ")?.id).toBe("s-ea");
		expect(findeEintrag(LISTEN.sozialform, "PA")).toBeUndefined();
		expect(findeEintrag(LISTEN.sozialform, "")).toBeUndefined();
	});
});

describe("Mischen mit Wertelisten", () => {
	const server = normalisierePhasen([
		{ id: "p1", name: "Einstieg", dauer_min: 10, sozialform: { typ: "text", wert: "Partnerarbeit" } },
	]);

	it("macht einen neuen Wert, der einem Eintrag gleicht, zum Verweis — auch über einen Alias", () => {
		const [p] = mischePhasen(server, [{ name: "Einstieg", sozialform: "Stillarbeit", methode: "Ich-Du-Wir" }], LISTEN);
		expect(p?.sozialform).toEqual({ typ: "node", wert: null, node_id: "s-ea", titel: "Einzelarbeit" });
		expect(p?.methode).toEqual({ typ: "node", wert: null, node_id: "m-tps", titel: "Think-Pair-Share" });
	});

	// Sonst wiche jede Phase mit einem solchen Freitext vom Serverstand ab, und jede
	// vault-geänderte Notiz schickte Phasen mit, die niemand angefasst hat.
	it("lässt einen unveränderten Freitext Freitext, auch wenn er einem Eintrag gleicht", () => {
		const [p] = mischePhasen(server, [{ name: "Einstieg", sozialform: "Partnerarbeit" }], LISTEN);
		expect(p?.sozialform).toEqual({ typ: "text", wert: "Partnerarbeit", node_id: null, titel: null });
	});

	it("sucht nur in der passenden Liste und lässt Unbekanntes Freitext", () => {
		const [p] = mischePhasen(server, [{ name: "Einstieg", sozialform: "PA", methode: "Unterrichtsgespräch" }], LISTEN);
		expect(p?.sozialform).toMatchObject({ typ: "text", wert: "PA" });
		expect(p?.methode).toMatchObject({ typ: "text", wert: "Unterrichtsgespräch" });
	});

	it("schreibt ohne Wertelisten Freitext, wie bisher", () => {
		const [p] = mischePhasen(server, [{ name: "Einstieg", sozialform: "Einzelarbeit" }]);
		expect(p?.sozialform).toMatchObject({ typ: "text", wert: "Einzelarbeit" });
	});
});

describe("Wertelisten laden", () => {
	// Die Fixture-Naht unterscheidet nicht nach Query; hier kommt es genau darauf an.
	class NachTyp implements HttpClient {
		readonly anfragen: HttpRequest[] = [];
		async send<T>(req: HttpRequest): Promise<HttpResponse<T>> {
			this.anfragen.push(req);
			const typ = req.query?.["content_type"];
			const antwort = typ === "sozialform" ? [knoten("s-pa", "Partnerarbeit")] : [knoten("m-tps", "Think-Pair-Share")];
			return { status: 200, json: antwort as T };
		}
	}

	it("holt beide Listen über /context/nodes, je nach Typ", async () => {
		const http = new NachTyp();
		const listen = await ladeWertelisten(new GgdApiClient(http));
		expect(listen.sozialform.map((e) => e.titel)).toEqual(["Partnerarbeit"]);
		expect(listen.methode.map((e) => e.titel)).toEqual(["Think-Pair-Share"]);
		expect(http.anfragen.map((a) => [a.path, a.query?.["content_type"], a.query?.["limit"]])).toEqual([
			["/context/nodes", "sozialform", 500],
			["/context/nodes", "methode", 500],
		]);
	});
});
