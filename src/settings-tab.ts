import { App, Notice, PluginSettingTab, Setting, TFolder, normalizePath } from "obsidian";
import type UnterrichtsplanungSyncPlugin from "./main";
import { leereZuordnung } from "./settings";

export class UpsSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: UnterrichtsplanungSyncPlugin,
	) {
		super(app, plugin);
	}

	private ordnerExistiert(pfad: string): boolean {
		return this.app.vault.getAbstractFileByPath(normalizePath(pfad)) instanceof TFolder;
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
						// Ohne group_id: `/groups/me` ist der einzige offene Pfad, der
						// keine Gruppe voraussetzt — und liefert gleich die Auswahl mit.
						const gruppen = await this.plugin.api.myGroups();
						const liste = gruppen.length
							? gruppen.map((g) => `${g.id} = ${g.name}`).join(", ")
							: "keine";
						const zeilen = [`Verbindung steht. Eigene Gruppen: ${liste}`];

						const zugeordnet = this.plugin.settings.zuordnungen.filter((z) => z.groupId > 0);
						for (const z of zugeordnet) {
							try {
								const probe = await this.plugin.api.gruppenprobe(z.groupId);
								zeilen.push(`Gruppe ${z.groupId}: ${probe.schuljahr}, ${probe.slots} Slots`);
							} catch (error) {
								zeilen.push(`Gruppe ${z.groupId}: ${deuteFehler(error as Error)}`);
							}
						}
						new Notice(zeilen.join("\n"), 12000);
					} catch (error) {
						new Notice(deuteFehler(error as Error), 12000);
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
				.setName("Lehrauftrag-Notiz (optional)")
				.setDesc(
					"Leer lassen: Dann ist es der Ordnername — so heißt die Ordnernotiz ohnehin. Nur ausfüllen, wenn die Notiz anders heißen soll als ihr Ordner.",
				)
				.addText((text) =>
					text.setValue(zuordnung.lehrauftragLink).onChange(async (value) => {
						zuordnung.lehrauftragLink = value;
						await this.plugin.saveSettings();
					}),
				);

			const ordnerSetting = new Setting(block)
				.setName("Ordner des Lehrauftrags")
				.setDesc(
					'Der Ordner dieses einen Lehrauftrags, z. B. "Bereiche/11 Unterricht/NwT 9" — nicht der Sammelordner darüber.',
				);
			const ordnerHinweis = ordnerSetting.descEl.createDiv({ cls: "ups-hinweis" });
			ordnerSetting.addText((text) => {
				const pruefe = () => {
					const ziel = zuordnung.ordner.trim();
					const fehlt = ziel !== "" && !this.ordnerExistiert(ziel);
					ordnerHinweis.setText(fehlt ? `Diesen Ordner gibt es im Vault nicht: ${ziel}` : "");
					ordnerHinweis.toggleClass("ups-status-warn", fehlt);
					text.inputEl.toggleClass("ups-feld-warnung", fehlt);
				};

				text.setPlaceholder("Bereiche/11 Unterricht/NwT 9")
					.setValue(zuordnung.ordner)
					.onChange(async (value) => {
						zuordnung.ordner = value.replace(/\/+$/, "");
						await this.plugin.saveSettings();
					});

				// Erst beim Verlassen des Feldes prüfen. Bei jedem Tastendruck zu melden,
				// dass es „Bereiche/11 Unterricht/N" nicht gibt, ist zwar wahr, aber
				// während des Tippens ist jeder Zwischenstand unvollständig.
				text.inputEl.addEventListener("blur", pruefe);
				pruefe();
			});

			new Setting(block)
				.setName("Fach")
				.setDesc(
					'Vault-Konvention, z. B. "NwT" — daraus wird `Fach: "[[NwT]]"`. Die Plattform kann das nicht liefern: Im Vault steht mal [[Chemie]], mal CH.',
				)
				.addText((text) =>
					text
						.setPlaceholder("NwT")
						.setValue(zuordnung.fach)
						.onChange(async (value) => {
							zuordnung.fach = value.trim();
							await this.plugin.saveSettings();
						}),
				);

			new Setting(block)
				.setName("Stufe")
				.setDesc("Jahrgangsstufe für Lehrauftrags- und UE-Notizen.")
				.addText((text) =>
					text
						.setPlaceholder("9")
						.setValue(zuordnung.stufe === null ? "" : String(zuordnung.stufe))
						.onChange(async (value) => {
							const zahl = Number.parseInt(value, 10);
							zuordnung.stufe = Number.isFinite(zahl) ? zahl : null;
							await this.plugin.saveSettings();
						}),
				)
				.addButton((button) =>
					button
						.setButtonText("Von der Plattform")
						.setTooltip("Jahrgang aus der Curriculum-Zuordnung der Gruppe holen")
						.onClick(async () => {
							if (!zuordnung.groupId) {
								new Notice("Erst eine group_id eintragen.");
								return;
							}
							try {
								const grade = await this.plugin.api.groupGrade(zuordnung.groupId);
								if (grade === null) {
									new Notice("Die Plattform kennt den Jahrgang dieser Gruppe nicht.", 6000);
									return;
								}
								zuordnung.stufe = grade;
								await this.plugin.saveSettings();
								this.display();
							} catch (error) {
								new Notice(deuteFehler(error as Error), 10000);
							}
						}),
				);

			new Setting(block).setName("Stunden-Unterordner").addText((text) =>
				text.setValue(zuordnung.stundenOrdner).onChange(async (value) => {
					zuordnung.stundenOrdner = value.replace(/^\/+|\/+$/g, "");
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

/**
 * Die drei Fehler, die beim Einrichten tatsächlich vorkommen — mit dem Hinweis, der
 * weiterhilft, statt nur der Statuszeile.
 */
function deuteFehler(error: Error): string {
	const text = error.message;
	if (text.includes("401")) {
		return `Token abgelehnt (401). Abgelaufen, widerrufen oder vertippt? ${text}`;
	}
	if (text.includes("403")) {
		return (
			"Zugang gesperrt (403). Entweder fehlt dem Token der Scope planning:read, " +
			"oder das Gatter der Plattform (app/auth/scopes.py) kennt diesen Pfad nicht. " +
			text
		);
	}
	if (text.includes("404")) {
		return `Nicht gefunden (404). Stimmt die Basis-URL samt /api, und unterrichtest du diese Gruppe? ${text}`;
	}
	return `Fehlgeschlagen: ${text}`;
}
