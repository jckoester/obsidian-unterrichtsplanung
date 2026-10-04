import type { Planungsgruppe } from "./api/types";
import type { GruppenZuordnung } from "./sync/materialize";

/**
 * Welche Gruppen synchronisiert werden — rein, ohne Obsidian, damit es sich testen lässt.
 * Die Oberfläche dazu steht in `settings-tab.ts`.
 */

/** Eine eingerichtete Gruppe, wie sie in den Einstellungen steht. */
export interface GruppenEinstellung {
	groupId: number;
	/** Name auf der Plattform, z. B. `nwt-tl-9abcd` — nur zum Wiedererkennen. */
	plattformName: string;
	/** Ordner unter dem Basisordner, zugleich der Name des Lehrauftrags, z. B. `NwT 9`. */
	ordnerName: string;
	/** Optional: Notizname des Lehrauftrags, wenn er anders heißen soll als sein Ordner. */
	lehrauftragLink: string;
	/** Vault-Konvention, z. B. `NwT` → `Fach: "[[NwT]]"`. */
	fach: string;
	stufe: number | null;
	/** Unterordner für Stundennotizen, relativ zum Ordner der Gruppe. */
	stundenOrdner: string;
}

/**
 * Eine entfernte Gruppe. Gemerkt wird sie über ihre ID — und das reicht für „nicht im
 * selben Schuljahr wieder anbieten": Die Plattform legt Unterrichtsgruppen jedes Schuljahr
 * neu an, mit neuer ID. Eine Gruppe, die über zwei Jahre läuft (Kursstufe), behält ihre
 * ID und bleibt ausgeblendet, bis man sie zurückholt.
 */
export interface AusgeblendeteGruppe {
	groupId: number;
	name: string;
}

/** `Basis/Name`. Leer, wenn eins von beiden fehlt — dann weist `pruefeZuordnung` die Gruppe ab. */
export function ordnerPfad(basisOrdner: string, ordnerName: string): string {
	const basis = basisOrdner.trim().replace(/^\/+|\/+$/g, "");
	const name = ordnerName.trim().replace(/^\/+|\/+$/g, "");
	// Ohne Basisordner lägen die Gruppen in der Wurzel des Vaults. Das ist fast immer ein
	// vergessenes Feld, keine Absicht.
	return basis && name ? `${basis}/${name}` : "";
}

/**
 * Was der Sync von einer eingerichteten Gruppe braucht. Getrimmt wird erst hier, nicht
 * beim Speichern: Die Einstellungen speichern bei jedem Tastendruck, und ein Leerzeichen
 * mitten in „CH LF" wäre sonst weg, bevor das „LF" kommt.
 */
export function zuordnungFuer(basisOrdner: string, gruppe: GruppenEinstellung): GruppenZuordnung {
	return {
		groupId: gruppe.groupId,
		lehrauftragLink: gruppe.lehrauftragLink.trim(),
		fach: gruppe.fach.trim(),
		stufe: gruppe.stufe,
		ordner: ordnerPfad(basisOrdner, gruppe.ordnerName),
		stundenOrdner: gruppe.stundenOrdner.trim().replace(/^\/+|\/+$/g, ""),
	};
}

/** Ein Ordnername taugt, wenn er nicht leer ist, kein Pfad ist und keiner anderen Gruppe gehört. */
export function pruefeOrdnername(
	name: string,
	groupId: number,
	alle: GruppenEinstellung[],
): string | undefined {
	const wert = name.trim();
	if (!wert) return "Ohne Ordnernamen wird diese Gruppe nicht synchronisiert.";
	if (wert.includes("/")) return "Nur ein Name, kein Pfad — der Basisordner steht in den allgemeinen Einstellungen.";
	const andere = alle.find((g) => g.groupId !== groupId && g.ordnerName.trim().toLowerCase() === wert.toLowerCase());
	if (andere) return `Diesen Ordner benutzt schon ${andere.plattformName}.`;
	return undefined;
}

/** Unterrichtsgruppen der Plattform, die weder eingerichtet noch ausgeblendet sind. */
export function neueGruppen(
	plattform: Planungsgruppe[],
	eingerichtet: GruppenEinstellung[],
	ausgeblendet: AusgeblendeteGruppe[],
): Planungsgruppe[] {
	const bekannt = new Set([...eingerichtet, ...ausgeblendet].map((g) => g.groupId));
	return plattform.filter((g) => g.aktuell && !bekannt.has(g.id));
}

/**
 * Vorbelegte Einträge für die neuen Gruppen. `vorhandeneOrdner` sind die Ordnernamen
 * unter dem Basisordner — ein vorhandener Ordner gewinnt, siehe `vorschlagOrdnername`.
 */
export function gruppenVorschlaege(
	plattform: Planungsgruppe[],
	eingerichtet: GruppenEinstellung[],
	ausgeblendet: AusgeblendeteGruppe[],
	vorhandeneOrdner: string[],
): GruppenEinstellung[] {
	const vergeben = new Set(eingerichtet.map((g) => g.ordnerName.trim().toLowerCase()));
	return neueGruppen(plattform, eingerichtet, ausgeblendet).map((g) => {
		let ordnerName = vorschlagOrdnername(g, vorhandeneOrdner);
		// Zwei Kurse desselben Fachs und Jahrgangs ergäben denselben Namen. Der Plattformname
		// dahinter unterscheidet sie, bis jemand einen besseren Namen einträgt.
		if (vergeben.has(ordnerName.toLowerCase())) ordnerName = `${ordnerName} (${g.name})`;
		vergeben.add(ordnerName.toLowerCase());
		return {
			groupId: g.id,
			plattformName: g.name,
			ordnerName,
			lehrauftragLink: "",
			fach: g.fach?.name ?? "",
			stufe: g.jahrgang,
			stundenOrdner: "Unterrichtsstunden",
		};
	});
}

/**
 * Der Ordnername, wie er im Vault üblich ist: Fach und Klasse (`Ch 9d`, `M 9c`) oder,
 * bei mehreren oder keinen Klassen, Fach und Jahrgang (`NwT 9`).
 *
 * Die Plattformnamen taugen dafür nicht (`nwt-tl-9abcd`, `ch-ks-9d`, `9C`). Als Fach steht
 * ein kurzer Fachname (`NwT`, `IuM`) so da, wie er heißt, ein langer als Kürzel (`M`, `CH`).
 * Gibt es unter dem Basisordner schon einen Ordner, der bis auf Groß- und Kleinschreibung
 * gleich heißt, gewinnt er — im Vault steht `Ch 9d`, die Plattform sagt `CH`. Den letzten
 * Schliff gibt man beim Einrichten von Hand; ein Kurs wie `CH LF Abi 28` ist nicht ableitbar.
 */
export function vorschlagOrdnername(gruppe: Planungsgruppe, vorhandeneOrdner: string[] = []): string {
	const fach = gruppe.fach
		? gruppe.fach.name.length <= 4
			? gruppe.fach.name
			: (gruppe.fach.fach_code ?? gruppe.fach.name)
		: "";
	const [einzige, ...weitere] = gruppe.klassen;
	const rest =
		einzige !== undefined && weitere.length === 0
			? klasse(einzige)
			: gruppe.jahrgang !== null
				? String(gruppe.jahrgang)
				: gruppe.name;
	const vorschlag = [fach, rest].filter(Boolean).join(" ");
	return vorhandeneOrdner.find((o) => o.toLowerCase() === vorschlag.toLowerCase()) ?? vorschlag;
}

/** `9C` → `9c`, wie die Klassen im Vault heißen. Alles andere bleibt, wie es ist. */
function klasse(name: string): string {
	const treffer = /^(\d+)([A-Za-z])$/.exec(name.trim());
	return treffer ? `${treffer[1]}${(treffer[2] as string).toLowerCase()}` : name.trim();
}
