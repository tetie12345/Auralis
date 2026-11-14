# Auralis

A futuristic Apple Music client for Linux desktops.

Auralis embeds the Apple Music web player (via a Widevine-enabled Electron
build) and wraps it in a custom interface:

- **Your Apple account** — sign in once inside the embedded player; your
  phone-2FA flow works normally. Play the playlists you made on your phone,
  search artists / songs / playlists from the full Apple catalog, shuffle,
  and jump around the queue.
- **Live music visualizer** — a snappy cava-style spectrum (plus a particle
  "nebula" mode), driven by a real FFT of the actual system audio output
  (PipeWire/PulseAudio monitor capture), not fake data.
- **Time-synced lyrics** — karaoke-style, matched against playback, with
  auto-scroll. Sources: Apple when available, otherwise the LRCLIB database.
- **Artwork colour theming** — accents, glow and the visualizer palette are
  derived from the average colour of the album cover of whatever is playing.
- **Up Next queue, fullscreen mode** (`F`), keyboard shortcuts
  (Space play/pause, ←/→ seek, `V` visualizer, `L` lyrics).

## Requirements

- Linux (developed on Arch + KDE Plasma Wayland; anything Electron runs on
  should work, X11 or Wayland)
- PipeWire or PulseAudio (the visualizer taps the default sink's monitor)
- An active **Apple Music subscription** (streaming playback needs it)
- `curl` and `python3` (only needed by the installer script)

## Install

### Option A — release tarball (bundled Electron, ~120 MB download)

1. Grab the latest `Auralis-vX.Y.Z-linux-x64.tar.gz` from the
   [Releases](../../releases) page.
2. Extract and run:

   ```bash
   tar xzf Auralis-vX.Y.Z-linux-x64.tar.gz
   cd Auralis
   ./bin/auralis
   ```

3. Optional: install the app-menu entry:

   ```bash
   ./scripts/install-desktop.sh
   ```

### Option B — from source (downloads Electron on first install)

```bash
git clone https://github.com/tetie12345/Auralis.git
cd Auralis
./scripts/install-electron.sh    # fetches the Widevine-enabled Electron build
./bin/auralis
```

The Electron binary is **not** stock: stock Electron cannot play Apple's
DRM streams. `scripts/install-electron.sh` pulls the current
[castlabs Electron release](https://github.com/castlabs/electron-releases)
(Widevine enabled) into `vendor/`. You can pass a specific version as the
first argument.

## First launch

1. Auralis opens on the sign-in screen — click **Connect Apple Music**.
2. Sign in with your Apple ID inside the embedded player (approve the 2FA
   prompt on your phone).
3. Once connected, the player hides itself and your library loads. Your
   session persists (cookies), so this is one-time.

## How it works

- `src/main/` — Electron main process: window, IPC, artwork cache, and
  system-audio capture (`parec` into the default sink's `.monitor` source).
- `src/renderer/` — the Auralis UI; drives the embedded player through the
  Apple player's own MusicKit internals (an event tap on its dispatcher
  provides exact playback time/queue state).
- `vendor/electron/` — the castlabs Electron release (ignored by git;
  fetched by the installer).

## Troubleshooting

- **No visualizer movement** — check that your default audio sink has a
  monitor source (`pactl list short | grep monitor`); pick a different
  source in Settings if your music plays to a non-default sink.
- **Playback errors** — confirm your Apple Music subscription is active and
  you are signed in (green dot in the sidebar).
- **Electron missing** — run `./scripts/install-electron.sh`.

## License

MIT — see [LICENSE](LICENSE).
