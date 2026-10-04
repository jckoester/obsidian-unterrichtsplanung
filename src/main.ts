import { Notice, Plugin, requestUrl } from "obsidian";
import { GgdApiClient } from "./api/client";
import { RequestUrlHttpClient } from "./api/http";
import { SyncErgebnisModal } from "./dryrun-modal";
import { registriereKopf } from "./kopf-ansicht";
import { registriereZeitleiste } from "./zeitleiste-ansicht";
import { neueGruppen, zuordnungFuer } from "./gruppen";
import { ladeEinstellungen, type UpsSettings } from "./settings";
import { UpsSettingTab } from "./settings-tab";
import { ObsidianVaultAdapter } from "./sync/obsidian-vault";
import { ladeWertelisten, syncGruppe } from "./sync/runner";

export default class UnterrichtsplanungSyncPlugin extends Plugin {
	// `Plugin` deklariert selbst ein optionales `settings?: unknown`; hier wird es verengt.
	declare settings: UpsSettings;
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
		registriereKopf(this);
		registriereZeitleiste(this);

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
		this.settings = ladeEinstellungen(await this.loadData());
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
		if (this.settings.gruppen.length === 0) {
			new Notice("Unterrichtsplanung-Sync: noch keine Gruppe eingerichtet — in den Einstellungen „Gruppen von der Plattform holen“.");
			return;
		}

		this.zeigeStatus("Sync läuft …");
		let fehlerhaft = 0;
		await this.aktualisiereWertelisten();

		for (const gruppe of this.settings.gruppen) {
			const zuordnung = zuordnungFuer(this.settings.basisOrdner, gruppe);
			try {
				const ergebnis = await syncGruppe(this.api, this.vault, zuordnung, dryRun, this.settings.wertelisten);
				console.info(`[UPS] Gruppe ${zuordnung.groupId}:`, ergebnis.plan.ops);

				// Auch der scharfe Lauf zeigt sein Ergebnis: Eine Notice, die „12×
				// erstellen" sagt, während zwölf Schreibversuche gescheitert sind, wäre
				// die schlechteste aller Rückmeldungen.
				if (ergebnis.fehler.length > 0) {
					fehlerhaft++;
					console.error("[UPS] Fehler beim Ausführen:", ergebnis.fehler);
				}
				const stillerLauf =
					!dryRun &&
					ergebnis.fehler.length === 0 &&
					ergebnis.plan.ops.every((op) => op.art === "unveraendert");
				if (dryRun || ergebnis.fehler.length > 0 || stillerLauf) {
					new SyncErgebnisModal(this.app, ergebnis).open();
				} else {
					new Notice(`Gruppe ${zuordnung.groupId}: ${ergebnis.zusammenfassung}`, 6000);
				}
			} catch (error) {
				fehlerhaft++;
				console.error("[UPS] Sync fehlgeschlagen:", error);
				new Notice(`Gruppe ${zuordnung.groupId}: ${(error as Error).message}`, 10000);
			}
		}

		await this.meldeNeueGruppen();

		const zeit = new Date().toLocaleString("de-DE");
		this.settings.letzterSync = zeit;
		await this.saveSettings();
		this.zeigeStatus(
			fehlerhaft > 0 ? `Sync: ${zeit} (${fehlerhaft} Fehler)` : `Sync: ${zeit}`,
			fehlerhaft > 0,
		);
	}

	/**
	 * Sozialformen und Methoden neu laden. Scheitert es, bleiben die gemerkten Listen — der
	 * Sync braucht sie nur, um neue Werte im Rückkanal zu Verweisen zu machen; ohne sie gehen
	 * sie als Freitext, wie bisher.
	 */
	private async aktualisiereWertelisten(): Promise<void> {
		try {
			this.settings.wertelisten = await ladeWertelisten(this.api);
		} catch (error) {
			console.info("[UPS] Wertelisten nicht geladen, die gemerkten bleiben:", error);
		}
	}

	/**
	 * Neue Unterrichtsgruppen auf der Plattform nur melden, nicht einrichten: Ein Sync, der
	 * still Einstellungen ändert, legte Notizen unter einem Ordnernamen an, den noch niemand
	 * geprüft hat. Scheitert die Abfrage (etwa eine Plattform vor 0.13.1), bleibt es still —
	 * der Hinweis ist eine Gefälligkeit, kein Teil des Syncs.
	 */
	private async meldeNeueGruppen(): Promise<void> {
		try {
			const neu = neueGruppen(
				await this.api.planungsgruppen(),
				this.settings.gruppen,
				this.settings.ausgeblendet,
			);
			if (neu.length === 0) return;
			new Notice(
				`${neu.length === 1 ? "Eine neue Unterrichtsgruppe" : `${neu.length} neue Unterrichtsgruppen`} auf der Plattform: ` +
					`${neu.map((g) => g.name).join(", ")} — in den Einstellungen übernehmen oder ausblenden.`,
				10000,
			);
		} catch (error) {
			console.info("[UPS] Neue Gruppen nicht abgefragt:", error);
		}
	}

	private zeigeStatus(text: string, fehler = false): void {
		if (!this.statusLeiste) return;
		this.statusLeiste.setText(text);
		this.statusLeiste.toggleClass("ups-status-error", fehler);
	}
}
