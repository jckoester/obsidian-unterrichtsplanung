/**
 * Transportschicht — eine Naht zwischen Plugin und Netz.
 *
 * Zwei Implementierungen: `RequestUrlHttpClient` spricht mit der Plattform,
 * `FixtureHttpClient` liefert aufgezeichnete Antworten aus `fixtures/`. Damit läuft
 * die gesamte Sync-Logik in vitest ohne Obsidian, ohne Server und ohne Token —
 * und die Entwicklung hängt nicht daran, dass gerade eine Dev-Instanz steht.
 */

export interface HttpRequest {
	method: "GET" | "POST" | "PATCH" | "DELETE";
	path: string; // z. B. "/planning/groups/12/overview" — ohne Basis-URL, ohne /api
	query?: Record<string, string | number | boolean | undefined>;
	body?: unknown;
}

export interface HttpResponse<T = unknown> {
	status: number;
	json: T;
}

export class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly path: string,
		readonly detail: string,
	) {
		super(`${status} ${path}: ${detail}`);
		this.name = "HttpError";
	}
}

export interface HttpClient {
	send<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>>;
}

export function buildUrl(baseUrl: string, req: HttpRequest): string {
	const base = baseUrl.replace(/\/+$/, "");
	const path = req.path.startsWith("/") ? req.path : `/${req.path}`;
	const url = new URL(`${base}${path}`);
	for (const [key, value] of Object.entries(req.query ?? {})) {
		if (value !== undefined) url.searchParams.set(key, String(value));
	}
	return url.toString();
}

type RequestUrlFn = (options: {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
	throw?: boolean;
}) => Promise<{ status: number; text: string; json: unknown }>;

/**
 * Über Obsidians `requestUrl` — nicht über `fetch`. Der Unterschied ist CORS:
 * `requestUrl` läuft am Renderer vorbei, die Plattform braucht deshalb keine
 * Origin-Freigabe für Obsidian.
 */
export class RequestUrlHttpClient implements HttpClient {
	constructor(
		private readonly requestUrl: RequestUrlFn,
		private readonly getBaseUrl: () => string,
		private readonly getToken: () => string,
	) {}

	async send<T>(req: HttpRequest): Promise<HttpResponse<T>> {
		const token = this.getToken();
		const headers: Record<string, string> = {
			Accept: "application/json",
		};
		if (token) headers["Authorization"] = `Bearer ${token}`;
		if (req.body !== undefined) headers["Content-Type"] = "application/json";

		const response = await this.requestUrl({
			url: buildUrl(this.getBaseUrl(), req),
			method: req.method,
			headers,
			body: req.body === undefined ? undefined : JSON.stringify(req.body),
			// Selbst auswerten: Ein 409 ist für den Sync eine Aussage, kein Absturz.
			throw: false,
		});

		if (response.status >= 400) {
			throw new HttpError(
				response.status,
				req.path,
				extractDetail(response),
			);
		}
		return { status: response.status, json: response.json as T };
	}
}

function extractDetail(response: { text: string; json: unknown }): string {
	const json = response.json as { detail?: unknown } | null;
	if (json && typeof json.detail === "string") return json.detail;
	return (response.text || "").slice(0, 200) || "keine Fehlermeldung";
}

/** Aufgezeichnete Antworten, adressiert über `METHOD /pfad`. */
export class FixtureHttpClient implements HttpClient {
	readonly calls: HttpRequest[] = [];

	constructor(
		private readonly fixtures: Record<string, unknown>,
		private readonly statuses: Record<string, number> = {},
	) {}

	async send<T>(req: HttpRequest): Promise<HttpResponse<T>> {
		this.calls.push(req);
		const key = `${req.method} ${req.path}`;
		if (!(key in this.fixtures)) {
			throw new HttpError(404, req.path, `keine Fixture für "${key}"`);
		}
		const status = this.statuses[key] ?? 200;
		if (status >= 400) {
			throw new HttpError(status, req.path, "Fixture-Fehlerfall");
		}
		return { status, json: this.fixtures[key] as T };
	}
}
