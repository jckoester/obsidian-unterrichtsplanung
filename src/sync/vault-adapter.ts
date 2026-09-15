/**
 * Die zweite Naht: Alles, was der Sync mit Dateien tut, geht durch dieses Interface.
 * Damit ist die Materialisierung in vitest prüfbar, ohne Obsidian zu starten.
 */

export interface VaultFile {
	path: string;
	content: string;
}

export interface VaultAdapter {
	list(folder: string): Promise<string[]>;
	read(path: string): Promise<string>;
	exists(path: string): Promise<boolean>;
	write(path: string, content: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	ensureFolder(path: string): Promise<void>;
}

/** Testdoppel — und zugleich die Referenz dafür, was ein Adapter können muss. */
export class InMemoryVaultAdapter implements VaultAdapter {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();

	constructor(initial: VaultFile[] = []) {
		for (const file of initial) this.files.set(file.path, file.content);
	}

	async list(folder: string): Promise<string[]> {
		const prefix = folder.endsWith("/") ? folder : `${folder}/`;
		return [...this.files.keys()].filter((p) => p.startsWith(prefix)).sort();
	}

	async read(path: string): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`Datei fehlt: ${path}`);
		return content;
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}

	async write(path: string, content: string): Promise<void> {
		this.files.set(path, content);
	}

	async rename(from: string, to: string): Promise<void> {
		const content = await this.read(from);
		// So streng wie Obsidian: `renameFile` wirft, wenn das Ziel belegt ist. Ein
		// nachsichtiges Testdoppel hat genau das lange verdeckt — im Speicher überschrieb
		// die Umbenennung still, was im Vault ein Fehler gewesen wäre.
		if (this.files.has(to)) throw new Error(`Zielpfad ist belegt: ${to}`);
		this.files.delete(from);
		this.files.set(to, content);
	}

	async ensureFolder(path: string): Promise<void> {
		this.folders.add(path);
	}
}
