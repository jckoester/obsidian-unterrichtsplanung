/**
 * FNV-1a (64 bit) — deterministisch, synchron, ohne Abhängigkeit.
 *
 * Warum nicht SHA-256 über `crypto.subtle`: Das ist asynchron und in vitest wie in
 * Obsidian unterschiedlich verfügbar. Hier geht es nicht um Fälschungssicherheit,
 * sondern um „hat sich etwas geändert" — dafür genügt ein schneller Streuwert.
 */

const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

export function hash(input: string): string {
	let h = OFFSET;
	for (let i = 0; i < input.length; i++) {
		h ^= BigInt(input.charCodeAt(i));
		h = (h * PRIME) & MASK;
	}
	return h.toString(16).padStart(16, "0");
}

/**
 * Stabile JSON-Darstellung: Schlüssel sortiert, damit ein Hash nicht von der
 * Reihenfolge abhängt, in der FastAPI die Felder serialisiert hat.
 */
export function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
	return `{${entries.join(",")}}`;
}

export function hashObject(value: unknown): string {
	return hash(stableStringify(value));
}
