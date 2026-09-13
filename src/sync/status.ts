import type { SlotKategorie } from "../api/types";

/**
 * Die einzige Stelle, an der Plattform-Vokabular und Vault-Vokabular aufeinandertreffen.
 *
 * Der Vault kennt sieben `UStatus`-Werte (siehe das Meta-Bind-Auswahlfeld in den
 * Stundennotizen), die Plattform fünf `kategorie`-Werte. Die Abbildung ist deshalb
 * nicht bijektiv:
 *
 * - `unterricht` fächert im Vault nach Bearbeitungsstand auf — den liest das Plugin
 *   aus `hat_phasen` und `nachbereitet_at`, nicht aus der Kategorie.
 * - `vertretung` hat im Vault kein Gegenstück. Bis eine Option ergänzt ist, landet es
 *   auf „⚫️ Platzhalter"; der Rückkanal (Stufe 2) darf daraus **nie** `unterricht`
 *   machen — deshalb steht Vertretung nicht in `VAULT_ZU_KATEGORIE`.
 */

export const USTATUS = {
	platzhalter: "⚫️ Platzhalter",
	idee: "🟡 Idee",
	vorbereitet: "🟢 vorbereitet",
	gehalten: "✅ gehalten",
	puffer: "🔵 Puffer",
	pruefung: "🟣 Prüfung",
	entfall: "🔴 Entfall",
} as const;

export type UStatus = (typeof USTATUS)[keyof typeof USTATUS];

export interface SlotStatusInput {
	kategorie: SlotKategorie | string;
	hat_phasen: boolean;
	nachbereitet_at: string | null;
}

export function kategorieZuUStatus(slot: SlotStatusInput): UStatus {
	switch (slot.kategorie) {
		case "ausfall":
			return USTATUS.entfall;
		case "pruefung":
			return USTATUS.pruefung;
		case "puffer":
			return USTATUS.puffer;
		case "vertretung":
			return USTATUS.platzhalter;
		case "unterricht":
		default:
			if (slot.nachbereitet_at) return USTATUS.gehalten;
			if (slot.hat_phasen) return USTATUS.vorbereitet;
			return USTATUS.platzhalter;
	}
}

/**
 * Rückrichtung für Stufe 2. Bewusst unvollständig: Statuswerte, die im Vault nur den
 * Bearbeitungsstand meinen, ändern die Kategorie der Plattform nicht — sonst würde ein
 * Häkchen im Vault einen Slot umwidmen.
 */
export const VAULT_ZU_KATEGORIE: Partial<Record<UStatus, SlotKategorie>> = {
	[USTATUS.entfall]: "ausfall",
	[USTATUS.pruefung]: "pruefung",
	[USTATUS.puffer]: "puffer",
	[USTATUS.platzhalter]: "unterricht",
	[USTATUS.vorbereitet]: "unterricht",
	[USTATUS.gehalten]: "unterricht",
};
