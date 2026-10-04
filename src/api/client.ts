import { HttpError, type HttpClient } from "./http";
import type {
	ContextNodeRead,
	LessonPatchAntwort,
	LessonRead,
	LessonUpdate,
	OverviewRead,
	Planungsgruppe,
	PlanungsgruppenRead,
	SlotRead,
	SlotUpdate,
	UnitRead,
	Uuid,
} from "./types";

/** Höchstwert der Plattform für `limit` auf `/context/nodes`. */
const SEITENGROESSE = 500;
const MAX_SEITEN = 20;

function stundenFilter(groupId: number, limit: number, offset: number) {
	return { content_type: "unterrichtsstunde", group_id: groupId, limit, offset };
}

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
	 * Die eigenen Unterrichtsgruppen — Grundlage von „Gruppen holen" und zugleich der
	 * Verbindungstest, weil der Aufruf ohne `group_id` auskommt.
	 *
	 * Ab Plattform 0.13.1. Davor gab es nur `/groups/me`: jede Mitgliedschaft (Klassen,
	 * Fachschaften …) ohne Rolle und ohne Fachnamen — ob man eine Gruppe unterrichtet, verriet
	 * erst eine Probe je Gruppe. Ein 404 hier heißt deshalb meist: Plattform zu alt.
	 */
	async planungsgruppen(): Promise<Planungsgruppe[]> {
		const { json } = await this.http.send<PlanungsgruppenRead>({
			method: "GET",
			path: "/planning/groups",
		});
		return json.items ?? [];
	}

	/**
	 * Probe auf eine konkrete Gruppe — prüft zusätzlich, ob die Planung dort steht und ob
	 * die Stundenknoten lesbar sind. Das Zweite fragt den Scope `context:read` ab: Fehlt er,
	 * antwortet das Gatter mit derselben Meldung wie für einen gesperrten Pfad, und der
	 * Sync bräche erst beim nächsten Lauf ab — hier fällt es beim Einrichten auf.
	 */
	async gruppenprobe(
		groupId: number,
	): Promise<{ schuljahr: string; slots: number; stundenLesbar: boolean }> {
		const overview = await this.overview(groupId);
		let stundenLesbar = true;
		try {
			await this.http.send({ method: "GET", path: "/context/nodes", query: stundenFilter(groupId, 1, 0) });
		} catch (error) {
			if (!(error instanceof HttpError && error.status === 403)) throw error;
			stundenLesbar = false;
		}
		return { schuljahr: overview.schuljahr, slots: overview.slots.length, stundenLesbar };
	}

	/** Immer das ganze Schuljahr — die Übersicht kennt keinen Halbjahresfilter. */
	async overview(groupId: number): Promise<OverviewRead> {
		const { json } = await this.http.send<OverviewRead>({
			method: "GET",
			path: `/planning/groups/${groupId}/overview`,
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

	/**
	 * Alle Stundenknoten einer Gruppe — seitenweise je 500 statt einer Anfrage je Stunde
	 * gegen eine gedrosselte API. Braucht `context:read`.
	 *
	 * `group_id` filtert über `read_scope_group_id`. Das trifft, was die Planung anlegt,
	 * aber nicht zwingend alles, was an einem Slot hängt — siehe `holeStundenknoten`.
	 */
	async stundenknoten(groupId: number): Promise<ContextNodeRead[]> {
		const alle: ContextNodeRead[] = [];
		for (let seite = 0; seite < MAX_SEITEN; seite++) {
			const { json } = await this.http.send<ContextNodeRead[]>({
				method: "GET",
				path: "/context/nodes",
				query: stundenFilter(groupId, SEITENGROESSE, seite * SEITENGROESSE),
			});
			alle.push(...json);
			if (json.length < SEITENGROESSE) return alle;
		}
		// Eine Plattform, die `offset` überginge, lieferte endlos dieselbe volle Seite.
		throw new Error(`Mehr als ${MAX_SEITEN * SEITENGROESSE} Stundenknoten in Gruppe ${groupId}?`);
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

	/**
	 * Die Plattformversion aus `GET /health` — ohne Token erreichbar, außerhalb des Gatters.
	 * Vor dem ersten Zurückschreiben eines Laufs gefragt: Gegen eine Plattform vor 0.13
	 * verlöre das Plugin still den Nachbereitungsstatus der Phasen (P2).
	 */
	async plattformversion(): Promise<string> {
		const { json } = await this.http.send<{ version?: string }>({ method: "GET", path: "/health" });
		return json.version ?? "unbekannt";
	}

	// ── Schreibpfad ──────────────────────────────────────────────────────────
	// Beide PATCH-Endpunkte legen selbst einen Snapshot an; das Plugin muss vorher keinen
	// erzeugen.

	async patchSlot(slotId: Uuid, patch: SlotUpdate): Promise<SlotRead> {
		const { json } = await this.http.send<SlotRead>({
			method: "PATCH",
			path: `/planning/slots/${slotId}`,
			body: patch,
		});
		return json;
	}

	/** Seit 0.13 mit dem gespeicherten Stand in der Antwort (P3). */
	async patchLesson(nodeId: Uuid, patch: LessonUpdate): Promise<LessonPatchAntwort> {
		const { json } = await this.http.send<LessonPatchAntwort>({
			method: "PATCH",
			path: `/planning/lessons/${nodeId}`,
			body: patch,
		});
		return json;
	}

	/**
	 * Entwurf vom Termin aus anlegen — für einen Platzhalter, in dem im Vault der Ablauf
	 * oder das Stundenziel gefüllt wurde. Gibt es schon einen, kommt dieser zurück
	 * (`neu: false`), es entsteht kein zweiter.
	 */
	async entwurfFuerSlot(slotId: Uuid): Promise<{ id: Uuid; neu: boolean }> {
		const { json } = await this.http.send<{ id: Uuid; neu: boolean }>({
			method: "POST",
			path: `/planning/slots/${slotId}/lesson`,
		});
		return json;
	}
}
