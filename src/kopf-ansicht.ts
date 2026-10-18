import { Keymap, MarkdownRenderChild, TFile, setIcon, type App, type HoverParent, type HoverPopover, type Plugin } from "obsidian";
import {
	KOPF_SPRACHE,
	kopfDaten,
	plattformLinks,
	type KopfDaten,
	type KopfGruppe,
	type KopfNotiz,
	type PlattformLink,
	type Verweis,
} from "./kopf";

/** Was der Kopf aus den Einstellungen braucht — gelesen bei jedem Zeichnen, nie gemerkt. */
export interface KopfEinstellungen {
	basisUrl: string;
	gruppen: KopfGruppe[];
}

/**
 * Zeichnet den Kopf der Stundennotiz aus dem Codeblock `uplan-kopf`.
 *
 * Vorher war das ein Callout mit Inline-DataviewJS. Das hatte drei Haken: In der
 * Live-Vorschau öffnete jeder Klick neben die Links den Quelltext (samt einer Zeile JS),
 * Dataview packte die Links in Hüllen ohne Klasse, gegen die das CSS anarbeiten musste, und
 * der Vault brauchte den Schalter für Inline-JS. Ein Codeblock wird als Ganzes gezeichnet;
 * bearbeitet wird er nur über den Knopf `</>`.
 */
export function registriereKopf(plugin: Plugin, einstellungen: () => KopfEinstellungen): void {
	plugin.registerMarkdownCodeBlockProcessor(KOPF_SPRACHE, (_quelle, el, ctx) => {
		ctx.addChild(new Kopf(plugin.app, el, ctx.sourcePath, einstellungen));
	});
}

const SYMBOLE: Record<PlattformLink["art"], string> = {
	entwurf: "external-link",
	// ✦ heißt auf der Plattform „Stundenassistent".
	assistent: "sparkles",
	planer: "calendar-days",
};

class Kopf extends MarkdownRenderChild implements HoverParent {
	hoverPopover: HoverPopover | null = null;
	private zuletzt = "";

	constructor(
		private readonly app: App,
		containerEl: HTMLElement,
		private readonly pfad: string,
		private readonly einstellungen: () => KopfEinstellungen,
	) {
		super(containerEl);
	}

	override onload(): void {
		this.zeichne();
		// Nachbarn entstehen und verschwinden beim Sync, auch während die Notiz offen ist.
		this.registerEvent(this.app.metadataCache.on("resolved", () => this.zeichne()));
	}

	private zeichne(): void {
		const datei = this.app.vault.getAbstractFileByPath(this.pfad);
		if (!(datei instanceof TFile)) return;
		const notiz = (f: TFile): KopfNotiz => ({
			pfad: f.path,
			name: f.basename,
			frontmatter: this.app.metadataCache.getFileCache(f)?.frontmatter ?? {},
		});
		const geschwister = (datei.parent?.children ?? [])
			.filter((f): f is TFile => f instanceof TFile && f.extension === "md")
			.map(notiz);
		const eigene = notiz(datei);
		const daten = kopfDaten(eigene, geschwister);
		const { basisUrl, gruppen } = this.einstellungen();
		const links = plattformLinks(eigene.frontmatter, basisUrl, gruppen);

		// `resolved` kommt nach jeder Änderung irgendwo im Vault; neu gezeichnet wird nur,
		// wenn sich am Kopf etwas ändert.
		const stand = JSON.stringify({ daten, links });
		if (stand === this.zuletzt) return;
		this.zuletzt = stand;
		this.containerEl.empty();
		this.baue(daten, links);
	}

	private baue(daten: KopfDaten, links: PlattformLink[]): void {
		const kopf = this.containerEl.createDiv({ cls: "uplan-kopf" });
		if (links.length > 0) {
			const plattform = kopf.createDiv({ cls: "uplan-kopf-plattform" });
			// In der Live-Vorschau öffnete ein Klick sonst den Quelltext des Blocks.
			plattform.addEventListener("mousedown", (e) => e.stopPropagation());
			for (const link of links) {
				const knopf = plattform.createEl("button", {
					cls: `uplan-kopf-${link.art} clickable-icon`,
					attr: { "aria-label": link.titel },
				});
				setIcon(knopf, SYMBOLE[link.art]);
				// Obsidian gibt eine fremde Adresse an den Standardbrowser weiter; dort ist man
				// auf der Plattform angemeldet, in Obsidian nicht.
				knopf.addEventListener("click", () => window.open(link.url));
			}
		}
		if (daten.lehrauftrag) this.verweis(kopf.createDiv({ cls: "uplan-kopf-lehrauftrag" }), daten.lehrauftrag);
		if (daten.datum) kopf.createDiv({ cls: "uplan-kopf-datum", text: daten.datum });

		// `← vorher | Einheit | nachher →` — der Pfeil gehört zu seinem Nachbarn und fehlt mit ihm.
		const nav = kopf.createDiv({ cls: "uplan-kopf-navigation" });
		const trenner = () => {
			if (nav.childElementCount > 0) nav.createSpan({ cls: "uplan-kopf-trenner", text: "|" });
		};
		if (daten.vorher) {
			nav.createSpan({ text: "←" });
			this.verweis(nav, daten.vorher);
		}
		if (daten.einheit) {
			trenner();
			this.verweis(nav, daten.einheit);
		}
		if (daten.nachher) {
			trenner();
			this.verweis(nav, daten.nachher);
			nav.createSpan({ text: "→" });
		}
		if (nav.childElementCount === 0) nav.remove();

		this.bezuege(daten);
	}

	/**
	 * Kompetenzen und Fachbegriffe der Stunde, unter dem Kopf (Plan-Plattform-0.16, P4). Knapp,
	 * weil er vor dem Verlaufsplan steht, und der zählt im Unterricht: Kompetenzen nur mit
	 * Nummer, der Wortlaut im Tooltip. Ohne beides kein Bereich, auch keine leere Zeile.
	 */
	private bezuege(daten: KopfDaten): void {
		if (daten.kompetenzen.length === 0 && daten.fachbegriffe.length === 0) return;
		const bereich = this.containerEl.createDiv({ cls: "uplan-bezuege" });
		const zeile = (titel: string, eintraege: { kurz: string; lang: string }[]) => {
			if (eintraege.length === 0) return;
			bereich.createDiv({ cls: "uplan-bezuege-titel", text: titel });
			const liste = bereich.createDiv({ cls: "uplan-bezuege-liste" });
			for (const { kurz, lang } of eintraege) {
				const el = liste.createSpan({ cls: "uplan-bezug", text: kurz });
				if (lang !== kurz) el.setAttr("aria-label", lang);
			}
		};
		zeile("Kompetenzen", daten.kompetenzen);
		zeile("Fachbegriffe", daten.fachbegriffe.map((b) => ({ kurz: b, lang: b })));
	}

	/**
	 * Ein Link wie im Text der Notiz: Klick öffnet, Cmd-Klick in neuem Tab, Überfahren
	 * zeigt die Vorschau. Die Ereignisse hängen am Link selbst — ob Obsidian Klicks in einem
	 * Codeblock-Widget der Live-Vorschau selbst weiterreicht, ist nicht zugesagt.
	 */
	private verweis(parent: HTMLElement, v: Verweis): void {
		if (!v.ziel) {
			parent.createSpan({ text: v.text });
			return;
		}
		const ziel = v.ziel;
		const a = parent.createEl("a", { cls: "internal-link", text: v.text, href: ziel, attr: { "data-href": ziel } });
		if (!this.app.metadataCache.getFirstLinkpathDest(ziel, this.pfad)) a.addClass("is-unresolved");
		a.addEventListener("click", (event) => {
			event.preventDefault();
			void this.app.workspace.openLinkText(ziel, this.pfad, Keymap.isModEvent(event));
		});
		a.addEventListener("mouseover", (event) => {
			this.app.workspace.trigger("hover-link", {
				event,
				source: "preview",
				hoverParent: this,
				targetEl: a,
				linktext: ziel,
				sourcePath: this.pfad,
			});
		});
	}
}
