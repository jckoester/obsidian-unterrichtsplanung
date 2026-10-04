import { MarkdownRenderChild, TFile, type App, type Plugin } from "obsidian";
import { ZEITLEISTE } from "./sync/phasen";
import { balken, zeitleisteAus, type ZeitleisteDaten } from "./zeitbudget";

/**
 * Zeichnet die Zeitleiste aus dem Codeblock `uplan-zeit` unter `## Ablauf`: wie viel der
 * Stunde verplant ist, wie viel frei, und einen Balken mit einem Abschnitt je Phase, gefärbt
 * nach Prio wie auf der Plattform (Plan-Ablauf-Editor, B3).
 */
export function registriereZeitleiste(plugin: Plugin): void {
	plugin.registerMarkdownCodeBlockProcessor(ZEITLEISTE, (_quelle, el, ctx) => {
		ctx.addChild(new Zeitleiste(plugin.app, el, ctx.sourcePath));
	});
}

const PRIOS = new Set(["kern", "uebung", "vertiefung"]);

class Zeitleiste extends MarkdownRenderChild {
	private zuletzt = "";

	constructor(
		private readonly app: App,
		containerEl: HTMLElement,
		private readonly pfad: string,
	) {
		super(containerEl);
	}

	override onload(): void {
		const datei = this.app.vault.getAbstractFileByPath(this.pfad);
		if (!(datei instanceof TFile)) return;
		void this.app.vault.cachedRead(datei).then((inhalt) => this.zeichne(inhalt));
		// Der Codeblock selbst ändert sich nie — der Ablauf darunter schon. `changed` kommt,
		// sobald Obsidian die Notiz gespeichert hat, und bringt den neuen Text mit.
		this.registerEvent(
			this.app.metadataCache.on("changed", (geaendert, inhalt) => {
				if (geaendert.path === this.pfad) this.zeichne(inhalt);
			}),
		);
	}

	private zeichne(inhalt: string): void {
		const daten = zeitleisteAus(inhalt);
		const stand = JSON.stringify(daten);
		if (stand === this.zuletzt) return;
		this.zuletzt = stand;
		this.containerEl.empty();
		if (daten) this.baue(daten);
	}

	private baue({ budget, fehler }: ZeitleisteDaten): void {
		const leiste = this.containerEl.createDiv({ cls: "uplan-zeit" });

		const kopf = leiste.createDiv({ cls: "uplan-zeit-kopf" });
		kopf.createSpan({ text: `${budget.geplant}′ von ${budget.verfuegbar}′ verplant` });
		kopf.createSpan({ cls: "uplan-zeit-trenner", text: "·" });
		if (budget.ueberhang > 0) {
			kopf.createSpan({ cls: "uplan-zeit-ueberhang", text: `+${budget.ueberhang}′ Überhang` });
		} else {
			kopf.createSpan({ text: `${budget.frei}′ frei` });
		}
		if (budget.ohneDauer > 0) {
			kopf.createSpan({ cls: "uplan-zeit-trenner", text: "·" });
			kopf.createSpan({
				cls: "uplan-zeit-hinweis",
				text: budget.ohneDauer === 1 ? "1 Phase ohne Dauer" : `${budget.ohneDauer} Phasen ohne Dauer`,
			});
		}

		const { teile, ziel } = balken(budget);
		const leisteEl = leiste.createDiv({ cls: "uplan-zeit-balken" });
		for (const teil of teile) {
			const abschnitt = teil.nummer !== undefined ? budget.abschnitte[teil.nummer] : undefined;
			const el = leisteEl.createDiv({ cls: abschnitt ? "uplan-zeit-phase" : "uplan-zeit-frei" });
			el.style.width = `${teil.anteil}%`;
			if (!abschnitt) continue;
			el.addClass(`mod-${abschnitt.prio && PRIOS.has(abschnitt.prio) ? abschnitt.prio : "ohne-prio"}`);
			if (abschnitt.dauer === null) el.addClass("mod-ohne-dauer");
			el.setAttr("aria-label", `${abschnitt.spanne} ${abschnitt.name}`);
			el.createSpan({ text: abschnitt.name });
		}
		// Nur bei einem Überhang: Sonst endet die verfügbare Zeit ohnehin am rechten Rand.
		if (budget.ueberhang > 0) {
			const linie = leisteEl.createDiv({ cls: "uplan-zeit-ziel" });
			linie.style.left = `${ziel}%`;
		}

		if (fehler.length > 0) {
			const liste = leiste.createEl("ul", { cls: "uplan-zeit-fehler" });
			for (const text of fehler) liste.createEl("li", { text });
		}
	}
}
