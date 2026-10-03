import type { HttpClient } from "./http";
import type {
	LessonRead,
	LessonUpdate,
	MyGroup,
	MyGroupsResponse,
	OverviewRead,
	SlotRead,
	SlotUpdate,
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

	/**
	 * Eigene Gruppen — Grundlage der Zuordnung in den Einstellungen und zugleich der
	 * Verbindungstest, weil der Aufruf ohne `group_id` auskommt.
	 *
	 * Erreichbar seit dem Eintrag `"/groups/me": ("planning:read", "planning:write")` im
	 * Gatter (`app/auth/scopes.py`). Ein 403 hier heißt deshalb entweder: der Plattform
	 * fehlt dieser Eintrag noch, oder dem Token fehlt `planning:read`.
	 */
	async myGroups(): Promise<MyGroup[]> {
		const { json } = await this.http.send<MyGroupsResponse>({
			method: "GET",
			path: "/groups/me",
		});
		return json.items ?? [];
	}

	/** Probe auf eine konkrete Gruppe — prüft zusätzlich, ob die Planung dort steht. */
	async gruppenprobe(groupId: number): Promise<{ schuljahr: string; slots: number }> {
		const overview = await this.overview(groupId);
		return { schuljahr: overview.schuljahr, slots: overview.slots.length };
	}

	/** Immer das ganze Schuljahr — die Übersicht kennt keinen Halbjahresfilter. */
	async overview(groupId: number): Promise<OverviewRead> {
		const { json } = await this.http.send<OverviewRead>({
			method: "GET",
			path: `/planning/groups/${groupId}/overview`,
		});
		return json;
	}

	/**
	 * Jahrgangsstufe der Gruppe — zum Vorbefüllen von `Stufe` in der Zuordnung.
	 *
	 * Der Umweg über die Curriculum-Auswahl ist Absicht: Sie liegt unter `/planning` und
	 * ist damit für ein Token erreichbar, während `/subjects` und der Rest von `/groups`
	 * gesperrt bleiben. `grade` ist `null`, wenn die Plattform den Jahrgang nicht kennt.
	 */
	async groupGrade(groupId: number): Promise<number | null> {
		const { json } = await this.http.send<{ grade: number | null }>({
			method: "GET",
			path: `/planning/groups/${groupId}/curriculum-chapters`,
		});
		return json.grade ?? null;
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
