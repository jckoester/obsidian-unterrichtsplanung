import { describe, expect, it } from "vitest";
import { hash, hashObject, stableStringify } from "../src/sync/hash";

describe("hash", () => {
	it("ist stabil", () => {
		expect(hash("abc")).toBe(hash("abc"));
		expect(hash("abc")).not.toBe(hash("abd"));
	});

	it("ignoriert die Schlüsselreihenfolge", () => {
		expect(hashObject({ a: 1, b: 2 })).toBe(hashObject({ b: 2, a: 1 }));
	});

	it("unterscheidet null von fehlend", () => {
		expect(stableStringify({ a: null })).not.toBe(stableStringify({}));
	});
});
