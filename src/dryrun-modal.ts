import { App, Modal } from "obsidian";
import type { SyncErgebnis } from "./sync/runner";
import { planZusammenfassung } from "./sync/plan";

/**
 * Zeigt, was ein Lauf vorhatte — und beim scharfen Lauf, was daraus wurde.
 *
 * Beide Fälle in einem Fenster, weil die interessante Frage dieselbe ist: Welche Datei,
 * welche Operation, welcher Grund. Ein scharfer Lauf, der nur eine Notice hinterlässt,
 * lässt genau dann im Dunkeln, wenn etwas schiefging.
 */
export class SyncErgebnisModal extends Modal {
	constructor(
		app: App,
		private readonly ergebnis: SyncErgebnis,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		const { plan, ausgefuehrt, fehler } = this.ergebnis;
		contentEl.empty();

		contentEl.createEl("h2", {
			text: `${ausgefuehrt ? "Sync" : "Probelauf"} — Gruppe ${plan.gruppe}`,
		});
		contentEl.createEl("p", { text: planZusammenfassung(plan) });

		if (fehler.length > 0) {
			contentEl.createEl("h3", { text: `${fehler.length} Fehler`, cls: "ups-status-error" });
			const fehlerliste = contentEl.createEl("ul");
			for (const eintrag of fehler) {
				fehlerliste.createEl("li", { text: eintrag, cls: "ups-status-error" });
			}
		}

		const zuTun = plan.ops.filter((op) => op.art !== "unveraendert");
		if (zuTun.length === 0) {
			contentEl.createEl("p", {
				text: "Keine Änderungen. Wenn du Dateien erwartet hättest: Stimmen Ordner und group_id in den Einstellungen?",
			});
			return;
		}

		const liste = contentEl.createEl("ul");
		for (const op of zuTun) {
			const ziel = op.vonPfad ? `${op.vonPfad} → ${op.pfad}` : op.pfad;
			liste.createEl("li", {
				cls: "ups-dryrun-op",
				text: `${op.art.toUpperCase()}  ${ziel}${op.grund ? `  (${op.grund})` : ""}`,
			});
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
