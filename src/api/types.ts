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

export interface MyGroup {
	id: number;
	name?: string;
	fach?: string;
	klasse?: string;
	[key: string]: unknown;
}

export interface MyGroupsResponse {
	groups: MyGroup[];
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

export interface LessonPhase {
	id?: string;
	name: string;
	dauer_min: number;
	beschreibung?: string | null;
	prio?: "kern" | "uebung" | "vertiefung" | string;
	[key: string]: unknown;
}

export interface LessonRead {
	id: Uuid;
	titel: string;
	stundenziel: string | null;
	phasen: LessonPhase[];
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
	stundenziel?: string;
	expected_updated_at?: IsoDateTime;
}

export interface TokenScopesResponse {
	[scope: string]: string;
}
