# Unterrichtsplanung-Sync

Obsidian-Plugin: spiegelt die Unterrichtsplanung der GGD-KI-Plattform als Notizen in den
Vault und schreibt definierte Felder zurück. Reiner Sync-Client — geplant wird auf der
Plattform. Ablösung von `Unterrichtsplanung.py`.

Plan und Stand: `PKM/Projekte/Unterrichtsplanung-Sync/`.

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
| `uplan_slot_id` | Anker der Stundennotiz |
| `uplan_node_id` | Stundenknoten, sobald es einen Entwurf gibt |
| `uplan_group_id` | Gruppe der Plattform |
| `uplan_updated_at` | Serverstand beim letzten Sync (billige Vorprüfung) |
| `uplan_server_hash` | Hash der zuletzt empfangenen Serverfassung → Server-Dirty |
| `uplan_hash` | Hash der zuletzt geschriebenen Plattform-Region → Vault-Dirty |
| `uplan_status` | `aktiv` / `archiviert` |

**Warum der Slot ankert und nicht der Knoten:** Ein Slot existiert ab der
Slot-Generierung, `stunde_node_id` erst, wenn jemand einen Entwurf anlegt. Am Knoten
verankert bekäme jede leere Stunde beim ersten Entwurf einen neuen Anker — und damit ein
Duplikat statt einer Aktualisierung. Das weicht vom Plan ab, der `uplan_node_id` als Anker
nennt; beide Felder stehen in der Notiz.

### Zusagen an den Vault

- Es wird **nie** gelöscht. Verschwundenes bekommt `uplan_status: archiviert`.
- Alles hinter `<!-- uplan:ende -->` gehört dem Vault, wird nie überschrieben und zählt
  nicht als Änderung. In älteren Notizen ohne diesen Marker ist `## Eigene Notizen` die
  Grenze.
- Bei beidseitiger Änderung gewinnt die Plattform; die Vault-Fassung landet als Block in
  derselben Notiz.

## Änderung an der Plattform

Damit die Gruppenauswahl in den Einstellungen funktioniert, hat das Gatter
(`backend/app/auth/scopes.py`) eine Zeile bekommen:

```python
"/groups/me": ("planning:read", "planning:write"),
```

Das Gatter ist Deny-by-default; ohne diese Zeile beantwortet die Plattform `/groups/me`
für Token mit 403, und die `group_id` müsste jedes Schuljahr von Hand eingetragen werden.
`/groups` als Ganzes bleibt zu — dort hängen alle Gruppen der Schule.

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
