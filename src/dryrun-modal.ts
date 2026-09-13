import { App, Modal } from "obsidian";
import type { SyncPlan } from "./sync/plan";
import { planZusammenfassung } from "./sync/plan";

export class DryRunModal extends Modal {
	constructor(
		app: App,
		private readonly plan: SyncPlan,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: `Probelauf — Gruppe ${this.plan.gruppe}` });
		contentEl.createEl("p", { text: planZusammenfassung(this.plan) });

		const liste = contentEl.createEl("ul");
		for (const op of this.plan.ops) {
			if (op.art === "unveraendert") continue;
			const eintrag = liste.createEl("li", { cls: "ups-dryrun-op" });
			const ziel = op.vonPfad ? `${op.vonPfad} → ${op.pfad}` : op.pfad;
			eintrag.setText(`${op.art.toUpperCase()}  ${ziel}${op.grund ? `  (${op.grund})` : ""}`);
		}
		if (liste.childElementCount === 0) {
			contentEl.createEl("p", { text: "Keine Änderungen." });
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
