#!/usr/bin/env bash
# Installs the Auralis desktop entry (app menu / application launcher).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/auralis.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Auralis
Comment=Apple Music client with visualizer and synced lyrics
Exec=$DIR/bin/auralis
Icon=$DIR/assets/icon.png
Categories=Audio;Music;
Terminal=false
EOF
echo "Installed: $HOME/.local/share/applications/auralis.desktop"
