import { Notice, Plugin, requestUrl } from "obsidian";
import { GgdApiClient } from "./api/client";
import { RequestUrlHttpClient } from "./api/http";
import { DryRunModal } from "./dryrun-modal";
import { STANDARD_EINSTELLUNGEN, type UpsSettings } from "./settings";
import { UpsSettingTab } from "./settings-tab";
import { ObsidianVaultAdapter } from "./sync/obsidian-vault";
import { syncGruppe } from "./sync/runner";

export default class UnterrichtsplanungSyncPlugin extends Plugin {
	settings!: UpsSettings;
	api!: GgdApiClient;
	private vault!: ObsidianVaultAdapter;
	private statusLeiste?: HTMLElement;
	private intervallId?: number;

	override async onload(): Promise<void> {
		await this.loadSettings();

		this.api = new GgdApiClient(
			new RequestUrlHttpClient(
				requestUrl as never,
				() => this.settings.basisUrl,
				() => this.settings.token,
			),
		);
		this.vault = new ObsidianVaultAdapter(this.app);

		this.statusLeiste = this.addStatusBarItem();
		this.zeigeStatus(this.settings.letzterSync ? `Sync: ${this.settings.letzterSync}` : "Sync: nie");

		this.addSettingTab(new UpsSettingTab(this.app, this));

		this.addCommand({
			id: "sync-alle-gruppen",
			name: "Alle Gruppen synchronisieren",
			callback: () => void this.syncAlle(this.settings.dryRun),
		});

		this.addCommand({
			id: "sync-probelauf",
			name: "Probelauf für alle Gruppen",
			callback: () => void this.syncAlle(true),
		});

		this.planeIntervall();
	}

	override onunload(): void {
		if (this.intervallId) window.clearInterval(this.intervallId);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, STANDARD_EINSTELLUNGEN, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	planeIntervall(): void {
		if (this.intervallId) window.clearInterval(this.intervallId);
		const minuten = this.settings.syncIntervall;
		if (!minuten) return;
		this.intervallId = window.setInterval(
			() => void this.syncAlle(this.settings.dryRun),
			minuten * 60_000,
		);
		this.registerInterval(this.intervallId);
	}

	private async syncAlle(dryRun: boolean): Promise<void> {
		if (!this.settings.basisUrl || !this.settings.token) {
			new Notice("Unterrichtsplanung-Sync: Basis-URL und Token fehlen noch.");
			return;
		}
		if (this.settings.zuordnungen.length === 0) {
			new Notice("Unterrichtsplanung-Sync: keine Gruppen-Zuordnung eingetragen.");
			return;
		}

		this.zeigeStatus("Sync läuft …");
		let fehlerhaft = 0;

		for (const zuordnung of this.settings.zuordnungen) {
			try {
				const ergebnis = await syncGruppe(this.api, this.vault, zuordnung, dryRun);
				if (dryRun) {
					new DryRunModal(this.app, ergebnis.plan).open();
				} else {
					new Notice(`Gruppe ${zuordnung.groupId}: ${ergebnis.zusammenfassung}`, 6000);
				}
				if (ergebnis.fehler.length > 0) {
					fehlerhaft++;
					console.error("[UPS] Fehler beim Ausführen:", ergebnis.fehler);
				}
			} catch (error) {
				fehlerhaft++;
				console.error("[UPS] Sync fehlgeschlagen:", error);
				new Notice(`Gruppe ${zuordnung.groupId}: ${(error as Error).message}`, 10000);
			}
		}

		const zeit = new Date().toLocaleString("de-DE");
		this.settings.letzterSync = zeit;
		await this.saveSettings();
		this.zeigeStatus(
			fehlerhaft > 0 ? `Sync: ${zeit} (${fehlerhaft} Fehler)` : `Sync: ${zeit}`,
			fehlerhaft > 0,
		);
	}

	private zeigeStatus(text: string, fehler = false): void {
		if (!this.statusLeiste) return;
		this.statusLeiste.setText(text);
		this.statusLeiste.toggleClass("ups-status-error", fehler);
	}
}
