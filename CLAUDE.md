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
`Plan-Notizformat.md` (**Fahrplan für Stufe 2**: Arbeitspakete AP0–AP6 mit Tests),
`Plan-Plugin-Implementierung.md` (Stufenplan, Architektur), `Plan-Backend-Änderungen.md` (Plattformseite),
`Unterrichtsplanung-Sync.md` (Projektnotiz), `todo.md` (Vertagtes). **Vor Arbeit an einem neuen Arbeitspaket zuerst dort lesen und danach fortschreiben.**

### Stand

- **Stufe 1 (Pull-Spiegel) fertig und im Alltag getestet**: Lehrauftrags-, UE- und Stundennotizen, Probelauf, Archivieren, Konfliktblöcke.
- **Stufe 2 folgt `Plan-Notizformat.md`** (bestätigt am 03.10.2026), nicht mehr dem älteren Rückkanal für `kategorie`/`thema`/`note`. Reihenfolge: AP0 (Reste der `ggd_`-Umbenennung) und AP1 (Hash-Regionen) → AP3 + AP2 zusammen (`UArt`/`UStand`, Anker am Stundenknoten, Dateiname aus dem Datum) → AP6 (Stundenknoten gesammelt laden) → AP5 (`## Ablauf` lesen und schreiben, der erste Rückkanal). AP4 (optionale Phasendauer) ist Plattformarbeit und läuft unabhängig.
- **AP0 bis AP3 sind erledigt** (03.10.2026). Die Umbenennung ist vollständig, und `<!-- uplan:ende -->` begrenzt Hash und Vault-Teil. Stundennotizen tragen `UArt`/`UStand` statt `UStatus`, heißen nach ihrem Datum und ankern am Stundenknoten. Als Nächstes kommt AP6.
- Der Schreibpfad (`patchSlot`, `patchLesson`) ist im API-Client vorhanden, aber unbenutzt. Stufe 4 (Kontextspeicher-Breite) ist nicht angefangen.

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

**Die Reihenfolge im Plan ist Teil des Plans.** Dateinamen wandern: Ein Swap tauscht zwei Namen, eine verschobene Stunde zieht auf den Namen einer archivierten, ein zweiter Termin am selben Tag benennt den ersten um. (Bis AP2 trug der Name eine laufende Nummer, und jede vorne eingefügte Stunde verschob alle folgenden.) `materialize()` sortiert Umbenennungen und Neuanlagen deshalb so, dass jedes Ziel frei ist, wenn es an der Reihe ist (Ringtausch über einen Zwischennamen); `runner.ts` weigert sich zusätzlich, auf einen belegten Pfad zu schreiben oder umzubenennen. Beides zusammen hält Zusage 1 — die Sortierung, damit der Sync durchläuft, der Wächter, damit im Zweifel ein Fehler im Ergebnisfenster steht statt einer Notiz weniger im Vault.

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
    status.ts          kategorie → UArt, Slot → UStand — die einzige Stelle
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
| `uplan_slot_id` | Slot der Stundennotiz — Anker, solange es keinen Stundenknoten gibt; kennzeichnet zugleich jede Stundennotiz |
| `uplan_node_id` | Stundenknoten (führender Anker der Stundennotiz) bzw. Anker der UE |
| `uplan_group_id` | Gruppe der Plattform |
| `uplan_updated_at` | Serverstand beim letzten Sync — billige Vorprüfung |
| `uplan_server_hash` | Hash der zuletzt empfangenen Serverfassung → Server-Dirty |
| `uplan_hash` | Hash der zuletzt geschriebenen Plattform-Region → Vault-Dirty |
| `uplan_status` | `aktiv` / `archiviert` |

`uplan_hash` wird nur über die **Plattform-Region** gebildet — Frontmatter und Rumpf bis vor `<!-- uplan:ende -->` — und dort **ohne die `uplan_hash`-Zeile**, sonst hinge der Hash von sich selbst ab (`hashPlattformRegion`). Was hinter dem Marker steht, gehört dem Vault und ist für den Abgleich keine Änderung. Fehlt der Marker (Altbestand), ist die Region die ganze Datei und der Hash bitgleich mit dem von vorher; der Test `alsAltbestand` hält diesen Vertrag fest.

**Der Hash entscheidet, nicht der Zeitstempel.** Seit Plattform 0.10 schreibt `onupdate` den Stempel fort, aber mit Lücken: Er steht still bei reinen Alias-Änderungen, bei einem bloßen Kapitelwechsel einer Einheit und bei rohem SQL. Ein stehender Zeitstempel beweist deshalb nichts. Er darf die Prüfung abkürzen (gleich → sicher unverändert), aber nie entscheiden.

**Anker: erst der Stundenknoten, dann der Slot** (`ordneNotizenZu`, Plan-Notizformat Entscheidung 2). Der Swap der Plattform tauscht Stundenknoten zwischen Slots, die ihr Datum behalten — am Slot verankert bliebe die Vorbereitung beim falschen Termin. Deshalb holt sich zuerst jeder Knoten seine Notiz, wo immer sie liegt; danach bekommen die übrigen Slots ihre Termin-Notiz über `uplan_slot_id`. Nur über den Knoten ginge es nicht: Ein Slot existiert ab der Slot-Generierung, `stunde_node_id` erst mit dem ersten Entwurf — die Platzhalter-Notiz übernimmt dann den Knoten, statt ein Duplikat zu bekommen. Eine Notiz, deren Knoten noch im Plan steht, wird nie über ihr (veraltetes) Slot-Feld vergeben.

**Grenze dieser Regel:** Platzhalter hängen an der Slot-ID. `POST …/slots/generate` mit `regenerate=True` löscht die Muster-Slots eines Halbjahrs und legt sie neu an — Notizen mit Knoten folgen ihrem Knoten, Platzhalter werden archiviert und neu angelegt.

**Die Formatversion steht im Server-Hash** (`NOTIZFORMAT`). Wer `baueStundennotiz` ändert, zählt sie hoch — sonst bekämen nur die Notizen das neue Format, deren Termin sich gerade zufällig geändert hat.

### Zusagen an den Vault

Diese vier gelten ohne Ausnahme. Wer eine davon aufweicht, ändert den Charakter des Werkzeugs:

1. **Es wird nie gelöscht.** Verschwundenes bekommt `uplan_status: archiviert` — Stunden wie Einheiten. Die Plattform löscht hart, ohne Grabstein; die Übersicht liefert ohnehin nur Knoten mit `status = active`, und der Lifecycle-Dienst archiviert von selbst. Verschwundenes ist deshalb nur am Abgleich der Vollmenge erkennbar, nicht über ein Delta. Eine archivierte **Stundennotiz** wird dabei umbenannt — `… 2026-10-13 (archiviert).md`, wenn ihr Slot verschwunden ist, `… (ersetzt).md`, wenn eine herübergewanderte Stunde ihren Termin übernommen hat; ist der Name vergeben, wird gezählt. Der Name gehört den aktiven Terminen, und ein Slot desselben Tages will ihn haben. Kehrt ihr Slot zurück, lebt sie wieder auf. Eine archivierte **UE-Notiz** bleibt, wo sie ist — in ihrem Ordner liegt das Material.
2. **Alles hinter `<!-- uplan:ende -->` gehört dem Vault** und wird in Stundennotizen nie überschrieben. Der Marker ist die Grenze für den Erhalt wie für den Hash — eine Grenze statt zwei (`REGION_ENDE` in `frontmatter.ts`). In Altbestand ohne Marker gilt noch `## Eigene Notizen`.
3. **UE-Notizen werden einmal angelegt, danach nur im Frontmatter gepflegt.** Der Rumpf gehört dem Vault, auch ohne Marker. Der UE-Ordner ist zugleich die Materialsammlung und wird bei Umbenennung auf der Plattform **nicht** mitgezogen — das wäre ein Nebeneffekt zu viel für einen Sync-Lauf.
4. **Die Lehrauftragsnotiz wird nur angelegt, nie angefasst**, wenn sie schon existiert.

Bei beidseitiger Änderung gewinnt die Plattform; die Vault-Fassung wandert als Block in dieselbe Notiz.

### Vault-Konventionen

Das Notizformat folgt dem Bestand, nicht eigenem Geschmack — Bases und Dataview-Queries im Vault hängen daran.

- **Stundennotiz:** `NwT 9/Unterrichtsstunden/NwT 9 2026-09-15.md` — bei zwei Terminen am selben Tag beide mit `(3. Std.)`. Frontmatter `Kategorien: [[UStunden]]`, `Lehrauftrag`, `UEinheit`, `Datum`, `UArt`, `UStand`, `Inhalte`, `UStunden` (Doppelstunde = 2). Rumpf: journal-header-Callout mit Datum und einer DataviewJS-Navigation (zur Anzeigezeit berechnet, der Sync schreibt keine Nachbarlinks), `## Hinweise` (nur mit `slot.note`), `## Ablauf`, Marker, `## Notizen`. Kein Meta-Bind-Feld — der Status gehört der Plattform.
- **UE-Notiz:** `NwT 9/UE1 - Titel/UE1 - Titel.md` (Ordnernotiz; der Ordner ist die Materialsammlung), `Kategorien: [[UEinheiten]]`, `Stunden` = Zahl der zugewiesenen Slots.
- **Lehrauftragsnotiz:** `NwT 9/NwT 9.md`, Rumpf aus `System/Templates/Unterricht/Lehrauftrag-Template.md` — diese Vorlage enthält keine Templater-Syntax und ist deshalb direkt verwendbar. `UEinheit-Template.md` dagegen rechnet in Templater-Blöcken und verschiebt sich selbst; ihr Ergebnis baut `notizen.ts` nach.
- **`UArt` und `UStand` statt `UStatus`.** `UArt` ist `kategorie` 1:1 (`Unterricht`, `Entfall`, `Prüfung`, `Puffer`, `Vertretung`; eine unbekannte Kategorie erscheint mit ihrem Rohwert). `UStand` ist abgeleitet: `Gehalten` (`nachbereitet_at`) vor `Geplant` (`hat_phasen`) vor `Platzhalter`; `Skizze` kommt mit AP4/AP6. Beide gehören der Plattform — es gibt keinen Status-Rückkanal. Die Abbildung steht allein in `src/sync/status.ts`. Das Archiv 2025/26 trägt weiter `UStatus`; `UStunden-Katalog.base` zeigt deshalb beide.
- **Archivierte Stundennotizen** (`uplan_status: archiviert`) blenden `Unterrichtsstunden.base`, `Unterricht-Cockpit.base` und die Statistik im Lehrauftrag-Template aus.
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

Im Client vorhanden, aber ungenutzt: `GET /planning/groups/{id}/units` (die Übersicht liefert sie schon mit), `GET /planning/lessons/{id}` und `…/export` sowie beide `PATCH`-Wege. Das Stundenziel hängt am Stundenknoten und fehlt deshalb noch. Einzeln nachladen ist der falsche Weg (40 bis 120 Anfragen pro Lauf gegen eine gedrosselte API): `GET /context/nodes?content_type=unterrichtsstunde&group_id={g}&limit=500` liefert Stundenziel, Phasen und `updated_at` aller Stunden einer Gruppe in einer Anfrage — braucht aber `context:read` im Token, und ob der Filter über `read_scope_group_id` wirklich alle Stunden trifft, ist ungeprüft (AP6).

**Snapshots muss das Plugin nicht selbst anlegen — und darf nicht verschwenderisch schreiben.** `PATCH /planning/lessons/{id}` legt bei **jedem** Aufruf einen an, `PATCH /planning/slots/{id}` bei Änderungen an `ue_node_id`, `stunde_node_id`, `thema` oder `kategorie`. Die Plattform hält nur 50 Snapshots je Gruppe; ein Lauf, der dreißig Stunden zurückschreibt, löscht die Undo-Historie. Nur wirklich vault-geänderte Stunden schreiben.

**`expected_updated_at`** gibt es auf `SlotUpdate` und `LessonUpdate`: Stimmt der mitgeschickte Stand nicht mehr, antwortet die Plattform mit 409 statt still zu überschreiben. Geprüft wird auf **exakte Gleichheit** — die Plattform hält Mikrosekunden, JavaScripts `Date` nur Millisekunden. Den Serverwert deshalb als Zeichenkette unverändert zurückschicken, nie über `Date`. Bei Stunden vergleicht die Plattform mit dem Stempel des **Stundenknotens**, nicht des Slots; die Übersicht liefert ihn nicht. `PATCH /planning/lessons/{id}` antwortet mit `{ok, updated_at}`, nicht mit einer `LessonRead`.

**Phasen nur über `/planning/lessons` schreiben.** `PATCH /context/nodes` validiert Phasen gegen `taxonomy.py:362`, das `titel` und `status` verlangt — der Planer schreibt `name` ohne `status`, also scheitert dort jede Planer-Stunde mit 422.

**Tests der Plattform laufen aus `backend/` heraus:** `cd backend && ./venv/bin/pytest tests/unit -v`. Aus der Repo-Wurzel findet `config.py` (`env_file="../.env"`) die `.env` nicht und bricht mit „Field required" ab — das sieht nach fehlender Konfiguration aus, ist aber das falsche Arbeitsverzeichnis.

## Tests

`npm test` läuft ohne Obsidian, ohne Server und ohne Token — über `FixtureHttpClient` und `InMemoryVaultAdapter`. Neue Sync-Logik gehört in `materialize()` und wird dort geprüft, nicht über die Oberfläche.

Geprüft werden **Zusagen, nicht Zeilen**: Idempotenz (zweiter Lauf ändert nichts), Server-Änderung, beidseitiger Konflikt, Erhalt des vault-eigenen Abschnitts — und dass eine Zeile darin kein Konflikt ist —, Altbestand ohne Marker hasht wie vorher, eine Stufe-1-Notiz wird einmal ins neue Format überführt, Archivieren statt Löschen, Umbenennen statt Duplizieren, unangetasteter UE-Rumpf; beim Anker: ein Swap lässt die Notizen mit ihren Stunden wandern, der erste Entwurf übernimmt den Platzhalter, ein verdrängter Platzhalter heißt „ersetzt" — und die Ausführung des Plans: eine vorne eingefügte Stunde verliert keine Notiz, ein Ringtausch der Namen löst sich auf, eine vault-eigene Datei auf dem Zielpfad wird gemeldet statt überschrieben, eine archivierte Notiz lebt wieder auf.

Das `InMemoryVaultAdapter` ist dabei **so streng wie Obsidian**: Umbenennen auf einen belegten Pfad wirft. Ein nachsichtiges Testdoppel hat genau diesen Fehler einmal lange verdeckt.

Tests wählen Operationen **über Pfade, nicht über Positionen im Plan** — der Plan wächst, sobald ein Notiztyp dazukommt.

Fixtures (`fixtures/*.json`) sind Testdaten; **keine echten Schüler:innendaten aufnehmen**.

## Stil

- Code und Kommentare auf Deutsch, passend zur Plattform. Bezeichner wie `materialize`, `HttpClient`, `SyncOp` bleiben englisch.
- Kommentare erklären **warum**, nicht was — besonders dort, wo eine naheliegende Lösung verworfen wurde. Der Bestand ist so geschrieben; bitte fortführen.
- Tabs, nicht Leerzeichen (`.editorconfig`).
- Commit-Botschaften: erste Zeile sagt, was sich ändert, der Rumpf warum. Deutsch.
