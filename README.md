# Auralis

A futuristic Apple Music client for Linux desktops.

Auralis embeds the Apple Music web player (via a Widevine-enabled Electron
build) and wraps it in a custom interface:

- **Your Apple account** — sign in once inside the embedded player; your
  phone-2FA flow works normally. Play the playlists you made on your phone,
  search artists / songs / playlists from the full Apple catalog.
- **Live music visualizer** — frequency spectrum + particle "nebula" mode,
  driven by a real FFT of the actual system audio output (PipeWire/PulseAudio
  monitor capture), not fake data.
- **Time-synced lyrics** — karaoke-style, matched against playback time.
- **Artwork colour theming** — the whole UI re-tints itself to the album
  cover of whatever is playing.

## Run

```bash
./bin/auralis
```

Requirements: PipeWire or PulseAudio (for the visualizer tap), an active
Apple Music subscription.

## First launch

1. Auralis opens on the sign-in screen — click **Connect Apple Music**.
2. Sign in with your Apple ID in the embedded player (approve the 2FA prompt
   on your phone).
3. Once connected, the player hides itself and your library loads.

## How it works

- `src/main/` — Electron main process: window, IPC, system-audio capture
  (`parec` into the default sink's `.monitor` source).
- `src/renderer/` — the Auralis UI; drives the embedded player through
  MusicKit JS injected into the Apple Music page.
- `vendor/electron/` — the [castlabs Electron release](https://github.com/castlabs/electron-releases)
  (stock Electron cannot play Apple's DRM streams).

## License

MIT
