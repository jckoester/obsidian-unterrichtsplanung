import type { SlotKategorie } from "../api/types";

/**
 * Die einzige Stelle, an der Plattform-Vokabular und Vault-Vokabular aufeinandertreffen.
 *
 * Früher gab es dafür ein Feld, `UStatus`, mit sieben Werten. Die meinten zwei
 * unabhängige Dinge — welche Art Termin das ist und wie weit seine Vorbereitung gediehen
 * ist —, und die Abbildung von den fünf Kategorien der Plattform war nicht umkehrbar:
 * `vertretung` hatte kein Gegenstück, und ein Häkchen bei „vorbereitet" hätte im
 * Rückkanal einen Slot umwidmen können.
 *
 * Jetzt zwei Felder, beide gehören der Plattform und sind im Vault read-only:
 *
 * - `UArt` — die Kategorie des Slots, 1:1.
 * - `UStand` — der Bearbeitungsstand, abgeleitet aus dem, was die Übersicht ohnehin liefert.
 *
 * Einen Rückkanal für den Status gibt es damit nicht mehr; der Vault besitzt ihn nicht.
 */

const UART: Record<SlotKategorie, string> = {
	unterricht: "Unterricht",
	ausfall: "Entfall",
	pruefung: "Prüfung",
	puffer: "Puffer",
	vertretung: "Vertretung",
};

/**
 * Eine Kategorie, die die Plattform neu einführt, erscheint mit ihrem Rohwert — nicht als
 * „Unterricht". Ein still falsch einsortierter Termin fiele in keiner Base auf.
 */
export function kategorieZuUArt(kategorie: string): string {
	return UART[kategorie as SlotKategorie] ?? kategorie;
}

/**
 * `Skizze` (Phasen ohne Dauer) fehlt noch: Dafür braucht es die Phasen selbst (AP6) und
 * eine Plattform, die eine Phase ohne Dauer annimmt (AP4). Bis dahin gibt es drei Stufen.
 */
export type UStand = "Platzhalter" | "Geplant" | "Gehalten";

export interface SlotStandInput {
	hat_phasen: boolean;
	nachbereitet_at: string | null;
}

/** Nachbereitet schlägt geplant: Eine gehaltene Stunde hatte auch einen Plan. */
export function slotZuUStand(slot: SlotStandInput): UStand {
	if (slot.nachbereitet_at) return "Gehalten";
	if (slot.hat_phasen) return "Geplant";
	return "Platzhalter";
}
