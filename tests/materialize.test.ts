import { describe, expect, it } from "vitest";
import overview from "../fixtures/overview-group1.json";
import type { OverviewRead, SlotRead } from "../src/api/types";
import { ALTE_VAULT_UEBERSCHRIFT, REGION_ENDE, VAULT_UEBERSCHRIFT } from "../src/sync/frontmatter";
import { hashObject } from "../src/sync/hash";
import { materialize, ZuordnungFehler, type GruppenZuordnung } from "../src/sync/materialize";

const zuordnung: GruppenZuordnung = {
	groupId: 1,
	lehrauftragLink: "",
	fach: "NwT",
	stufe: 9,
	ordner: "Bereiche/11 Unterricht/NwT 9",
	stundenOrdner: "Unterrichtsstunden",
};

const stand = overview as unknown as OverviewRead;

function ersterLauf(serverstand: OverviewRead = stand) {
	return materialize({ zuordnung, overview: serverstand, vorhanden: [] });
}

const STUNDEN = "Bereiche/11 Unterricht/NwT 9/Unterrichtsstunden";
const ERSTE = `${STUNDEN}/NwT 9 2026-09-15.md`;
const ZWEITE = `${STUNDEN}/NwT 9 2026-09-22.md`;
const KNOTEN_C = "cccccccc-3333-4333-8333-cccccccccccc";

/** Nur die Stundennotizen — der Plan enthält auch Lehrauftrag und UE. */
function stundenOps(plan: ReturnType<typeof ersterLauf>) {
	return plan.ops.filter((o) => o.pfad.startsWith(STUNDEN));
}

function alsVorhanden(plan: ReturnType<typeof ersterLauf>) {
	return plan.ops
		.filter((o) => o.inhalt)
		.map((o) => ({ pfad: o.pfad, inhalt: o.inhalt as string }));
}

function stunde(vorhanden: { pfad: string; inhalt: string }[], pfad: string) {
	const treffer = vorhanden.find((v) => v.pfad === pfad);
	if (!treffer) throw new Error(`${pfad} nicht im Plan`);
	return treffer;
}

/** Ein Serverstand, abgeleitet vom Fixture. */
function variante(aendern: (slots: SlotRead[]) => void): OverviewRead {
	const serverstand = structuredClone(stand);
	aendern(serverstand.slots);
	return serverstand;
}

/**
 * Erster Lauf, dann beidseitige Änderung — der Ausgangspunkt beider Konflikt-Tests.
 *
 * Die Vault-Änderung steht vor `REGION_ENDE`. Eine Zeile im eigenen Abschnitt war früher
 * hier der Auslöser — genau der Konflikt ohne Konflikt, den die Hash-Region abschafft.
 */
function konfliktLauf() {
	const vorhanden = alsVorhanden(ersterLauf());
	const eins = stunde(vorhanden, ERSTE);
	eins.inhalt = eins.inhalt.replace("## Ablauf", "## Ablauf\n1. Von Hand ergänzt");
	const serverstand = variante((s) => (s[0]!.thema = "Getriebe, zweitens"));
	const konflikt = materialize({ zuordnung, overview: serverstand, vorhanden }).ops.find(
		(o) => o.art === "konflikt",
	);
	if (!konflikt) throw new Error("kein Konflikt im Plan");
	return { konflikt, serverstand, vorhanden };
}

/**
 * Eine Stundennotiz, wie Stufe 1 sie vor `REGION_ENDE` schrieb: ohne Marker, der Hash
 * über die ganze Datei. Die Formel steht hier absichtlich noch einmal ausgeschrieben —
 * sie ist der Vertrag, den der neue Hash für Altbestand halten muss.
 */
function alsAltbestand(inhalt: string): string {
	const ohneMarker = inhalt.replace(`${REGION_ENDE}\n\n`, "");
	const alterHash = hashObject(ohneMarker.replace(/^uplan_hash:.*$/m, "uplan_hash:"));
	return ohneMarker.replace(/^uplan_hash:.*$/m, `uplan_hash: ${alterHash}`);
}

/**
 * Eine Stundennotiz im Format von Stufe 1, wie sie im Testvault liegt: `Stunde N` im
 * Namen, `UStatus` mit Meta-Bind-Feld, kein Marker. Beide Hashes nach den damaligen
 * Formeln — der Server-Hash ohne Formatversion, der Vault-Hash über die ganze Datei.
 */
function stufe1Notiz(slot: SlotRead, ueTitel: string, eigenes: string) {
	const serverHash = hashObject({
		date: slot.date,
		start_period: slot.start_period,
		periods: slot.periods,
		kategorie: slot.kategorie,
		thema: slot.thema,
		note: slot.note,
		hat_phasen: slot.hat_phasen,
		nachbereitet_at: slot.nachbereitet_at,
		ue_node_id: slot.ue_node_id,
		stunde_node_id: slot.stunde_node_id,
		ue_titel: ueTitel,
	});
	const ohneHash = [
		"---",
		"Kategorien:",
		'  - "[[UStunden]]"',
		'Lehrauftrag: "[[NwT 9]]"',
		`UEinheit: "[[${ueTitel}]]"`,
		`Datum: ${slot.date}`,
		"UStatus:",
		"  - ⚫️ Platzhalter",
		`Inhalte: ${slot.thema}`,
		`UStunden: ${slot.periods}`,
		`uplan_slot_id: ${slot.id}`,
		"uplan_node_id:",
		`uplan_group_id: ${slot.group_id}`,
		`uplan_updated_at: "${slot.updated_at}"`,
		`uplan_server_hash: ${serverHash}`,
		"uplan_hash:",
		"uplan_status: aktiv",
		"---",
		">[!journal-header]",
		">## `=this.Lehrauftrag`",
		"># Stunde 1 - 15.09.2026",
		"",
		"Status:`INPUT[inlineSelect(title(Status), option(⚫️ Platzhalter), option(🔴 Entfall)):UStatus]`",
		"",
		"## Ziele",
		"-",
		"",
		"## Verlauf",
		"1.",
		"",
		ALTE_VAULT_UEBERSCHRIFT,
		eigenes,
		"",
	].join("\n");
	return {
		pfad: `${STUNDEN}/NwT 9 Stunde 1.md`,
		inhalt: ohneHash.replace(/^uplan_hash:$/m, `uplan_hash: ${hashObject(ohneHash)}`),
	};
}

function mitEigenerZeile(inhalt: string): string {
	return inhalt.replace(VAULT_UEBERSCHRIFT, `${VAULT_UEBERSCHRIFT}\nMaterial liegt im Schrank.`);
}

describe("materialize", () => {
	it("legt für jeden Slot genau eine Notiz an, benannt nach dem Datum", () => {
		const plan = ersterLauf();
		expect(stundenOps(plan).filter((o) => o.art === "erstellen")).toHaveLength(2);
		expect(stundenOps(plan).map((o) => o.pfad)).toEqual([ERSTE, ZWEITE]);
	});

	it("schreibt UArt und UStand statt UStatus — und kein Auswahlfeld", () => {
		const zweite = stundenOps(ersterLauf())[1]?.inhalt ?? "";
		expect(zweite).toContain("UArt: Prüfung");
		expect(zweite).toContain("UStand: Geplant");
		expect(zweite).toContain("># 22.09.2026");
		expect(zweite).toContain('UEinheit: "[[UE1 - Mechanische Übertragung]]"');
		expect(zweite).not.toContain("UStatus");
		expect(zweite).not.toContain("INPUT[");
		expect(zweite).toContain(">[!uplan-stunde]");
		expect(zweite).not.toContain("journal-header");
	});

	it("schreibt keinen Wikilink auf eine Nachbarstunde — die Navigation rechnet Dataview", () => {
		for (const op of stundenOps(ersterLauf())) {
			expect(op.inhalt).not.toMatch(/\[\[NwT 9 2026/);
			expect(op.inhalt).toContain(">>`$= (() => {");
		}
	});

	describe("Stundenziel", () => {
		const B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
		const mitZiel = (stundenziel: string | null) => (vorhanden: { pfad: string; inhalt: string }[]) =>
			materialize({ zuordnung, overview: stand, vorhanden, stundenknoten: [{ id: B, stundenziel, phasen: [], updated_at: null, darf_schreiben: true }] });

		it("steht im Frontmatter der Stunde, deren Knoten es trägt", () => {
			const plan = mitZiel("Übersetzungen berechnen")([]);
			expect(plan.ops.find((o) => o.pfad === ZWEITE)?.inhalt).toContain(
				"Stundenziel: Übersetzungen berechnen",
			);
			// Der erste Slot hat keinen Knoten, also auch kein Ziel.
			expect(plan.ops.find((o) => o.pfad === ERSTE)?.inhalt).toMatch(/^Stundenziel:$/m);
		});

		it("gilt als Serveränderung, wenn es sich auf der Plattform ändert", () => {
			const vorhanden = alsVorhanden(mitZiel("Übersetzungen berechnen")([]));
			expect(mitZiel("Übersetzungen berechnen")(vorhanden).ops.every((o) => o.art === "unveraendert")).toBe(true);
			const zweit = mitZiel("Übersetzungen sicher berechnen")(vorhanden);
			expect(zweit.ops.filter((o) => o.art !== "unveraendert").map((o) => o.pfad)).toEqual([ZWEITE]);
		});

		it("überlebt Zeilenumbrüche und eine Trennlinie — der zweite Lauf ist ruhig", () => {
			const ziel = "Die SuS können\n---\n- Übersetzungen berechnen";
			const erst = mitZiel(ziel)([]);
			const zweite = erst.ops.find((o) => o.pfad === ZWEITE)?.inhalt ?? "";
			expect(zweite).toContain("Stundenziel: |-\n  Die SuS können\n  ---\n  - Übersetzungen berechnen\n");
			expect(mitZiel(ziel)(alsVorhanden(erst)).ops.every((o) => o.art === "unveraendert")).toBe(true);
		});
	});

	it("ist idempotent — zweiter Lauf ändert nichts", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const zweit = materialize({ zuordnung, overview: stand, vorhanden });
		expect(zweit.ops.every((o) => o.art === "unveraendert")).toBe(true);
	});

	it("erkennt eine Änderung auf der Plattform", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const geaendert = variante((s) => (s[0]!.thema = "Getriebe, Teil 2"));
		const zweit = materialize({ zuordnung, overview: geaendert, vorhanden });
		expect(zweit.ops.filter((o) => o.art === "aktualisieren")).toHaveLength(1);
	});

	it("meldet beidseitige Änderung als Konflikt und rettet die Vault-Fassung", () => {
		const { konflikt } = konfliktLauf();
		expect(konflikt.inhalt).toContain("Von Hand ergänzt");
		expect(konflikt.inhalt).toContain("Sync-Konflikt");
	});

	// Bis zur Hash-Region wurde daraus ein Konflikt: Der Hash lief über die ganze Datei, und
	// der eigene Abschnitt stand danach ein zweites Mal im Konfliktblock.
	it("bewahrt den vault-eigenen Abschnitt bei Aktualisierung — ohne Konflikt", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		stunde(vorhanden, ERSTE).inhalt = mitEigenerZeile(stunde(vorhanden, ERSTE).inhalt);
		const geaendert = variante((s) => (s[0]!.thema = "Getriebe, Teil 2"));
		const op = materialize({ zuordnung, overview: geaendert, vorhanden }).ops.find(
			(o) => o.pfad === ERSTE,
		);
		expect(op?.art).toBe("aktualisieren");
		expect(op?.inhalt?.split("Material liegt im Schrank.")).toHaveLength(2);
	});

	it("hält den eigenen Abschnitt nicht für eine Vault-Änderung", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		stunde(vorhanden, ERSTE).inhalt = mitEigenerZeile(stunde(vorhanden, ERSTE).inhalt);
		const op = materialize({ zuordnung, overview: stand, vorhanden }).ops.find(
			(o) => o.pfad === ERSTE,
		);
		expect(op?.art).toBe("unveraendert");
		expect(op?.grund).toBeUndefined();
	});

	it("setzt die Grenze zwischen Ablauf und eigenen Abschnitt", () => {
		const inhalt = stunde(alsVorhanden(ersterLauf()), ERSTE).inhalt;
		expect(inhalt.indexOf(REGION_ENDE)).toBeGreaterThan(inhalt.indexOf("## Ablauf"));
		expect(inhalt.indexOf(REGION_ENDE)).toBeLessThan(inhalt.indexOf(VAULT_UEBERSCHRIFT));
	});

	it("lässt eine Bestandsnotiz ohne Marker in Ruhe, solange sich nichts ändert", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		stunde(vorhanden, ERSTE).inhalt = alsAltbestand(stunde(vorhanden, ERSTE).inhalt);
		const op = materialize({ zuordnung, overview: stand, vorhanden }).ops.find(
			(o) => o.pfad === ERSTE,
		);
		expect(op?.art).toBe("unveraendert");
		expect(op?.grund).toBeUndefined();
	});

	it("gibt einer Bestandsnotiz beim Aktualisieren den Marker — danach gilt die Region", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const eins = stunde(vorhanden, ERSTE);
		eins.inhalt = alsAltbestand(eins.inhalt);

		const geaendert = variante((s) => (s[0]!.thema = "Getriebe, Teil 2"));
		const umgestellt = materialize({ zuordnung, overview: geaendert, vorhanden }).ops.find(
			(o) => o.pfad === ERSTE,
		);
		expect(umgestellt?.art).toBe("aktualisieren");
		expect(umgestellt?.inhalt).toContain(REGION_ENDE);

		eins.inhalt = mitEigenerZeile(umgestellt?.inhalt as string);
		const nochmal = variante((s) => (s[0]!.thema = "Getriebe, Teil 3"));
		const op = materialize({ zuordnung, overview: nochmal, vorhanden }).ops.find(
			(o) => o.pfad === ERSTE,
		);
		expect(op?.art).toBe("aktualisieren");
		expect(op?.inhalt).toContain("Material liegt im Schrank.");
	});

	// Der Weg, den die Notizen im Testvault gehen: Die Formatversion im Server-Hash sorgt
	// dafür, dass jede Stufe-1-Notiz einmal neu geschrieben wird — nicht nur die, deren
	// Termin sich zufällig gerade geändert hat.
	it("schreibt eine Stufe-1-Notiz einmal neu, benennt sie um und behält ihren Abschnitt", () => {
		const alt = stufe1Notiz(stand.slots[0]!, "UE1 - Mechanische Übertragung", "Meins");
		const vorhanden = [...alsVorhanden(ersterLauf()).filter((v) => v.pfad !== ERSTE), alt];
		const plan = materialize({ zuordnung, overview: stand, vorhanden });

		expect(plan.ops).toContainEqual(
			expect.objectContaining({ art: "umbenennen", vonPfad: alt.pfad, pfad: ERSTE }),
		);
		const neu = plan.ops.find((o) => o.pfad === ERSTE && o.inhalt);
		expect(neu?.art).toBe("aktualisieren");
		expect(neu?.inhalt).toContain("UArt: Unterricht");
		expect(neu?.inhalt).not.toContain("UStatus");
		expect(neu?.inhalt).toContain(`${REGION_ENDE}\n\n${ALTE_VAULT_UEBERSCHRIFT}\nMeins`);

		const danach = [
			...vorhanden.filter((v) => v !== alt),
			{ pfad: ERSTE, inhalt: neu?.inhalt as string },
		];
		const dritt = materialize({ zuordnung, overview: stand, vorhanden: danach });
		expect(dritt.ops.every((o) => o.art === "unveraendert")).toBe(true);
	});

	it("archiviert statt zu löschen, wenn ein Slot verschwindet", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const geschrumpft = variante((s) => s.splice(1));
		const plan = materialize({ zuordnung, overview: geschrumpft, vorhanden });
		const archiv = plan.ops.find((o) => o.art === "archivieren");
		expect(archiv?.inhalt).toContain("uplan_status: archiviert");
		expect(archiv?.pfad).toBe(`${STUNDEN}/NwT 9 2026-09-22 (archiviert).md`);
		expect(plan.ops.some((o) => o.art === "erstellen")).toBe(false);
	});

	// Der Normalfall dafür ist der Neuaufbau eines Halbjahrs: Die Plattform löscht die Slots
	// und legt sie mit neuen IDs wieder an. Ohne Knoten hängt der Platzhalter an der alten ID.
	it("gibt beim Archivieren den Namen frei, wenn ein neuer Slot denselben Tag will", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const neuAufgebaut = variante((s) => (s[0]!.id = "99999999-9999-4999-8999-999999999999"));
		const plan = materialize({ zuordnung, overview: neuAufgebaut, vorhanden });

		const freigebend = plan.ops.findIndex(
			(o) => o.art === "umbenennen" && o.vonPfad === ERSTE,
		);
		const neu = plan.ops.findIndex((o) => o.art === "erstellen" && o.pfad === ERSTE);
		expect(plan.ops[freigebend]?.pfad).toBe(`${STUNDEN}/NwT 9 2026-09-15 (archiviert).md`);
		expect(freigebend).toBeGreaterThanOrEqual(0);
		expect(freigebend).toBeLessThan(neu);
	});

	it("zählt weiter, wenn der Archivname schon vergeben ist", () => {
		const vorhanden = [
			...alsVorhanden(ersterLauf()),
			{ pfad: `${STUNDEN}/NwT 9 2026-09-22 (archiviert).md`, inhalt: "älter\n" },
		];
		const plan = materialize({ zuordnung, overview: variante((s) => s.splice(1)), vorhanden });
		const archiv = plan.ops.find((o) => o.art === "archivieren");
		expect(archiv?.pfad).toBe(`${STUNDEN}/NwT 9 2026-09-22 (archiviert 2).md`);
	});

	// Der Rückfallzweig für Notizen ohne `uplan_status`-Zeile schrieb nach der Umbenennung
	// noch `ggd_status` — die Notiz galt danach nie als archiviert und bekam bei jedem Lauf
	// eine weitere Statuszeile.
	it("archiviert auch eine Notiz ohne Statuszeile genau einmal", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const zwei = stunde(vorhanden, ZWEITE);
		zwei.inhalt = zwei.inhalt.replace(/^uplan_status:.*\n/m, "");
		const geschrumpft = variante((s) => s.splice(1));

		const archiv = materialize({ zuordnung, overview: geschrumpft, vorhanden }).ops.find(
			(o) => o.art === "archivieren",
		);
		expect(archiv?.inhalt).toContain("uplan_status: archiviert");
		expect(archiv?.inhalt).not.toContain("ggd_");

		const danach = [
			...vorhanden.filter((v) => v !== zwei),
			{ pfad: archiv?.pfad as string, inhalt: archiv?.inhalt as string },
		];
		const zweit = materialize({ zuordnung, overview: geschrumpft, vorhanden: danach });
		expect(zweit.ops.some((o) => o.art === "archivieren" || o.art === "umbenennen")).toBe(false);
	});

	it("archiviert eine Einheit, die auf der Plattform verschwindet", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const ohneEinheit = structuredClone(stand);
		ohneEinheit.units = [];
		for (const slot of ohneEinheit.slots) slot.ue_node_id = null;
		const plan = materialize({ zuordnung, overview: ohneEinheit, vorhanden });

		const archiv = plan.ops.find((o) => o.art === "archivieren");
		expect(archiv?.pfad).toContain("UE1 - Mechanische Übertragung.md");
		expect(archiv?.inhalt).toContain("uplan_status: archiviert");
		// Der Ordner bleibt, wo er ist — darin liegt das Material.
		expect(plan.ops.some((o) => o.art === "umbenennen")).toBe(false);
	});

	it("lässt eine Konfliktnotiz beim nächsten Lauf in Ruhe", () => {
		const { konflikt, serverstand, vorhanden } = konfliktLauf();
		const danach = vorhanden.map((v) =>
			v.pfad === konflikt.pfad ? { pfad: v.pfad, inhalt: konflikt.inhalt as string } : v,
		);
		const zweit = materialize({ zuordnung, overview: serverstand, vorhanden: danach });
		const op = zweit.ops.find((o) => o.pfad === konflikt.pfad);
		expect(op?.art).toBe("unveraendert");
		// Kein „nur Vault geändert": Der Hash steht über der fertigen Notiz, samt Block.
		expect(op?.grund).toBeUndefined();
	});

	// Ein Codezaun im geretteten Teil beendete sonst den Zaun des Konfliktblocks — der Rest
	// der Notiz rutschte in den Fließtext. Seit der Block nur noch den Plattform-Teil rettet,
	// kommt ein Zaun von dort: etwa aus einer Beschreibung im Ablauf.
	it("schachtelt Codezäune nicht ineinander", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		stunde(vorhanden, ERSTE).inhalt = stunde(vorhanden, ERSTE).inhalt.replace(
			"## Ablauf\n1.",
			"## Ablauf\n1. Einstieg\n   ```\n   print(1)\n   ```",
		);
		const geaendert = variante((s) => (s[0]!.thema = "Getriebe, Teil 2"));
		const konflikt = materialize({ zuordnung, overview: geaendert, vorhanden }).ops.find(
			(o) => o.art === "konflikt",
		);
		expect(konflikt?.inhalt).toContain("````markdown");
		expect(konflikt?.inhalt).toContain("   ```\n   print(1)");
	});

	it("rettet im Konflikt nur, was überschrieben wird — der eigene Abschnitt steht einmal da", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const eins = stunde(vorhanden, ERSTE);
		eins.inhalt = mitEigenerZeile(eins.inhalt).replace("## Ablauf\n1.", "## Ablauf\n1. Von Hand");
		const geaendert = variante((s) => (s[0]!.thema = "Getriebe, Teil 2"));
		const konflikt = materialize({ zuordnung, overview: geaendert, vorhanden }).ops.find(
			(o) => o.art === "konflikt",
		);
		expect(konflikt?.inhalt).toContain("1. Von Hand");
		expect(konflikt?.inhalt?.split("Material liegt im Schrank.")).toHaveLength(2);
	});

	it("rettet im Konflikt auch Inhalte und Stundenziel aus dem Vault", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const eins = stunde(vorhanden, ERSTE);
		eins.inhalt = eins.inhalt.replace("Inhalte: Getriebe und Übersetzung", "Inhalte: Getriebe, von Hand");
		const geaendert = variante((s) => (s[0]!.thema = "Getriebe, Teil 2"));
		const konflikt = materialize({ zuordnung, overview: geaendert, vorhanden }).ops.find(
			(o) => o.art === "konflikt",
		);
		expect(konflikt?.inhalt).toContain("Inhalte: Getriebe, Teil 2"); // der neue Stand
		expect(konflikt?.inhalt).toContain("markdown\nInhalte: Getriebe, von Hand"); // im Block gerettet
	});

	it("benennt um statt zu duplizieren, wenn sich das Datum verschiebt", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		const verschoben = variante((s) => (s[0]!.date = "2026-09-29"));
		const plan = materialize({ zuordnung, overview: verschoben, vorhanden });
		expect(plan.ops).toContainEqual(
			expect.objectContaining({
				art: "umbenennen",
				vonPfad: ERSTE,
				pfad: `${STUNDEN}/NwT 9 2026-09-29.md`,
			}),
		);
		expect(plan.ops.some((o) => o.art === "erstellen")).toBe(false);
	});
});

describe("Anker am Stundenknoten", () => {
	/** Beide Fixture-Slots mit Stundenknoten: der erste mit C, der zweite mit B. */
	const beideGeplant = variante((s) => {
		s[0]!.stunde_node_id = KNOTEN_C;
		s[0]!.hat_phasen = true;
	});

	/** Was der Swap der Plattform tut: Knoten, Einheit und Thema tauschen, das Datum bleibt. */
	function getauscht(serverstand: OverviewRead): OverviewRead {
		const neu = structuredClone(serverstand);
		const [a, b] = neu.slots as [SlotRead, SlotRead];
		[a.stunde_node_id, b.stunde_node_id] = [b.stunde_node_id, a.stunde_node_id];
		[a.ue_node_id, b.ue_node_id] = [b.ue_node_id, a.ue_node_id];
		[a.thema, b.thema] = [b.thema, a.thema];
		[a.hat_phasen, b.hat_phasen] = [b.hat_phasen, a.hat_phasen];
		return neu;
	}

	it("lässt bei einem Swap die Notizen mit ihren Stunden wandern", () => {
		const vorhanden = alsVorhanden(ersterLauf(beideGeplant));
		stunde(vorhanden, ERSTE).inhalt = mitEigenerZeile(stunde(vorhanden, ERSTE).inhalt);

		const plan = materialize({ zuordnung, overview: getauscht(beideGeplant), vorhanden });

		// Zwei Namen tauschen — das braucht einen Zwischenschritt, also drei Umbenennungen.
		expect(plan.ops.filter((o) => o.art === "umbenennen")).toHaveLength(3);
		expect(plan.ops.some((o) => o.art === "erstellen")).toBe(false);
		// Die Vorbereitung für Stunde C liegt jetzt beim 22.09. — mit ihrem eigenen Abschnitt.
		const c = plan.ops.find((o) => o.pfad === ZWEITE && o.inhalt);
		expect(c?.inhalt).toContain(`uplan_node_id: ${KNOTEN_C}`);
		expect(c?.inhalt).toContain("Material liegt im Schrank.");
	});

	it("übernimmt beim ersten Entwurf den Knoten, statt ein Duplikat anzulegen", () => {
		const vorhanden = alsVorhanden(ersterLauf());
		stunde(vorhanden, ERSTE).inhalt = mitEigenerZeile(stunde(vorhanden, ERSTE).inhalt);
		const plan = materialize({ zuordnung, overview: beideGeplant, vorhanden });

		expect(stundenOps(plan).some((o) => o.art === "erstellen")).toBe(false);
		const op = plan.ops.find((o) => o.pfad === ERSTE);
		expect(op?.art).toBe("aktualisieren");
		expect(op?.grund).toContain("erster Entwurf");
		expect(op?.inhalt).toContain(`uplan_node_id: ${KNOTEN_C}`);
		expect(op?.inhalt).toContain("Material liegt im Schrank.");
	});

	it("archiviert einen Platzhalter als ersetzt, wenn eine Stunde auf seinen Termin wandert", () => {
		// Vorher: Stunde C am 15.09., ein leerer Termin am 22.09.
		const vorher = variante((s) => {
			s[0]!.stunde_node_id = KNOTEN_C;
			s[0]!.hat_phasen = true;
			s[1]!.stunde_node_id = null;
			s[1]!.hat_phasen = false;
		});
		const vorhanden = alsVorhanden(ersterLauf(vorher));
		const plan = materialize({ zuordnung, overview: getauscht(vorher), vorhanden });

		const ersetzt = `${STUNDEN}/NwT 9 2026-09-22 (ersetzt).md`;
		const archiv = plan.ops.find((o) => o.art === "archivieren");
		expect(archiv?.pfad).toBe(ersetzt);
		expect(archiv?.grund).toContain("ersetzt");

		// Erst macht der Platzhalter Platz, dann zieht Stunde C ein, dann bekommt der
		// 15.09. einen neuen Platzhalter.
		const platz = plan.ops.findIndex((o) => o.art === "umbenennen" && o.pfad === ersetzt);
		const einzug = plan.ops.findIndex((o) => o.art === "umbenennen" && o.pfad === ZWEITE);
		const neu = plan.ops.findIndex((o) => o.art === "erstellen" && o.pfad === ERSTE);
		expect(platz).toBeGreaterThanOrEqual(0);
		expect(platz).toBeLessThan(einzug);
		expect(einzug).toBeLessThan(neu);
	});

	it("hängt bei zwei Stunden am selben Tag beiden die Anfangsstunde an", () => {
		const nachmittag: SlotRead = {
			...structuredClone(stand.slots[0]!),
			id: "33333333-3333-4333-8333-333333333333",
			start_period: 6,
			thema: "Nachmittag",
		};
		const doppelt = variante((s) => s.push(nachmittag));
		const vorhanden = alsVorhanden(ersterLauf(doppelt));
		expect(vorhanden.map((v) => v.pfad)).toEqual(
			expect.arrayContaining([
				`${STUNDEN}/NwT 9 2026-09-15 (3. Std.).md`,
				`${STUNDEN}/NwT 9 2026-09-15 (6. Std.).md`,
				ZWEITE,
			]),
		);

		// Fällt der Nachmittag weg, verliert der Vormittag den Zusatz wieder.
		const plan = materialize({ zuordnung, overview: stand, vorhanden });
		expect(plan.ops).toContainEqual(
			expect.objectContaining({
				art: "umbenennen",
				vonPfad: `${STUNDEN}/NwT 9 2026-09-15 (3. Std.).md`,
				pfad: ERSTE,
			}),
		);
	});
});

describe("pruefeZuordnung", () => {
	it("weigert sich bei leerem Ordner, statt irgendwohin zu schreiben", () => {
		expect(() =>
			materialize({
				zuordnung: { ...zuordnung, ordner: "" },
				overview: stand,
				vorhanden: [],
			}),
		).toThrow(ZuordnungFehler);
	});

	it("weigert sich ohne group_id", () => {
		expect(() =>
			materialize({
				zuordnung: { ...zuordnung, groupId: 0 },
				overview: stand,
				vorhanden: [],
			}),
		).toThrow(ZuordnungFehler);
	});

	// Früher war der Link Pflicht. Seit der Name aus dem Ordner fällt, ist ein leeres
	// Feld der Normalfall — der Test hält fest, was gilt, statt was einmal galt.
	it("nimmt einen leeren Lehrauftrag-Link hin — dann gilt der Ordnername", () => {
		const plan = materialize({
			zuordnung: { ...zuordnung, lehrauftragLink: "" },
			overview: stand,
			vorhanden: [],
		});
		expect(plan.ops.some((o) => o.pfad === "Bereiche/11 Unterricht/NwT 9/NwT 9.md")).toBe(true);
	});
});
