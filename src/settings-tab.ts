import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type UnterrichtsplanungSyncPlugin from "./main";
import { leereZuordnung } from "./settings";
import { STANDARD_DATEIMUSTER } from "./sync/materialize";

export class UpsSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: UnterrichtsplanungSyncPlugin,
	) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Basis-URL")
			.setDesc(
				"Inklusive /api — das Präfix hängt der Reverse-Proxy davor, nicht FastAPI.",
			)
			.addText((text) =>
				text
					.setPlaceholder("https://ki.beispiel.de/api")
					.setValue(this.plugin.settings.basisUrl)
					.onChange(async (value) => {
						this.plugin.settings.basisUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Zugangstoken")
			.setDesc(
				"Personal Access Token aus dem Profil (ggd_pat_…). Scopes: planning:read, für Stufe 2 zusätzlich planning:write.",
			)
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
				button.setButtonText("Verbindung testen").onClick(async () => {
					button.setDisabled(true);
					try {
						const scopes = await this.plugin.api.tokenScopes();
						const gruppen = await this.plugin.api.myGroups();
						new Notice(
							`Verbindung steht. Scopes verfügbar: ${Object.keys(scopes).length}, eigene Gruppen: ${gruppen.groups?.length ?? 0}`,
							8000,
						);
					} catch (error) {
						new Notice(`Fehlgeschlagen: ${(error as Error).message}`, 10000);
					} finally {
						button.setDisabled(false);
					}
				}),
			);

		new Setting(containerEl)
			.setName("Probelauf (Dry-Run)")
			.setDesc("Zeigt die geplanten Dateioperationen, ohne zu schreiben.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.dryRun).onChange(async (value) => {
					this.plugin.settings.dryRun = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Sync-Intervall")
			.setDesc("Minuten; 0 = nur auf Befehl.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.syncIntervall))
					.onChange(async (value) => {
						const zahl = Number.parseInt(value, 10);
						this.plugin.settings.syncIntervall = Number.isFinite(zahl) ? Math.max(0, zahl) : 0;
						await this.plugin.saveSettings();
						this.plugin.planeIntervall();
					}),
			);

		containerEl.createEl("h3", { text: "Gruppen-Zuordnung" });
		containerEl.createEl("p", {
			text: "Welche Unterrichtsgruppe der Plattform in welchen Lehrauftrag-Ordner gespiegelt wird.",
			cls: "setting-item-description",
		});

		this.plugin.settings.zuordnungen.forEach((zuordnung, index) => {
			const block = containerEl.createDiv();
			block.createEl("h4", { text: `Gruppe ${zuordnung.groupId || "(neu)"}` });

			new Setting(block).setName("group_id").addText((text) =>
				text.setValue(String(zuordnung.groupId)).onChange(async (value) => {
					zuordnung.groupId = Number.parseInt(value, 10) || 0;
					await this.plugin.saveSettings();
				}),
			);

			new Setting(block)
				.setName("Lehrauftrag-Link")
				.setDesc('Ziel des Wikilinks, z. B. "NwT 9 2526|NwT 9".')
				.addText((text) =>
					text.setValue(zuordnung.lehrauftragLink).onChange(async (value) => {
						zuordnung.lehrauftragLink = value;
						await this.plugin.saveSettings();
					}),
				);

			new Setting(block).setName("Ordner").addText((text) =>
				text.setValue(zuordnung.ordner).onChange(async (value) => {
					zuordnung.ordner = value.replace(/\/+$/, "");
					await this.plugin.saveSettings();
				}),
			);

			new Setting(block).setName("Stunden-Unterordner").addText((text) =>
				text.setValue(zuordnung.stundenOrdner).onChange(async (value) => {
					zuordnung.stundenOrdner = value.replace(/^\/+|\/+$/g, "");
					await this.plugin.saveSettings();
				}),
			);

			new Setting(block)
				.setName("Dateimuster")
				.setDesc(`Platzhalter: {lehrauftrag} {nr} {datum} {thema} — Standard: ${STANDARD_DATEIMUSTER}`)
				.addText((text) =>
					text.setValue(zuordnung.dateiMuster).onChange(async (value) => {
						zuordnung.dateiMuster = value || STANDARD_DATEIMUSTER;
						await this.plugin.saveSettings();
					}),
				);

			new Setting(block).addButton((button) =>
				button
					.setButtonText("Zuordnung entfernen")
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.zuordnungen.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					}),
			);
		});

		new Setting(containerEl).addButton((button) =>
			button
				.setButtonText("Zuordnung hinzufügen")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.zuordnungen.push(leereZuordnung());
					await this.plugin.saveSettings();
					this.display();
				}),
		);
	}
}
