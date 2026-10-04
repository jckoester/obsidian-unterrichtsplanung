/**
 * Handgeführte Teilmenge der Plattform-Schemas (`backend/app/planning/schemas.py`,
 * Stand v0.9.x). Nur die ~10 Endpoints, die das Plugin benutzt.
 *
 * Die vollständigen Typen kommen bei Bedarf aus der OpenAPI-Spec
 * (`npm run api-types --spec=https://.../api/openapi.json`); diese Datei bleibt die
 * schmale, gelesene Schnittstelle davor — damit ein Schema-Umbau an genau einer
 * Stelle auffällt.
 */

export type Uuid = string;
export type IsoDate = string; // YYYY-MM-DD
export type IsoDateTime = string;

export type SlotKategorie =
	| "unterricht"
	| "ausfall"
	| "pruefung"
	| "puffer"
	| "vertretung";

/** `GroupOut` der Plattform (`backend/app/api/groups.py`). */
export interface MyGroup {
	id: number;
	name: string;
	slug: string;
	type: string;
	subject_id: number | null;
	sso_group_id: string | null;
	source_class_group_id: number | null;
	created_at: IsoDateTime;
}

/** Achtung: `items`, nicht `groups` — so heißt das Feld in `MyGroupsResponse`. */
export interface MyGroupsResponse {
	items: MyGroup[];
}

export interface SlotRead {
	id: Uuid;
	group_id: number;
	date: IsoDate;
	start_period: number | null;
	periods: number;
	halbjahr: number;
	kategorie: SlotKategorie | string;
	ue_node_id: Uuid | null;
	stunde_node_id: Uuid | null;
	thema: string | null;
	pinned: boolean;
	anpassung_noetig: boolean;
	note: string | null;
	nachbereitet_at: IsoDateTime | null;
	nachbereitet_auto: boolean;
	created_at: IsoDateTime;
	updated_at: IsoDateTime;
	/** Sagt, ob der verknüpfte Entwurf Phasen hat — ohne die Stunde zu laden. */
	hat_phasen: boolean;
}

export interface UnitRead {
	id: Uuid;
	title: string;
	metadata_: Record<string, unknown>;
	kapitel_node_id: Uuid | null;
	kapitel_std: number | null;
	updated_at: IsoDateTime;
}

/** `LessonLinkedItem`: Freitext (`wert`) oder Verweis auf einen Baustein (`node_id`, `titel`). */
export interface LessonLinkedItem {
	typ: string;
	wert: string | null;
	node_id: Uuid | null;
	titel: string | null;
}

/**
 * `LessonPhaseItem` — die Schemafelder einer Phase, genau das, was ein Editor zurückschickt.
 * Felder darüber hinaus (`status`, `kuerzung`, `uebertrag_von`) übernimmt die Plattform seit
 * 0.13 selbst aus dem gespeicherten Stand, sofern die `id` mitkommt.
 */
export interface LessonPhaseItem {
	id: string | null;
	name: string;
	/** `null` seit 0.13: eine Phase ohne Dauer (Skizze). */
	dauer_min: number | null;
	beschreibung: string | null;
	prio: string;
	sozialform: LessonLinkedItem | null;
	methode: LessonLinkedItem | null;
	material: LessonLinkedItem[];
}

export interface LessonRead {
	id: Uuid;
	titel: string;
	stundenziel: string | null;
	/** Roh, wie gespeichert — gelesen über `normalisierePhasen`. */
	phasen: unknown[];
	refs: unknown[];
	refs_dismissed: string[];
	ue: { id: Uuid; titel: string; farbe: number } | null;
	slot: {
		id: Uuid;
		date: IsoDate;
		start_period: number | null;
		periods: number;
		verfuegbare_min: number;
	} | null;
	group_id: number;
	darf_bearbeiten: boolean;
	updated_at: IsoDateTime;
}

/**
 * `ContextNodeRead` (`backend/app/context/schemas.py`), soweit der Sync ihn liest. Für
 * Stundenknoten stehen Stundenziel und Phasen in `metadata` — dasselbe Feld, das die
 * Planung als `LessonRead.stundenziel` und `.phasen` ausgibt.
 */
export interface ContextNodeRead {
	id: Uuid;
	content_type: string | null;
	title: string;
	metadata: Record<string, unknown>;
	status: string;
	read_scope_group_id: number | null;
	updated_at: IsoDateTime;
	/** Von der Liste gesetzt; `null` heißt „nicht geprüft", nicht „nein". */
	darf_schreiben?: boolean | null;
}

export interface OverviewRead {
	slots: SlotRead[];
	patterns: unknown[];
	units: UnitRead[];
	balance: unknown;
	schuljahr: string;
	beginn: IsoDate;
	ende: IsoDate;
	halbjahreswechsel: IsoDate;
	ferien?: unknown[];
	feiertage?: unknown[];
	unterrichtsfreie_tage?: unknown[];
}

/** Nur die Felder, die dem Vault gehören dürfen (Stufe 2). */
export interface SlotUpdate {
	kategorie?: string;
	thema?: string;
	note?: string;
	/** Optimistisches Sperren: 409 statt stillem Überschreiben. */
	expected_updated_at?: IsoDateTime;
}

export interface LessonUpdate {
	titel?: string;
	/** `""` leert das Stundenziel; `null` oder Fehlen lässt es stehen. */
	stundenziel?: string;
	phasen?: LessonPhaseItem[];
	/** Exakt der Serverwert als Zeichenkette — die Plattform vergleicht auf Gleichheit. */
	expected_updated_at?: IsoDateTime;
}

/** Antwort auf `PATCH /planning/lessons/{id}` seit 0.13 (P3): der gespeicherte Stand. */
export interface LessonPatchAntwort {
	ok: boolean;
	updated_at: IsoDateTime;
	phasen: unknown[];
	stundenziel: string | null;
}
