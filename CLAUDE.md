# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General Rules

1. Ask, don't assume. If something is unclear, ask before writing a single line. Never make silent assumptions about intent, architecture, or requirements. When running unattended, pick the most reasonable interpretation, proceed, and record the assumption rather than blocking.

2. Implement the simplest solution for simple problems, better solutions for harder problems. Do not over-engineer or add flexibility that isn't needed yet.

3. Don't touch unrelated code but please do surface bad code or design smells you discover with me so we can address them as a separate issue.

4. Flag uncertainty explicitly. If you're unsure about something, see point 1 above. If it makes sense to do so, conduct a small, localised and low-risk experiment and bring the hypothesis and results to me to discuss. Confidence without certainty causes more damage than admitting a gap.

5. I'm always open to ideas on better ways to do things. Please don't hesitate to suggest a better way, or one that has long lasting impact over a tactical change.

## Project Overview

Obsidian-Plugin, das die Unterrichtsplanung aus der **GGD-KI-Plattform** (`~/Documents/1 Projekte/GGD-KI-Plattform`) als Notizen in Jans PKM-Vault spiegelt und definierte Felder zurückschreibt. Es ist ein **reiner Sync-Client**: Slot-Generierung, Ferienlogik und KI-Planungstools bleiben auf der Plattform. Es löst das alte Skript `Unterrichtsplanung.py` ab.

Plan und Projektstand liegen im Vault unter `PKM/Projekte/Unterrichtsplanung-Sync/`:
`Plan-Plugin-Implementierung.md` (Stufenplan), `Plan-Backend-Änderungen.md` (Plattformseite),
`Unterrichtsplanung-Sync.md` (Projektnotiz). **Vor Arbeit an einer neuen Stufe zuerst dort lesen und danach fortschreiben.**

### Stand

- **Stufe 1 (Pull-Spiegel) fertig und im Alltag getestet**: Lehrauftrags-, UE- und Stundennotizen, Probelauf, Archivieren, Konfliktblöcke.
- **Stufe 2 (Rückkanal)** ist das nächste Arbeitspaket: `PATCH /planning/slots/{id}` für `kategorie`, `thema`, `note` und `PATCH /planning/lessons/{id}` für `titel`, `stundenziel`. Der Schreibpfad ist im API-Client bereits vorhanden, aber unbenutzt.
- Stufen 3 (Phasen-Roundtrip) und 4 (Kontextspeicher-Breite) sind noch nicht angefangen.

## Commands

```bash
npm install                  # NUR auf dem Mac — siehe Fallstricke
npm run dev                  # esbuild watch → main.js (Testvault lädt per hot-reload neu)
npm run build                # tsc --noEmit + Produktionsbundle
npm test                     # vitest gegen Fixtures — ohne Obsidian, ohne Server, ohne Token
npm run typecheck            # tsc --noEmit allein

bash scripts/seed-testvault.sh   # Testvault aus dem PKM-Vault befüllen (read-only Kopie)
bash scripts/link-testvault.sh   # Symlink ins Plugin-Verzeichnis + .hotreload
```

Der Testvault liegt unter `~/Documents/1 Projekte/Testvault-Unterricht` und bindet dieses Repo per Symlink als `.obsidian/plugins/unterrichtsplanung-sync` ein.

## Fallstricke

**`npm install` gehört auf den Mac.** esbuild ist ein natives Binary. Eine Installation aus einer Linux-Umgebung heraus (etwa Claudes `device_bash`, das auf dieselbe Platte schreibt) legt `@esbuild/linux-arm64` ab, und `npm run dev` bricht mit „You installed esbuild for another platform" ab. Heilung: `rm -rf node_modules package-lock.json`, danach `npm install` im Terminal. Aus demselben Grund ist `package-lock.json` gitignored.

**`data.json` ist gitignored.** Obsidian schreibt die Plugin-Einstellungen in den Pluginordner — und der ist über den Symlink dieses Repo. Darin steht der Personal Access Token im Klartext.

**Der Produktivvault ist kein Entwicklungsort.** Dort steht `.obsidian/plugins` nicht in der `.gitignore` (der Gitdir liegt separat unter `~/Documents/.PKM.git`); obsidian-git würde `node_modules` und jeden Zwischenstand committen. Sobald das Plugin dort über BRAT installiert ist, gehört `.obsidian/plugins/unterrichtsplanung-sync/data.json` in die Vault-`.gitignore`.

**Das Scope-Gatter der Plattform ist Deny-by-default.** Siehe unten — ein neuer Endpunkt ist erst erreichbar, wenn sein Pfad dort steht.

## Benennung: `uplan` gegen `ggd`

Die Grenze ist nicht das Wort, sondern die Seite: **In Jans eigenen Notizen steht `uplan`, an der Schnittstelle zur Schulplattform steht `ggd`.**

- Frontmatter-Felder und Marker in Vault-Notizen: `uplan_node_id`, `uplan_hash`, `<!-- uplan:ende -->` — `ggd` ist das Schulkürzel und hat im Eigenschaften-Panel einer privaten Notiz nichts zu suchen.
- Unverändert bleiben `ggd_pat_` (Token-Präfix der Plattform) und die Klasse `GgdApiClient`. Sie sprechen mit dem Schulsystem; da ist das Kürzel richtig.

Bei einem neuen Bezeichner zuerst klären, auf welcher Seite der Grenze er liegt.

## Werkzeug-Fallstrick: kein `perl -pi` im Repo

Textersetzungen über mehrere Dateien mit einem Python-Skript machen, das liest und mit `write_text()` zurückschreibt — nicht mit `perl -pi` oder `sed -i`.

In-place-Bearbeitung benennt die Originaldatei um und legt eine neue an. Liegt das Repo auf einem FUSE-Mount (so erreicht Claude in Cowork die Platte), bleibt die alte Inode als `.fuse_hidden…` zurück. Bei sieben Feldern über mehrere Dateien waren das 175 verwaiste Dateien, die zusätzlich jede folgende `grep -r`-Zählung verfälscht haben.

Kontrolle danach: `find . -name '.fuse_hidden*' -not -path './node_modules/*' | wc -l`

## Architektur

Zwei Nähte halten die Sync-Logik von Obsidian und vom Netz fern:

| Naht | Produktiv | Test |
| --- | --- | --- |
| `HttpClient` (`src/api/http.ts`) | `RequestUrlHttpClient` — Obsidians `requestUrl`, kein CORS | `FixtureHttpClient` — `fixtures/*.json`, adressiert als `METHOD /pfad` |
| `VaultAdapter` (`src/sync/vault-adapter.ts`) | `ObsidianVaultAdapter` | `InMemoryVaultAdapter` |

Dazwischen liegt **`materialize()` (`src/sync/materialize.ts`) — eine reine Funktion**: Serverstand plus vorhandene Notizen rein, Liste von Dateioperationen (`SyncOp[]`) raus. Kein Vault-Zugriff, kein Netz, keine Uhr. Deshalb ist der Probelauf kein Sonderpfad, sondern derselbe Plan, nur nicht ausgeführt — und deshalb sind alle Sync-Zusagen ohne laufendes Obsidian prüfbar.

**Die Reihenfolge im Plan ist Teil des Plans.** Der Dateiname trägt eine laufende Nummer, und die ist eine Position, keine Identität: Kommt vorne eine Stunde dazu, rutschen alle folgenden. `materialize()` sortiert Umbenennungen und Neuanlagen deshalb so, dass jedes Ziel frei ist, wenn es an der Reihe ist (Ringtausch über einen Zwischennamen); `runner.ts` weigert sich zusätzlich, auf einen belegten Pfad zu schreiben oder umzubenennen. Beides zusammen hält Zusage 1 — die Sortierung, damit der Sync durchläuft, der Wächter, damit im Zweifel ein Fehler im Ergebnisfenster steht statt einer Notiz weniger im Vault.

**Diese Reinheit ist die wichtigste Eigenschaft des Codes.** Wer in `materialize()` etwas einbaut, das liest, schreibt, die Zeit abfragt oder zufällig ist, nimmt dem Projekt seine Testbarkeit. Was Ein-/Ausgabe braucht, gehört in `src/sync/runner.ts`.

```
src/
  main.ts              Plugin-Einstieg, Befehle, Statusleiste, Intervall
  settings.ts          UpsSettings + Vorgabewerte
  settings-tab.ts      Einstellungsoberfläche, Verbindungstest, Fehlerdeutung
  dryrun-modal.ts      SyncErgebnisModal (Probelauf UND scharfer Lauf)
  api/
    types.ts           Handgeführte Teilmenge von backend/app/planning/schemas.py
    http.ts            HttpClient, HttpError, beide Implementierungen
    client.ts          GgdApiClient — die ~10 benutzten Endpoints
  sync/
    materialize.ts     REIN: Plan bauen
    notizen.ts         Notizformate (Lehrauftrag, UE), Slug, Datum
    frontmatter.ts     Lesen tolerant, Schreiben streng; Marker-Abschnitt
    status.ts          kategorie ↔ UStatus — die einzige Stelle
    hash.ts            FNV-1a 64 Bit, stabile JSON-Darstellung
    plan.ts            SyncOp, SyncPlan, Zusammenfassung
    runner.ts          UNREIN: holen, planen, ausführen
    vault-adapter.ts   Interface + InMemory
    obsidian-vault.ts  Obsidian-Implementierung
```

### Sync-Zustand

Im Frontmatter jeder Notiz, kein separater Store:

| Feld | Bedeutung |
| --- | --- |
| `uplan_slot_id` | Anker der Stundennotiz |
| `uplan_node_id` | Stundenknoten (Stunde) bzw. Anker (UE) |
| `uplan_group_id` | Gruppe der Plattform |
| `uplan_updated_at` | Serverstand beim letzten Sync — billige Vorprüfung |
| `uplan_server_hash` | Hash der zuletzt empfangenen Serverfassung → Server-Dirty |
| `uplan_hash` | Hash des zuletzt geschriebenen Inhalts → Vault-Dirty |
| `uplan_status` | `aktiv` / `archiviert` |

`uplan_hash` wird über den Inhalt **ohne die `uplan_hash`-Zeile** gebildet, sonst hinge der Hash von sich selbst ab (`hashNotizInhalt`).

**Der Hash entscheidet, nicht der Zeitstempel.** `updated_at` bewegt sich auf der Plattform nur bei `PATCH /planning/slots/{id}` und `PATCH /planning/lessons/{id}`; über den Kontextweg bleibt er stehen. Ein stehender Zeitstempel beweist nichts. Er darf die Prüfung abkürzen (gleich → sicher unverändert), aber nie entscheiden.

**Warum der Slot ankert und nicht der Stundenknoten:** Ein Slot existiert ab der Slot-Generierung, `stunde_node_id` erst, wenn jemand einen Entwurf anlegt. Am Knoten verankert bekäme jede leere Stunde beim ersten Entwurf einen neuen Anker — und damit ein Duplikat statt einer Aktualisierung. Das weicht bewusst vom Plan ab, der `uplan_node_id` nennt; beide Felder stehen in der Notiz.

### Zusagen an den Vault

Diese vier gelten ohne Ausnahme. Wer eine davon aufweicht, ändert den Charakter des Werkzeugs:

1. **Es wird nie gelöscht.** Verschwundenes bekommt `uplan_status: archiviert` — Stunden wie Einheiten. Die Plattform löscht hart, ohne Grabstein; die Übersicht liefert ohnehin nur Knoten mit `status = active`, und der Lifecycle-Dienst archiviert von selbst. Verschwundenes ist deshalb nur am Abgleich der Vollmenge erkennbar, nicht über ein Delta. Eine archivierte **Stundennotiz** wird dabei umbenannt (`… Stunde 7 (archiviert 2026-10-13)`): Die laufende Nummer im Namen gehört den aktiven Stunden, und die nachrückende will sie haben. Eine archivierte **UE-Notiz** bleibt, wo sie ist — in ihrem Ordner liegt das Material.
2. **Alles ab `## Eigene Notizen` gehört dem Vault** und wird in Stundennotizen nie überschrieben.
3. **UE-Notizen werden einmal angelegt, danach nur im Frontmatter gepflegt.** Der Rumpf gehört dem Vault, auch ohne Marker. Der UE-Ordner ist zugleich die Materialsammlung und wird bei Umbenennung auf der Plattform **nicht** mitgezogen — das wäre ein Nebeneffekt zu viel für einen Sync-Lauf.
4. **Die Lehrauftragsnotiz wird nur angelegt, nie angefasst**, wenn sie schon existiert.

Bei beidseitiger Änderung gewinnt die Plattform; die Vault-Fassung wandert als Block in dieselbe Notiz.

### Vault-Konventionen

Das Notizformat folgt dem Bestand, nicht eigenem Geschmack — Bases und Dataview-Queries im Vault hängen daran.

- **Stundennotiz:** `Kategorien: [[UStunden]]`, `Lehrauftrag`, `UEinheit`, `Datum`, `UStatus` (Emoji-Liste), `Inhalte`, `UStunden` (Doppelstunde = 2), journal-header-Callout, Meta-Bind-`inlineSelect` für `UStatus`.
- **UE-Notiz:** `NwT 9/UE1 - Titel/UE1 - Titel.md` (Ordnernotiz; der Ordner ist die Materialsammlung), `Kategorien: [[UEinheiten]]`, `Stunden` = Zahl der zugewiesenen Slots.
- **Lehrauftragsnotiz:** `NwT 9/NwT 9.md`, Rumpf aus `System/Templates/Unterricht/Lehrauftrag-Template.md` — diese Vorlage enthält keine Templater-Syntax und ist deshalb direkt verwendbar. `UEinheit-Template.md` dagegen rechnet in Templater-Blöcken und verschiebt sich selbst; ihr Ergebnis baut `notizen.ts` nach.
- **`kategorie` ↔ `UStatus` ist nicht bijektiv** (5 ↔ 7 Werte). `unterricht` fächert über `hat_phasen` und `nachbereitet_at` in Platzhalter/vorbereitet/gehalten auf; `vertretung` hat im Vault kein Gegenstück und landet auf „⚫️ Platzhalter" — es steht deshalb **nicht** in `VAULT_ZU_KATEGORIE`, damit der Rückkanal daraus nie `unterricht` macht. Die Abbildung steht allein in `src/sync/status.ts`.
- **Fach und Stufe kommen aus den Einstellungen, nicht von der Plattform.** Im Vault steht mal `[[Chemie]]`, mal `Chemie`, mal `CH` — das ist Vault-Konvention. Die Stufe lässt sich über `GET /planning/groups/{id}/curriculum-chapters` (`grade`) vorbefüllen.
- **Der Lehrauftragsname wird aus dem Ordnernamen abgeleitet** (`lehrauftragName()`); das Einstellungsfeld ist nur ein Überschreibwert.

## Die Plattform-API

Basis-URL enthält `/api` (das Präfix hängt der Reverse-Proxy davor, FastAPI bedient `/planning` und `/groups`). Auth per Bearer-Token (`ggd_pat_…`), erzeugt im Profil der Plattform.

**Das Scope-Gatter (`backend/app/auth/scopes.py`) ist Deny-by-default.** Erreichbar sind nur:

```
/planning        planning:read | planning:write
/context/nodes   context:read  | context:write
/context/edges   context:read  | context:write
/context/search  context:read  (auch als POST — die Suche braucht einen Rumpf)
/groups/me       planning:read | planning:write
```

Alles andere gibt 403 „Dieser Bereich ist für Zugangstoken gesperrt", auch `/tokens/scopes` und der übrige `/groups`-Router. Schreiben impliziert Lesen **nicht**. Wer einen neuen Endpunkt benutzen will, ergänzt zuerst eine Zeile in `_ZUSTAENDIG` und zieht `backend/tests/unit/test_token_scopes.py` nach — so eng wie der Zweck, nicht so weit wie der Router.

Tatsächlich benutzt: `GET /groups/me` (Verbindungstest), `GET /planning/groups/{id}/overview` (der ganze Sync — Slots **und** Einheiten kommen daraus), `GET /planning/groups/{id}/curriculum-chapters` (Jahrgang vorbefüllen).

Im Client vorhanden, aber ungenutzt: `GET /planning/groups/{id}/units` (die Übersicht liefert sie schon mit), `GET /planning/lessons/{id}` und `…/export` sowie beide `PATCH`-Wege. Das Stundenziel hängt am Stundenknoten und bleibt deshalb bis Stufe 2 leer — es einzeln nachzuladen hieße 40 bis 120 Anfragen pro Lauf gegen eine gedrosselte API, und der Rückkanal muss das Feld ohnehin anfassen.

**Snapshots muss das Plugin nicht selbst anlegen.** `PATCH /planning/lessons/{id}` legt bei jedem Schreibzugriff einen an, `PATCH /planning/slots/{id}` bei Änderungen an `ue_node_id`, `stunde_node_id`, `thema` oder `kategorie` — also genau bei den Feldern aus Stufe 2.

**`expected_updated_at`** gibt es auf `SlotUpdate` und `LessonUpdate`: Stimmt der mitgeschickte Stand nicht mehr, antwortet die Plattform mit 409 statt still zu überschreiben. Für Stufe 2 mitschicken — aber im Bewusstsein, dass ein stehender Zeitstempel die Precondition wirkungslos macht.

**Tests der Plattform laufen aus `backend/` heraus:** `cd backend && ./venv/bin/pytest tests/unit -v`. Aus der Repo-Wurzel findet `config.py` (`env_file="../.env"`) die `.env` nicht und bricht mit „Field required" ab — das sieht nach fehlender Konfiguration aus, ist aber das falsche Arbeitsverzeichnis.

## Tests

`npm test` läuft ohne Obsidian, ohne Server und ohne Token — über `FixtureHttpClient` und `InMemoryVaultAdapter`. Neue Sync-Logik gehört in `materialize()` und wird dort geprüft, nicht über die Oberfläche.

Geprüft werden **Zusagen, nicht Zeilen**: Idempotenz (zweiter Lauf ändert nichts), Server-Änderung, beidseitiger Konflikt, Erhalt des vault-eigenen Abschnitts, Archivieren statt Löschen, Umbenennen statt Duplizieren, unangetasteter UE-Rumpf — und die Ausführung des Plans: eine vorne eingefügte Stunde verliert keine Notiz, ein Ringtausch der Namen löst sich auf, eine vault-eigene Datei auf dem Zielpfad wird gemeldet statt überschrieben.

Das `InMemoryVaultAdapter` ist dabei **so streng wie Obsidian**: Umbenennen auf einen belegten Pfad wirft. Ein nachsichtiges Testdoppel hat genau diesen Fehler einmal lange verdeckt.

Tests wählen Operationen **über Pfade, nicht über Positionen im Plan** — der Plan wächst, sobald ein Notiztyp dazukommt.

Fixtures (`fixtures/*.json`) sind Testdaten; **keine echten Schüler:innendaten aufnehmen**.

## Stil

- Code und Kommentare auf Deutsch, passend zur Plattform. Bezeichner wie `materialize`, `HttpClient`, `SyncOp` bleiben englisch.
- Kommentare erklären **warum**, nicht was — besonders dort, wo eine naheliegende Lösung verworfen wurde. Der Bestand ist so geschrieben; bitte fortführen.
- Tabs, nicht Leerzeichen (`.editorconfig`).
- Commit-Botschaften: erste Zeile sagt, was sich ändert, der Rumpf warum. Deutsch.
