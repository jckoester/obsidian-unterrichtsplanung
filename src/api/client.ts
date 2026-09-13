import type { HttpClient } from "./http";
import type {
	LessonRead,
	LessonUpdate,
	MyGroupsResponse,
	OverviewRead,
	SlotRead,
	SlotUpdate,
	TokenScopesResponse,
	UnitRead,
	Uuid,
} from "./types";

/**
 * Die ~10 Endpoints, die das Plugin braucht.
 *
 * **Pfade ohne `/api`:** FastAPI bedient `/planning` und `/groups`; das Präfix hängt
 * erst der Reverse-Proxy davor. Die Basis-URL in den Einstellungen enthält es deshalb
 * (z. B. `https://ki.gymnasium-ditzingen.de/api`), die Pfade hier nicht.
 */
export class GgdApiClient {
	constructor(private readonly http: HttpClient) {}

	/** Eigene Unterrichtsgruppen — Grundlage der Gruppen-Zuordnung in den Einstellungen. */
	async myGroups(): Promise<MyGroupsResponse> {
		const { json } = await this.http.send<MyGroupsResponse>({
			method: "GET",
			path: "/groups/me",
		});
		return json;
	}

	/** Scope-Liste — dient zugleich als billigster Token-Test. */
	async tokenScopes(): Promise<TokenScopesResponse> {
		const { json } = await this.http.send<TokenScopesResponse>({
			method: "GET",
			path: "/tokens/scopes",
		});
		return json;
	}

	async overview(groupId: number, halbjahr?: number): Promise<OverviewRead> {
		const { json } = await this.http.send<OverviewRead>({
			method: "GET",
			path: `/planning/groups/${groupId}/overview`,
			query: { halbjahr },
		});
		return json;
	}

	async units(groupId: number): Promise<UnitRead[]> {
		const { json } = await this.http.send<UnitRead[]>({
			method: "GET",
			path: `/planning/groups/${groupId}/units`,
		});
		return json;
	}

	async lesson(nodeId: Uuid): Promise<LessonRead> {
		const { json } = await this.http.send<LessonRead>({
			method: "GET",
			path: `/planning/lessons/${nodeId}`,
		});
		return json;
	}

	async lessonExport(nodeId: Uuid, format = "md"): Promise<string> {
		const { json } = await this.http.send<string>({
			method: "GET",
			path: `/planning/lessons/${nodeId}/export`,
			query: { format },
		});
		return json;
	}

	// ── Schreibpfad (Stufe 2) ────────────────────────────────────────────────
	// Beide Endpunkte legen selbst einen Snapshot an; das Plugin muss vorher keinen
	// erzeugen. `expected_updated_at` mitschicken, sobald es gesetzt werden kann.

	async patchSlot(slotId: Uuid, patch: SlotUpdate): Promise<SlotRead> {
		const { json } = await this.http.send<SlotRead>({
			method: "PATCH",
			path: `/planning/slots/${slotId}`,
			body: patch,
		});
		return json;
	}

	async patchLesson(
		nodeId: Uuid,
		patch: LessonUpdate,
	): Promise<Record<string, unknown>> {
		const { json } = await this.http.send<Record<string, unknown>>({
			method: "PATCH",
			path: `/planning/lessons/${nodeId}`,
			body: patch,
		});
		return json;
	}
}
