import {
	App,
	Notice,
	PluginSettingTab,
	TFolder,
	normalizePath,
	type ButtonComponent,
	type Setting,
	type SettingDefinitionItem,
	type SettingDefinitionPage,
} from "obsidian";
import {
	gruppenVorschlaege,
	ordnerPfad,
	pruefeOrdnername,
	type GruppenEinstellung,
} from "./gruppen";
import type UnterrichtsplanungSyncPlugin from "./main";
import { ObsidianVaultAdapter } from "./sync/obsidian-vault";

/** Die Felder einer Gruppe, die ihre Unterseite bearbeitet. */
type GruppenFeld = "ordnerName" | "fach" | "stufe" | "stundenOrdner" | "lehrauftragLink";

/**
 * Die deklarativen Einstellungen von Obsidian 1.13 binden jedes Steuerelement an einen
 * flachen Schlüssel. Die Felder einer Gruppe stecken aber in einer Liste — deshalb trägt
 * ihr Schlüssel die Gruppe mit (`g:31:ordnerName`), und `getControlValue`/`setControlValue`
 * lösen ihn auf.
 */
function gruppenSchluessel(groupId: number, feld: GruppenFeld): string {
	return `g:${groupId}:${feld}`;
}

function leseSchluessel(key: string): { groupId: number; feld: GruppenFeld } | null {
	const treffer = /^g:(\d+):(\w+)$/.exec(key);
	return treffer ? { groupId: Number(treffer[1]), feld: treffer[2] as GruppenFeld } : null;
}

export class UpsSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: UnterrichtsplanungSyncPlugin,
	) {
		super(app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		const einstellungen = this.plugin.settings;
		return [
			{
				type: "group",
				heading: "Verbindung",
				items: [
					{
						name: "Basis-URL",
						desc: "Inklusive /api — das Präfix hängt der Reverse-Proxy davor, nicht FastAPI.",
						control: { type: "text", key: "basisUrl", placeholder: "https://ki.beispiel.de/api" },
					},
					{
						name: "Zugangstoken",
						desc: "Personal Access Token aus dem Profil (ggd_pat_…). Scopes: planning:read, planning:write, context:read.",
						render: (setting) => this.zeigeTokenFeld(setting),
					},
				],
			},
			{
				type: "group",
				heading: "Sync",
				items: [
					{
						name: "Probelauf (Dry-Run)",
						desc: "Zeigt die geplanten Dateioperationen, ohne zu schreiben.",
						control: { type: "toggle", key: "dryRun" },
					},
					{
						name: "Sync-Intervall",
						desc: "Minuten; 0 = nur auf Befehl.",
						control: { type: "number", key: "syncIntervall", min: 0, step: 1 },
					},
					{
						name: "Basisordner",
						desc: "Sammelordner der Lehraufträge, z. B. „Bereiche/11 Unterricht“. Darunter liegt je Gruppe ein eigener Ordner.",
						control: { type: "folder", key: "basisOrdner", placeholder: "Bereiche/11 Unterricht" },
					},
				],
			},
			{
				type: "list",
				heading: "Gruppen",
				emptyState:
					"Noch keine Gruppe. Mit + holt das Plugin deine Unterrichtsgruppen von der Plattform. Entfernen blendet eine Gruppe aus; ihre Notizen bleiben.",
				addItem: { name: "Gruppen von der Plattform holen", action: () => void this.holeGruppen() },
				// Obsidian bindet `onDelete` nur an die Entf-Taste auf dem fokussierten Eintrag —
				// einen Knopf zeichnet es (Stand 1.14) nicht. Der steht deshalb auf der Unterseite.
				onDelete: (index) => {
					const gruppe = this.plugin.settings.gruppen[index];
					if (gruppe) void this.blendeAus(gruppe.groupId);
				},
				items: einstellungen.gruppen.map((gruppe) => this.gruppenSeite(gruppe)),
			},
			{
				type: "group",
				heading: "Ausgeblendete Gruppen",
				visible: () => this.plugin.settings.ausgeblendet.length > 0,
				items: einstellungen.ausgeblendet.map((gruppe) => ({
					name: gruppe.name,
					desc: `Gruppe ${gruppe.groupId} — „Gruppen holen“ bietet sie nicht mehr an.`,
					render: (setting: Setting) => {
						setting
							.setName(gruppe.name)
							.addButton((button) =>
								button.setButtonText("Zurückholen").onClick(() => void this.holeZurueck(gruppe.groupId)),
							);
					},
				})),
			},
		];
	}

	private gruppenSeite(gruppe: GruppenEinstellung): SettingDefinitionPage {
		const schluessel = (feld: GruppenFeld) => gruppenSchluessel(gruppe.groupId, feld);
		return {
			type: "page",
			name: gruppe.plattformName || `Gruppe ${gruppe.groupId}`,
			desc: `Gruppe ${gruppe.groupId}`,
			// Als Funktion: Der Name gehört der Plattform und steht fest, der Ordner ändert sich
			// beim Einrichten — so zeigt die Liste ihn, ohne neu aufgebaut zu werden.
			displayValue: () => gruppe.ordnerName.trim() || "kein Ordner",
			status: () => (this.ordnerFehlt(gruppe) ? "warning" : null),
			items: [
				{
					type: "group",
					items: [
						{
							name: "Ordnername",
							desc: "Ordner unter dem Basisordner, zugleich der Name des Lehrauftrags, z. B. „NwT 9“.",
							control: {
								type: "text",
								key: schluessel("ordnerName"),
								placeholder: "NwT 9",
								validate: (wert) =>
									pruefeOrdnername(wert, gruppe.groupId, this.plugin.settings.gruppen),
							},
						},
						{
							name: "Ordner",
							desc: "Fehlt er, legt ihn der erste Sync an — mitsamt Stunden-Unterordner.",
							render: (setting) => {
								setting.addButton((button) =>
									button.setButtonText("Jetzt anlegen").onClick(() => void this.legeOrdnerAn(gruppe)),
								);
							},
						},
						{
							name: "Fach",
							desc: "So, wie das Fach im Vault heißt — daraus wird „Fach: [[NwT]]“.",
							control: { type: "text", key: schluessel("fach"), placeholder: "NwT" },
						},
						{
							name: "Stufe",
							desc: "Jahrgangsstufe für Lehrauftrags- und UE-Notizen.",
							control: { type: "number", key: schluessel("stufe"), min: 1, max: 13, step: 1 },
						},
						{
							name: "Stunden-Unterordner",
							control: { type: "text", key: schluessel("stundenOrdner"), placeholder: "Unterrichtsstunden" },
						},
						{
							name: "Lehrauftrag-Notiz (optional)",
							desc: "Leer lassen: Dann heißt die Notiz wie ihr Ordner. Nur ausfüllen, wenn sie anders heißen soll.",
							control: { type: "text", key: schluessel("lehrauftragLink") },
						},
					],
				},
				{
					type: "group",
					items: [
						{
							name: "Gruppe ausblenden",
							desc: "Sie wird nicht mehr synchronisiert und beim Holen nicht mehr angeboten. Die Notizen im Vault bleiben.",
							render: (setting) => {
								setting.addButton((button) =>
									button
										.setButtonText("Ausblenden")
										.setWarning()
										.onClick(() => void this.blendeAus(gruppe.groupId, true)),
								);
							},
						},
					],
				},
			],
		};
	}

	override getControlValue(key: string): unknown {
		const gruppenfeld = leseSchluessel(key);
		if (gruppenfeld) {
			const wert = this.gruppe(gruppenfeld.groupId)?.[gruppenfeld.feld];
			return wert ?? undefined;
		}
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		const einstellungen = this.plugin.settings;
		const gruppenfeld = leseSchluessel(key);
		if (gruppenfeld) {
			const gruppe = this.gruppe(gruppenfeld.groupId);
			if (!gruppe) return;
			if (gruppenfeld.feld === "stufe") {
				const zahl = Number(value);
				gruppe.stufe = Number.isFinite(zahl) && zahl > 0 ? Math.floor(zahl) : null;
			} else {
				// Ungetrimmt: Gespeichert wird bei jedem Tastendruck (siehe `zuordnungFuer`).
				gruppe[gruppenfeld.feld] = String(value ?? "");
			}
		} else if (key === "basisUrl") {
			einstellungen.basisUrl = String(value ?? "").trim();
		} else if (key === "basisOrdner") {
			einstellungen.basisOrdner = String(value ?? "");
		} else if (key === "dryRun") {
			einstellungen.dryRun = Boolean(value);
		} else if (key === "syncIntervall") {
			const zahl = Number(value);
			einstellungen.syncIntervall = Number.isFinite(zahl) ? Math.max(0, Math.floor(zahl)) : 0;
			this.plugin.planeIntervall();
		}
		await this.plugin.saveSettings();
	}

	private gruppe(groupId: number): GruppenEinstellung | undefined {
		return this.plugin.settings.gruppen.find((g) => g.groupId === groupId);
	}

	private zeigeTokenFeld(setting: Setting): void {
		setting
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("ggd_pat_…")
					.setValue(this.plugin.settings.token)
					.onChange(async (value) => {
						this.plugin.settings.token = value.trim();
						await this.plugin.saveSettings();
					});
			})
			.addButton((button) =>
				button.setButtonText("Verbindung testen").onClick(() => void this.testeVerbindung(button)),
			);
	}

	private async testeVerbindung(button: ButtonComponent): Promise<void> {
		button.setDisabled(true);
		try {
			// Ohne group_id: Die Gruppenliste setzt keine Gruppe voraus und prüft dabei
			// planning:read mit.
			const plattform = await this.plugin.api.planungsgruppen();
			const zeilen = [
				`Verbindung steht. Unterrichtsgruppen auf der Plattform: ${plattform.filter((g) => g.aktuell).length}`,
			];
			for (const gruppe of this.plugin.settings.gruppen) {
				const name = gruppe.ordnerName.trim() || gruppe.plattformName;
				try {
					const probe = await this.plugin.api.gruppenprobe(gruppe.groupId);
					const stunden = probe.stundenLesbar
						? "Stundenknoten lesbar"
						: "Stundenknoten gesperrt — dem Token fehlt context:read";
					zeilen.push(`${name}: ${probe.schuljahr}, ${probe.slots} Termine, ${stunden}`);
				} catch (error) {
					zeilen.push(`${name}: ${deuteFehler(error as Error)}`);
				}
			}
			new Notice(zeilen.join("\n"), 12000);
		} catch (error) {
			new Notice(deuteFehler(error as Error), 12000);
		} finally {
			button.setDisabled(false);
		}
	}

	/**
	 * Übernimmt die Unterrichtsgruppen der Plattform, die weder eingerichtet noch
	 * ausgeblendet sind — vorbelegt, aber ungeprüft: Den Ordnernamen schaut man sich an.
	 * `nur` beschränkt das auf eine Gruppe (Zurückholen).
	 */
	private async holeGruppen(nur?: number): Promise<void> {
		const einstellungen = this.plugin.settings;
		if (!ordnerPfad(einstellungen.basisOrdner, "-")) {
			new Notice("Zuerst den Basisordner eintragen — darunter bekommt jede Gruppe ihren Ordner.", 8000);
			return;
		}
		try {
			const plattform = await this.plugin.api.planungsgruppen();
			const basis = this.app.vault.getAbstractFileByPath(normalizePath(einstellungen.basisOrdner.trim()));
			const vorhanden =
				basis instanceof TFolder
					? basis.children.filter((kind): kind is TFolder => kind instanceof TFolder).map((kind) => kind.name)
					: [];
			const neu = gruppenVorschlaege(
				plattform,
				einstellungen.gruppen,
				einstellungen.ausgeblendet,
				vorhanden,
			).filter((gruppe) => nur === undefined || gruppe.groupId === nur);
			if (neu.length === 0) {
				new Notice(
					nur === undefined
						? "Keine neuen Unterrichtsgruppen auf der Plattform."
						: "Diese Gruppe gibt es auf der Plattform im laufenden Schuljahr nicht mehr.",
					8000,
				);
				return;
			}
			einstellungen.gruppen.push(...neu);
			await this.plugin.saveSettings();
			this.update();
			new Notice(
				`Übernommen: ${neu.map((g) => `${g.ordnerName} (${g.plattformName})`).join(", ")}. ` +
					"Ordnernamen bitte prüfen; was du nicht brauchst, entfernen.",
				12000,
			);
		} catch (error) {
			new Notice(deuteFehler(error as Error), 12000);
		}
	}

	/** Entfernen heißt ausblenden: Die Gruppe kommt beim Holen nicht wieder, ihre Notizen bleiben. */
	private async blendeAus(groupId: number, vonDerUnterseite = false): Promise<void> {
		const einstellungen = this.plugin.settings;
		const gruppe = einstellungen.gruppen.find((g) => g.groupId === groupId);
		if (!gruppe) return;
		einstellungen.gruppen = einstellungen.gruppen.filter((g) => g.groupId !== groupId);
		einstellungen.ausgeblendet.push({ groupId: gruppe.groupId, name: gruppe.plattformName });
		await this.plugin.saveSettings();
		// Zurück zur Liste: Die Unterseite gehört zu einer Gruppe, die es nicht mehr gibt, und
		// `update()` zeichnete sie leer. Eine öffentliche API dafür hat Obsidian (1.14) nicht;
		// fehlt `closePage` einmal, bleibt die leere Seite stehen, bis man zurückgeht.
		if (vonDerUnterseite) {
			(this.app as unknown as { setting?: { closePage?: () => void } }).setting?.closePage?.();
		}
		this.update();
		new Notice(`${gruppe.plattformName} ausgeblendet. Die Notizen im Vault bleiben, wie sie sind.`, 8000);
	}

	private async holeZurueck(groupId: number): Promise<void> {
		const einstellungen = this.plugin.settings;
		einstellungen.ausgeblendet = einstellungen.ausgeblendet.filter((g) => g.groupId !== groupId);
		await this.plugin.saveSettings();
		this.update();
		await this.holeGruppen(groupId);
	}

	private ordnerFehlt(gruppe: GruppenEinstellung): boolean {
		const pfad = ordnerPfad(this.plugin.settings.basisOrdner, gruppe.ordnerName);
		return !pfad || !(this.app.vault.getAbstractFileByPath(normalizePath(pfad)) instanceof TFolder);
	}

	private async legeOrdnerAn(gruppe: GruppenEinstellung): Promise<void> {
		const pfad = ordnerPfad(this.plugin.settings.basisOrdner, gruppe.ordnerName);
		if (!pfad) {
			new Notice("Erst Basisordner und Ordnernamen eintragen.");
			return;
		}
		const vault = new ObsidianVaultAdapter(this.app);
		await vault.ensureFolder(pfad);
		const stunden = gruppe.stundenOrdner.trim().replace(/^\/+|\/+$/g, "");
		if (stunden) await vault.ensureFolder(`${pfad}/${stunden}`);
		this.update();
		new Notice(`Ordner bereit: ${pfad}`);
	}
}

/**
 * Die Fehler, die beim Einrichten tatsächlich vorkommen — mit dem Hinweis, der
 * weiterhilft, statt nur der Statuszeile.
 */
function deuteFehler(error: Error): string {
	const text = error.message;
	if (text.includes("401")) {
		return `Token abgelehnt (401). Abgelaufen, widerrufen oder vertippt? ${text}`;
	}
	if (text.includes("403")) {
		return (
			"Zugang gesperrt (403). Entweder fehlt dem Token ein Scope (planning:read, context:read), " +
			"oder das Gatter der Plattform (app/auth/scopes.py) kennt diesen Pfad nicht. " +
			text
		);
	}
	if (text.includes("404")) {
		return (
			"Nicht gefunden (404). Stimmt die Basis-URL samt /api? „Gruppen holen“ braucht " +
			`Plattform 0.13.1 oder neuer. ${text}`
		);
	}
	return `Fehlgeschlagen: ${text}`;
}
