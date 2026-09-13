#!/usr/bin/env bash
# Verknüpft das Repo als Plugin in den Testvault und holt hot-reload dazu.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZIEL="${ZIEL:-$HOME/Documents/1 Projekte/Testvault-Unterricht}"
PLUGIN_ID="unterrichtsplanung-sync"

mkdir -p "$ZIEL/.obsidian/plugins"
LINKZIEL="$ZIEL/.obsidian/plugins/$PLUGIN_ID"

if [[ -L "$LINKZIEL" ]]; then
	echo "Symlink besteht bereits: $LINKZIEL"
elif [[ -e "$LINKZIEL" ]]; then
	echo "Im Weg (kein Symlink): $LINKZIEL" >&2
	exit 1
else
	ln -s "$REPO" "$LINKZIEL"
	echo "Symlink: $LINKZIEL → $REPO"
fi

# Marker: hot-reload lädt das Plugin neu, sobald esbuild main.js schreibt.
touch "$REPO/.hotreload"

if [[ ! -d "$ZIEL/.obsidian/plugins/hot-reload" ]]; then
	echo
	echo "Noch zu tun: hot-reload installieren."
	echo "  In Obsidian → BRAT → \"Add beta plugin\" → pjeby/hot-reload"
fi
