import { normalizePath, type App, TFile, TFolder } from "obsidian";
import type { VaultAdapter } from "./vault-adapter";

/** Der echte Adapter. Enthält bewusst keine Sync-Logik — nur Dateizugriff. */
export class ObsidianVaultAdapter implements VaultAdapter {
	constructor(private readonly app: App) {}

	async list(folder: string): Promise<string[]> {
		const prefix = normalizePath(folder);
		return this.app.vault
			.getMarkdownFiles()
			.map((f) => f.path)
			.filter((p) => p.startsWith(`${prefix}/`))
			.sort();
	}

	async read(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) throw new Error(`Datei fehlt: ${path}`);
		return this.app.vault.read(file);
	}

	async exists(path: string): Promise<boolean> {
		return this.app.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFile;
	}

	async write(path: string, content: string): Promise<void> {
		const normalized = normalizePath(path);
		await this.ensureFolder(normalized.split("/").slice(0, -1).join("/"));
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
		} else {
			await this.app.vault.create(normalized, content);
		}
	}

	async rename(from: string, to: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(from));
		if (!(file instanceof TFile)) throw new Error(`Datei fehlt: ${from}`);
		await this.ensureFolder(normalizePath(to).split("/").slice(0, -1).join("/"));
		await this.app.fileManager.renameFile(file, normalizePath(to));
	}

	async ensureFolder(path: string): Promise<void> {
		if (!path) return;
		const normalized = normalizePath(path);
		if (this.app.vault.getAbstractFileByPath(normalized) instanceof TFolder) return;
		// Zwischenebenen mit anlegen; `createFolder` wirft, wenn es den Ordner schon gibt.
		const parts = normalized.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (this.app.vault.getAbstractFileByPath(current) instanceof TFolder) continue;
			try {
				await this.app.vault.createFolder(current);
			} catch {
				// Rennen mit einem anderen Schreiber — der Ordner ist dann da.
			}
		}
	}
}
