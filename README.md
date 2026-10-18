# Unterrichtsplanung-Sync

Obsidian-Plugin: spiegelt die Unterrichtsplanung der GGD-KI-Plattform als Notizen in den
Vault und schreibt definierte Felder zurück. Reiner Sync-Client — geplant wird auf der
Plattform. Ablösung von `Unterrichtsplanung.py`.

Plan und Stand: `PKM/Projekte/Unterrichtsplanung-Sync/`.

## Installation

Über [BRAT](https://github.com/TfTHacker/obsidian42-brat): „Add Beta plugin" mit
`jckoester/obsidian-unterrichtsplanung`. BRAT lädt `main.js`, `manifest.json` und
`styles.css` aus dem neuesten Release.

**Vorher** im Vault `.obsidian/plugins/unterrichtsplanung-sync/data.json` in die
`.gitignore` aufnehmen: Dort legt Obsidian die Einstellungen ab, samt Zugangstoken im
Klartext — ein Git-Plugin im Vault würde ihn sonst committen.

Voraussetzungen: Obsidian 1.13, GGD-KI-Plattform ab 0.13.1 (Kompetenzen und Fachbegriffe
der Stunde ab 0.17), ein Zugangstoken mit `planning:read`, `planning:write` und
`context:read` (im Profil der Plattform). In den Einstellungen Basis-URL (mit `/api`),
Token und Basisordner eintragen, dann die Gruppen holen (siehe unten). Der Probelauf ist
anfangs an — erst prüfen, was der Sync vorhat, dann scharf schalten.

## Release

Version in `manifest.json` und `package.json` setzen, in `versions.json` eintragen,
`RELEASE.md` schreiben, committen, dann einen Tag mit genau dieser Version (ohne „v")
pushen. Die Action unter `.github/workflows/release.yml` baut, testet und legt das
Release mit den drei Dateien an.

## Entwicklungsumgebung

Entwickelt wird **nicht** im Produktivvault, sondern hier im Repo; der Testvault bindet
es per Symlink ein.

```bash
npm install
bash scripts/seed-testvault.sh     # Testvault mit Bases/Templates/Cockpit befüllen
bash scripts/link-testvault.sh     # Symlink + .hotreload setzen
npm run dev                        # esbuild watch → main.js
```

Danach in Obsidian den Testvault öffnen, in den Einstellungen bei Community-Plugins
„Unterrichtsplanung-Sync" aktivieren, außerdem über BRAT `pjeby/hot-reload` installieren.
Ab dann lädt jeder esbuild-Durchlauf das Plugin neu.

```bash
npm test         # vitest gegen Fixtures — ohne Obsidian, ohne Server, ohne Token
npm run build    # tsc --noEmit + Produktionsbundle
```

### Drei Fallstricke

- **`npm install` gehört auf den Mac.** esbuild ist ein natives Binary; eine Installation
  aus einer Linux-Umgebung heraus (etwa Claudes `device_bash`, das auf dieselbe Platte
  schreibt) legt `@esbuild/linux-arm64` ab, und `npm run dev` bricht mit „You installed
  esbuild for another platform" ab. Heilung: `rm -rf node_modules package-lock.json`,
  danach `npm install` im eigenen Terminal.
- **`data.json` ist gitignored.** Obsidian schreibt die Plugin-Einstellungen in den
  Pluginordner — und der ist über den Symlink dieses Repo. Darin steht der Token.
- **Im Produktivvault steht `.obsidian/plugins` nicht in der `.gitignore`.** Sobald das
  Plugin dort über BRAT installiert ist, gehört
  `.obsidian/plugins/unterrichtsplanung-sync/data.json` in die Vault-`.gitignore`.

## Architektur

Zwei Nähte halten die Sync-Logik von Obsidian und Netz fern:

| Naht | Produktiv | Test |
| --- | --- | --- |
| `HttpClient` | `RequestUrlHttpClient` (Obsidians `requestUrl`, kein CORS) | `FixtureHttpClient` (`fixtures/*.json`) |
| `VaultAdapter` | `ObsidianVaultAdapter` | `InMemoryVaultAdapter` |

Dazwischen liegt `materialize()` — eine **reine** Funktion: Serverstand plus vorhandene
Notizen rein, Liste von Dateioperationen raus. Der Probelauf ist deshalb kein Sonderpfad,
sondern derselbe Plan, nur nicht ausgeführt.

### Sync-Zustand

Im Frontmatter jeder Notiz, kein separater Store:

| Feld | Bedeutung |
| --- | --- |
| `uplan_slot_id` | Slot der Stundennotiz — Anker, solange es keinen Entwurf gibt |
| `uplan_node_id` | Stundenknoten — führender Anker, sobald es einen Entwurf gibt |
| `uplan_group_id` | Gruppe der Plattform |
| `uplan_updated_at` | Serverstand beim letzten Sync (billige Vorprüfung) |
| `uplan_server_hash` | Hash der zuletzt empfangenen Serverfassung → Server-Dirty |
| `uplan_hash` | Hash der zuletzt geschriebenen Plattform-Region → Vault-Dirty |
| `uplan_status` | `aktiv` / `archiviert` |

**Erst der Knoten, dann der Slot:** Die Plattform kann Stunden zwischen Terminen
tauschen, die Termine behalten ihr Datum. Eine Notiz mit Entwurf folgt deshalb ihrem
Stundenknoten. Ein Termin ohne Entwurf hängt am Slot; bekommt er seinen ersten Entwurf,
übernimmt die vorhandene Notiz den Knoten, statt ein Duplikat zu bekommen.

Stundennotizen heißen nach ihrem Datum (`NwT 9 2026-09-15.md`), bei zwei Terminen am
selben Tag mit Anfangsstunde (`… (3. Std.)`). Status als `UArt` und `UStand`, beide
read-only.

### Zusagen an den Vault

- Es wird **nie** gelöscht. Verschwundenes bekommt `uplan_status: archiviert` und gibt
  seinen Namen frei (`… (archiviert).md`, `… (ersetzt).md`).
- Alles hinter `<!-- uplan:ende -->` gehört dem Vault, wird nie überschrieben und zählt
  nicht als Änderung. In älteren Notizen ohne diesen Marker ist `## Eigene Notizen` die
  Grenze.
- Bei beidseitiger Änderung gewinnt die Plattform; die Vault-Fassung landet als Block in
  derselben Notiz.

### Rückkanal

Zurück zur Plattform gehen `## Ablauf` (als Tabelle oder als schnelle Liste), das
Stundenziel und `Inhalte` (das Thema des Termins) — nur, wenn sich die Plattform seit dem letzten Lauf nicht geändert hat, und
nur ab Plattform 0.13.0 (`/health`). Der Text der Notiz bleibt danach, wie er ist. Was die
Plattform ablehnen würde, wird zurückgehalten und im Ergebnisfenster gemeldet; höchstens
zehn Stunden je Lauf.

## Gruppen einrichten

In den Einstellungen einen **Basisordner** wählen (z. B. `Bereiche/11 Unterricht`), dann
**„Gruppen von der Plattform holen"** (+). Das Plugin legt für jede eigene
Unterrichtsgruppe einen Eintrag an — Ordnername, Fach und Stufe vorbelegt; den Ordnernamen
prüfen. Was man nicht braucht, entfernen: Die Gruppe ist dann ausgeblendet und kommt beim
nächsten Holen nicht wieder, ihre Notizen bleiben. Setzt Plattform 0.13.1
(`GET /planning/groups`) und Obsidian 1.13 voraus.

Bis 0.13.0 ging das über `/groups/me`, wofür das Gatter (`backend/app/auth/scopes.py`)
eigens eine Zeile bekommen hatte. Das Plugin benutzt `/groups/me` nicht mehr: Es liefert
jede Mitgliedschaft — Klassen, Fachschaften — ohne Rolle und ohne Fachnamen.

## Stand gegen die Plattform (13.09.2026)

Stufe 0 des Backend-Plans ist **fertig** — anders als der Plan vom 12.09. annimmt:

- `backend/app/auth/tokens.py`: PAT mit Präfix `ggd_pat_`, SHA-256 gespeichert, Scopes
  `planning:read|write`, `context:read|write`, max. 365 Tage, nur `teacher`/`admin`.
- `backend/app/auth/dependencies.py`: Bearer-Zweig, Scope-Gatter vor dem Router,
  Drosselung je Token.
- `backend/app/api/tokens.py`: `GET|POST /tokens`, `DELETE /tokens/{id}`, `GET /tokens/scopes`.
- `UnitRead.updated_at` und `LessonRead.updated_at` existieren, `SlotUpdate` und
  `LessonUpdate` kennen `expected_updated_at`.

Der Hash-Vergleich bleibt trotzdem das Leitsignal — er kostet nichts und bleibt richtig,
auch wenn ein Zeitstempel einmal stehen bleibt.
