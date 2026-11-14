#!/usr/bin/env bash
# Downloads the Widevine-enabled castlabs Electron build into vendor/.
# Stock Electron cannot play Apple Music's DRM streams.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VER="${1:-v45.2.1+wvcus}"
URL="https://github.com/castlabs/electron-releases/releases/download/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$VER")/electron-$VER-linux-x64.zip"

mkdir -p "$DIR/vendor"
echo "Downloading $URL"
curl -L --progress-bar -o /tmp/auralis-electron.zip "$URL"
rm -rf "$DIR/vendor/electron"
mkdir -p "$DIR/vendor/electron"
python3 -c "import zipfile;zipfile.ZipFile('/tmp/auralis-electron.zip').extractall('$DIR/vendor/electron')"
chmod +x "$DIR/vendor/electron/electron"
echo "Done: $DIR/vendor/electron/electron"
