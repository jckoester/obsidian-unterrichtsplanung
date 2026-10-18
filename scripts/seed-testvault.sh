#!/usr/bin/env bash
# Befüllt den Testvault mit der Struktur, gegen die Bases und Cockpit geprüft werden.
#
# Einbahnstraße: liest aus dem Produktivvault, schreibt nur in den Testvault.
# Mehrfach aufrufbar — überschreibt die kopierten Dateien, lässt Testnotizen stehen.
#
# Zwei Schichten: erst der Bestand aus dem PKM-Vault, darüber `vault/` aus diesem Repo —
# die Vault-Dateien in dem Stand, den das Plugin gerade voraussetzt. Entwickelt wird nur
# im Testvault; in den PKM-Vault kommt `vault/` erst mit der Migration.
set -euo pipefail

QUELLE="${QUELLE:-$HOME/Documents/PKM}"
ZIEL="${ZIEL:-$HOME/Documents/1 Projekte/Testvault-Unterricht}"
LEHRAUFTRAG="${LEHRAUFTRAG:-NwT 9}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "$QUELLE" ]]; then
	echo "Produktivvault nicht gefunden: $QUELLE" >&2
	exit 1
fi

echo "Seed: $QUELLE  →  $ZIEL"

mkdir -p "$ZIEL/.obsidian/plugins" \
	"$ZIEL/System/Bases" \
	"$ZIEL/System/Templates/Unterricht" \
	"$ZIEL/Bereiche/11 Unterricht"

# Property-Typen: ohne die verhalten sich Bases anders als im echten Vault.
cp -f "$QUELLE/.obsidian/types.json" "$ZIEL/.obsidian/types.json" 2>/dev/null || true
cp -f "$QUELLE/.obsidian/app.json" "$ZIEL/.obsidian/app.json" 2>/dev/null || true

for base in UE-Katalog UStunden-Katalog Lehraufträge Unterrichtseinheiten Unterrichtsstunden GFS-Themen Unterricht-Cockpit; do
	cp -f "$QUELLE/System/Bases/$base.base" "$ZIEL/System/Bases/" 2>/dev/null || true
done

cp -Rf "$QUELLE/System/Templates/Unterricht/." "$ZIEL/System/Templates/Unterricht/" 2>/dev/null || true
cp -f "$QUELLE/Bereiche/11 Unterricht/Unterricht-Cockpit.md" "$ZIEL/Bereiche/11 Unterricht/" 2>/dev/null || true
cp -Rf "$QUELLE/Bereiche/11 Unterricht/$LEHRAUFTRAG" "$ZIEL/Bereiche/11 Unterricht/" 2>/dev/null || true

# Die Eigenschaften blendet der PKM-Vault per Snippet aus (beim Überfahren sichtbar); ohne
# es sähe eine Stundennotiz im Testvault anders aus als im Alltag. Nur dieses eine Snippet —
# die Gestaltung des Plugins steht in seinem `styles.css`.
mkdir -p "$ZIEL/.obsidian/snippets"
cp -f "$QUELLE/.obsidian/snippets/properties.css" "$ZIEL/.obsidian/snippets/" 2>/dev/null || true
python3 - "$ZIEL" <<'PY'
import json, pathlib, sys
pfad = pathlib.Path(sys.argv[1]) / ".obsidian" / "appearance.json"
daten = json.loads(pfad.read_text()) if pfad.exists() else {}
# `uplan` war das Snippet des Kopfs vor dem 04.10.2026 — veraltet, es störte mit `pointer-events`.
an = [s for s in daten.get("enabledCssSnippets", []) if s != "uplan"]
daten["enabledCssSnippets"] = an + ([] if "properties" in an else ["properties"])
pfad.write_text(json.dumps(daten, indent=2) + "\n")
print(f"Snippets: {daten['enabledCssSnippets']}")
PY
rm -f "$ZIEL/.obsidian/snippets/uplan.css"

# Die zweite Schicht: Bases und Template im Entwicklungsstand. Danach, damit sie gewinnt.
cp -Rf "$REPO/vault/." "$ZIEL/"

# Plugins, von denen das Notizformat abhängt (Bases sind Kernfunktion, brauchen nichts).
for plugin in dataview obsidian-meta-bind-plugin templater-obsidian notebook-navigator obsidian42-brat; do
	if [[ -d "$QUELLE/.obsidian/plugins/$plugin" ]]; then
		mkdir -p "$ZIEL/.obsidian/plugins/$plugin"
		# data.json bewusst nicht mitkopieren: darin stecken Tokens und Pfade des echten Vaults.
		for datei in main.js manifest.json styles.css; do
			cp -f "$QUELLE/.obsidian/plugins/$plugin/$datei" "$ZIEL/.obsidian/plugins/$plugin/" 2>/dev/null || true
		done
	fi
done

python3 - "$ZIEL" <<'PY'
import json, pathlib, sys
ziel = pathlib.Path(sys.argv[1])
pfad = ziel / ".obsidian" / "community-plugins.json"
gewuenscht = [
    "dataview", "obsidian-meta-bind-plugin", "templater-obsidian",
    "notebook-navigator", "obsidian42-brat", "hot-reload",
    "unterrichtsplanung-sync",
]
vorhanden = json.loads(pfad.read_text()) if pfad.exists() else []
pfad.write_text(json.dumps(sorted(set(vorhanden) | set(gewuenscht)), indent=2) + "\n")
print(f"community-plugins.json: {len(gewuenscht)} Einträge")
PY

# Die Statistik im Lehrauftrag-Template ist DataviewJS. Ohne diese Schalter zeigt der
# Testvault „(disabled; enable in settings)", während sie im PKM-Vault läuft. Übernommen
# werden nur die Schalter, nicht die ganze data.json (siehe oben).
python3 - "$QUELLE" "$ZIEL" <<'PY'
import json, pathlib, sys
quelle, ziel = (pathlib.Path(p) / ".obsidian/plugins/dataview/data.json" for p in sys.argv[1:3])
if not quelle.exists():
    sys.exit(0)
schalter = ("enableDataviewJs", "enableInlineDataviewJs")
werte = {k: v for k, v in json.loads(quelle.read_text()).items() if k in schalter}
daten = json.loads(ziel.read_text()) if ziel.exists() else {}
daten.update(werte)
ziel.write_text(json.dumps(daten, indent=2) + "\n")
print(f"Dataview: {werte}")
PY

echo "Fertig. Vault in Obsidian öffnen: $ZIEL"
