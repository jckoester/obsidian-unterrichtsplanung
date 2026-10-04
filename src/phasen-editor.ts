import { AbstractInputSuggest, Modal, Notice, Setting, TFile, setIcon, type App, type Plugin } from "obsidian";
import {
	ablaufImText,
	bearbeiteAblauf,
	phaseInTabellenzeile,
	type Aenderung,
	type AblaufFeld,
	type AblaufImText,
	type VaultPhase,
} from "./sync/phasen";
import type { Eintrag, Wertelisten } from "./sync/wertelisten";

/**
 * Der Phasen-Editor (Plan-Ablauf-Editor, B5): ein Dialog für eine Phase des Ablaufs, mit
 * Prio als Auswahl und den Wertelisten der Plattform für Sozialform und Methode. Er schreibt
 * nur die Notiz — zur Plattform geht die Änderung wie jede andere beim nächsten Sync.
 */

/** Welche Phase: eine bestimmte, die in Datenzeile `zeile` einer Tabelle, oder eine neue. */
export type Ziel = { nummer: number } | { zeile: number; zeilentext: string } | "neu";

export type Bearbeite = (pfad: string, ziel: Ziel) => void;

const PRIOS: Record<string, string> = { kern: "Kern", uebung: "Übung", vertiefung: "Vertiefung" };
const NAME_MAX = 200;
const DAUER_MIN = 1;
const DAUER_MAX = 480;

/** Öffnet den Editor — gemeinsam für den Knopf in der Tabelle und die Zeitleiste. */
export async function oeffnePhasenEditor(
	app: App,
	wertelisten: Wertelisten | null,
	pfad: string,
	ziel: Ziel,
): Promise<void> {
	const datei = app.vault.getAbstractFileByPath(pfad);
	if (!(datei instanceof TFile)) return;
	const text = await app.vault.read(datei);
	const imText = ablaufImText(text);
	if (!imText) {
		new Notice("Diese Notiz hat keinen Abschnitt „## Ablauf“.");
		return;
	}
	let nummer: number | null = null;
	if (ziel !== "neu" && "nummer" in ziel) nummer = ziel.nummer;
	if (ziel !== "neu" && "zeile" in ziel) {
		nummer = phaseInTabellenzeile(text, ziel.zeile);
		const phase = nummer === null ? undefined : imText.ablauf.phasen[nummer];
		// Der Knopf zählt seine Zeile im DOM. Steht ein `✎` in einer anderen Tabelle der
		// Notiz, träfe die Zählung die falsche Phase — dann lieber nichts öffnen.
		if (!phase || !ziel.zeilentext.includes(phase.name)) {
			new Notice("Diese Zeile gehört zu keiner Phase des Ablaufs.");
			return;
		}
	}
	new PhasenEditor(app, datei, imText, nummer, wertelisten).open();
}

/**
 * Macht aus dem Inline-Code `✎` in einer Tabellenzelle einen Knopf — nur in Stundennotizen.
 *
 * Ein Inline-Code, weil Obsidian ihn in der Live-Vorschau dem Plugin zeigt: Dort zeichnet es
 * die Tabelle selbst und reicht dem Postprozessor nur einzelne Zellen. Ein Knopf irgendwo
 * sonst in der Zeile ginge nur über den internen Aufbau des Tabellen-Widgets.
 */
export function registrierePhasenknopf(plugin: Plugin, bearbeite: Bearbeite): void {
	plugin.registerMarkdownPostProcessor((el, ctx) => {
		const codes = Array.from(el.querySelectorAll("code")).filter((c) => c.textContent === "✎" && c.closest("td"));
		if (codes.length === 0) return;
		const frontmatter = plugin.app.metadataCache.getCache(ctx.sourcePath)?.frontmatter;
		if (!frontmatter?.["uplan_slot_id"]) return;
		for (const code of codes) {
			const knopf = createEl("button", { cls: "uplan-phasenknopf", attr: { "aria-label": "Phase bearbeiten" } });
			setIcon(knopf, "pencil");
			// Sonst geht die Zelle in der Live-Vorschau in den Bearbeitungsmodus.
			const halt = (e: Event) => {
				e.preventDefault();
				e.stopPropagation();
			};
			knopf.addEventListener("mousedown", halt);
			knopf.addEventListener("pointerdown", halt);
			knopf.addEventListener("click", (e) => {
				halt(e);
				const zeile = knopf.closest("tr");
				// `rowIndex` zählt die Kopfzeile mit — so in der Live-Vorschau wie in der Leseansicht.
				if (zeile) bearbeite(ctx.sourcePath, { zeile: zeile.rowIndex - 1, zeilentext: zeile.textContent ?? "" });
			});
			code.replaceWith(knopf);
		}
	});
}

class PhasenEditor extends Modal {
	private readonly vorher: VaultPhase | null;
	private readonly felder: Set<AblaufFeld>;
	private werte: Required<Omit<VaultPhase, "beschreibung" | "sozialform" | "methode">> & {
		beschreibung: string;
		sozialform: string;
		methode: string;
	};
	private fehlerEl!: HTMLElement;

	constructor(
		app: App,
		private readonly datei: TFile,
		imText: AblaufImText,
		private readonly nummer: number | null,
		private readonly wertelisten: Wertelisten | null,
	) {
		super(app);
		this.vorher = nummer === null ? null : (imText.ablauf.phasen[nummer] ?? null);
		this.felder = imText.felder;
		const v = this.vorher;
		this.werte = {
			name: v?.name ?? "",
			dauer_min: v?.dauer_min ?? (v ? null : 15),
			prio: v?.prio ?? "kern",
			beschreibung: v?.beschreibung ?? "",
			sozialform: v?.sozialform ?? "",
			methode: v?.methode ?? "",
			material: v?.material ?? [],
		};
	}

	override onOpen(): void {
		const { contentEl } = this;
		this.setTitle(this.vorher ? "Phase bearbeiten" : "Neue Phase");
		contentEl.addClass("uplan-phasen-editor");

		new Setting(contentEl).setName("Phase").addText((text) => {
			text.setValue(this.werte.name).onChange((wert) => (this.werte.name = wert));
			text.inputEl.addClass("uplan-editor-breit");
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		this.feld("dauer", "Minuten", (setting) =>
			setting.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = String(DAUER_MIN);
				text.inputEl.max = String(DAUER_MAX);
				text.setPlaceholder("–")
					.setValue(this.werte.dauer_min === null ? "" : String(this.werte.dauer_min))
					.onChange((wert) => (this.werte.dauer_min = wert.trim() === "" ? null : Number(wert)));
			}),
		);

		this.feld("prio", "Prio", (setting) =>
			setting.addDropdown((auswahl) =>
				auswahl
					.addOptions(PRIOS)
					.setValue(PRIOS[this.werte.prio] ? this.werte.prio : "kern")
					.onChange((wert) => (this.werte.prio = wert)),
			),
		);

		this.feld("beschreibung", "Inhalt", (setting) =>
			setting.addTextArea((text) => {
				text.setValue(this.werte.beschreibung).onChange((wert) => (this.werte.beschreibung = wert));
				text.inputEl.rows = 4;
				text.inputEl.addClass("uplan-editor-breit");
			}),
		);

		this.feld("sozialform", "Sozialform", (setting) =>
			setting.addText((text) => {
				text.setValue(this.werte.sozialform).onChange((wert) => (this.werte.sozialform = wert));
				new WerteVorschlag(this.app, text.inputEl, this.wertelisten?.sozialform ?? []).onSelect((e) => {
					this.werte.sozialform = e.titel;
				});
			}),
		);

		this.feld("methode", "Methode", (setting) =>
			setting.addText((text) => {
				text.setValue(this.werte.methode).onChange((wert) => (this.werte.methode = wert));
				new WerteVorschlag(this.app, text.inputEl, this.wertelisten?.methode ?? []).onSelect((e) => {
					this.werte.methode = e.titel;
				});
			}),
		);

		this.feld("material", "Material", (setting) =>
			setting.setDesc("Durch Komma getrennt.").addText((text) => {
				text.setValue(this.werte.material.join(", ")).onChange((wert) => {
					this.werte.material = wert.split(",").map((m) => m.trim()).filter(Boolean);
				});
				text.inputEl.addClass("uplan-editor-breit");
			}),
		);

		this.fehlerEl = contentEl.createDiv({ cls: "uplan-editor-fehler" });

		const knoepfe = new Setting(contentEl);
		if (this.vorher) {
			knoepfe.addButton((b) => b.setButtonText("Phase löschen").setWarning().onClick(() => void this.loesche()));
		}
		knoepfe
			.addButton((b) => b.setButtonText("Abbrechen").onClick(() => this.close()))
			.addButton((b) => b.setButtonText("Speichern").setCta().onClick(() => void this.speichere()));
		this.scope.register(["Mod"], "Enter", () => {
			void this.speichere();
			return false;
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	/** Ein Feld, das die Darstellung ausdrücken kann — sonst nur ein Hinweis, warum es fehlt. */
	private feld(feld: AblaufFeld, name: string, baue: (setting: Setting) => void): void {
		const setting = new Setting(this.contentEl).setName(name);
		if (this.felder.has(feld)) {
			baue(setting);
		} else {
			setting.setDesc("Die Tabelle dieser Notiz hat dafür keine Spalte.").setDisabled(true);
		}
	}

	/** Die Phase, wie sie in die Notiz geht — nur mit den Feldern, die die Darstellung kennt. */
	private phase(): VaultPhase | string {
		const w = this.werte;
		const name = w.name.trim();
		if (!name) return "Die Phase braucht einen Namen.";
		if (name.length > NAME_MAX) return `Der Name ist länger als ${NAME_MAX} Zeichen.`;
		if (w.dauer_min !== null && !(Number.isInteger(w.dauer_min) && w.dauer_min >= DAUER_MIN && w.dauer_min <= DAUER_MAX)) {
			return `Die Dauer muss zwischen ${DAUER_MIN} und ${DAUER_MAX} Minuten liegen — oder leer bleiben.`;
		}
		const phase: VaultPhase = { name };
		const hat = (f: AblaufFeld) => this.felder.has(f);
		if (hat("dauer")) phase.dauer_min = w.dauer_min;
		if (hat("prio")) phase.prio = w.prio;
		if (hat("beschreibung")) phase.beschreibung = w.beschreibung.trim() || null;
		if (hat("sozialform")) phase.sozialform = w.sozialform.trim() || null;
		if (hat("methode")) phase.methode = w.methode.trim() || null;
		if (hat("material")) phase.material = w.material;
		return phase;
	}

	private async speichere(): Promise<void> {
		const phase = this.phase();
		if (typeof phase === "string") {
			this.fehlerEl.setText(phase);
			return;
		}
		const aenderung: Aenderung =
			this.vorher && this.nummer !== null
				? { art: "ersetzen", nummer: this.nummer, vorher: this.vorher, phase }
				: { art: "anhaengen", phase };
		await this.schreibe(aenderung);
	}

	private async loesche(): Promise<void> {
		if (!this.vorher || this.nummer === null) return;
		await this.schreibe({ art: "loeschen", nummer: this.nummer, vorher: this.vorher });
	}

	private async schreibe(aenderung: Aenderung): Promise<void> {
		try {
			await this.app.vault.process(this.datei, (text) => bearbeiteAblauf(text, aenderung));
			this.close();
		} catch (error) {
			this.fehlerEl.setText((error as Error).message);
		}
	}
}

/** Vorschläge aus einer Werteliste, gefunden über Titel und Alias. Freie Eingabe bleibt möglich. */
class WerteVorschlag extends AbstractInputSuggest<Eintrag> {
	constructor(
		app: App,
		private readonly eingabe: HTMLInputElement,
		private readonly liste: Eintrag[],
	) {
		super(app, eingabe);
	}

	protected getSuggestions(anfrage: string): Eintrag[] {
		const q = anfrage.trim().toLowerCase();
		return this.liste.filter(
			(e) => !q || e.titel.toLowerCase().includes(q) || e.aliase.some((a) => a.toLowerCase().includes(q)),
		);
	}

	renderSuggestion(eintrag: Eintrag, el: HTMLElement): void {
		el.createDiv({ text: eintrag.titel });
		if (eintrag.aliase.length > 0) el.createDiv({ cls: "uplan-vorschlag-alias", text: eintrag.aliase.join(", ") });
	}

	override selectSuggestion(eintrag: Eintrag, evt: MouseEvent | KeyboardEvent): void {
		this.setValue(eintrag.titel);
		this.eingabe.dispatchEvent(new Event("input"));
		super.selectSuggestion(eintrag, evt);
		this.close();
	}
}
