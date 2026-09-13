#!/usr/bin/env bash
# Befüllt den Testvault mit der Struktur, gegen die Bases und Cockpit geprüft werden.
#
# Einbahnstraße: liest aus dem Produktivvault, schreibt nur in den Testvault.
# Mehrfach aufrufbar — überschreibt die kopierten Dateien, lässt Testnotizen stehen.
set -euo pipefail

QUELLE="${QUELLE:-$HOME/Documents/PKM}"
ZIEL="${ZIEL:-$HOME/Documents/1 Projekte/Testvault-Unterricht}"
LEHRAUFTRAG="${LEHRAUFTRAG:-NwT 9}"

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

for base in UE-Katalog UStunden-Katalog Lehraufträge Unterrichtseinheiten Unterrichtsstunden GFS-Themen; do
	cp -f "$QUELLE/System/Bases/$base.base" "$ZIEL/System/Bases/" 2>/dev/null || true
done

cp -Rf "$QUELLE/System/Templates/Unterricht/." "$ZIEL/System/Templates/Unterricht/" 2>/dev/null || true
cp -f "$QUELLE/Bereiche/11 Unterricht/Unterricht-Cockpit.md" "$ZIEL/Bereiche/11 Unterricht/" 2>/dev/null || true
cp -Rf "$QUELLE/Bereiche/11 Unterricht/$LEHRAUFTRAG" "$ZIEL/Bereiche/11 Unterricht/" 2>/dev/null || true

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

echo "Fertig. Vault in Obsidian öffnen: $ZIEL"
