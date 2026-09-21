# mixxx-lrc

Synced, real-time lyrics for whatever is playing in [Mixxx](https://mixxx.org). It is a small desktop app (Electron) that shows the current line highlighted in time with the song, using lyrics from [LRCLib](https://lrclib.net) or your own `.lrc` files.

There are two ways to tell the app what Mixxx is playing:

| Mode | Needs Live Broadcasting? | Track identification | Position | Seeking |
| --- | --- | --- | --- | --- |
| **Mixxx bridge** (recommended) | No | Duration + BPM + key, looked up in Mixxx's own library | Exact | Yes |
| **Icecast** (default) | Yes | Track title from Icecast stats | Local clock (approximate) | No |

There is also a tiny terminal version, `mixxx_lrc.py`, which works in Icecast mode only.

## Features

- Highlighted, auto-scrolling synced lyrics with a lyrics search box and adjustable sync offset
- LRCLib lookup, or local `.lrc` files matched to your music library
- BPM and key of the loaded track shown next to the title
- Exact deck position and real seeking from the app (with the bridge)
- Works without Live Broadcasting when using the bridge
- Manual mode: play any audio file with its `.lrc` file, no Mixxx needed

## Requirements

- **Node.js and npm.** Node 22 or newer is recommended. The Mixxx database lookup uses Node's built-in `sqlite`, which Electron 44 already includes.
- **Mixxx 2.4 or newer.** The bridge mapping targets 2.4+.
- **Ubuntu 24.04 LTS** (or newer, haven't tested and will not test), may work on other linux distros as well

For the bridge you also need your **music folder** available on the same computer, and tracks that Mixxx has **analysed** (otherwise BPM and key are missing and the app matches on duration alone).

## Install and run

```bash
npm install
npm start
```

If the window fails to open (common with some Linux graphics setups), try:

```bash
npx electron . --disable-gpu --ozone-platform=x11
```

## Setup: Mixxx bridge (recommended)

1. Copy `mixxx/mixxx_lrc.js` and `mixxx/mixxx_lrc.midi.xml` into Mixxx's user controllers folder, normally `~/.mixxx/controllers` on Linux. Always copy **both** files together.
2. **Start this app before Mixxx.** It creates a virtual MIDI device called `Mixxx LRC Bridge`.
3. Start Mixxx. In **Preferences → Controllers**, select the `Mixxx LRC Bridge` device, choose the **Mixxx LRC Bridge** mapping, and enable it.
4. In this app, open **Settings**:
   - Turn on **Use Mixxx bridge**. The virtual MIDI ports should be selected automatically.
   - Choose your **library folder** (the folder with your audio files and `.lrc` files).
5. Load a track on deck 1 in Mixxx. The title, BPM, key and lyrics should appear within a moment.

Live Broadcasting can stay off. The bridge currently reads **deck 1 (`[Channel1]`)** only.

### How the track is identified

The bridge sends the deck's duration, BPM and key. The app then:

1. Looks the track up in **Mixxx's own library database** (`mixxxdb.sqlite`). It is found automatically in the standard location on Linux, Flatpak, macOS and Windows, or you can point to it with the `MIXXX_DB_PATH` environment variable. This is the most reliable route because the values are the same analysis the deck reports.
2. If the database can't be read, it falls back to tags in your audio files (duration, plus BPM and key tags if present).
3. Files within 0.5 s of the deck's duration are candidates. BPM (half/double time allowed) and key add to a score but never rule a file out.
4. Copies of the same song (same tags or file name, for example an mp3 and a flac) count as one match, preferring the copy that has a `.lrc` file.
5. If several different songs are still tied, the app picks the best guess (a file with lyrics first, then the closest duration) and says **"Best guess of N similar files"** in the status line.

The status line under the track shows where the match came from, for example `Song title · via Mixxx library` or `… · via file tags`.

## Setup: Icecast mode

Use this if you don't want the bridge.

1. In Mixxx, turn on **Live Broadcasting** (Preferences → Live Broadcasting) and point it at your Icecast server.

   <img width="1018" height="245" alt="Live Broadcasting settings in Mixxx" src="https://github.com/user-attachments/assets/1e646639-daec-418a-a220-69678e3e2392" />

2. Run the app. In **Settings**, check the **Icecast stats URL** (default `http://127.0.0.1:8000/status-json.xsl?mount=/live`) and press **Save**.

The app reads the current title from Icecast and runs its own clock from there, so position is approximate and seeking is not available.

## Manual mode

Choose **Load files**, open an audio file, then open its matching `.lrc` file with **Open lyrics**. The audio plays locally in the app. No files are downloaded or written.

## Terminal version

`mixxx_lrc.py` prints the current lyric line in a terminal. It reads Icecast stats, so Live Broadcasting must be on.

```bash
python3 mixxx_lrc.py --stats-url http://127.0.0.1:8000/status-json.xsl
```

Options: `--lrclib-base`, `--poll-interval` (default 1.0 s), `--broadcast-delay` (default -2.5 s) and `--delay-config` (default `~/.config/mixxx-lrc/delay.json`). Run with `--help` for details.

## Troubleshooting

**Nothing happens in the app / Settings won't open.** The page script probably failed to load, usually because project files are from different versions (for example `renderer.js` newer than `src/lyrics.mjs`). Press `Ctrl+Shift+I`, read the Console error, and make sure you copied the whole project.

**Mixxx shows `MixxxLrc.incomingData is not a function` (or similar).** The `mixxx_lrc.js` and `mixxx_lrc.midi.xml` in your controllers folder are from different versions. Copy both again from `mixxx/`, overwrite the old ones, and make sure only one copy of the mapping is loaded.

**"Choose your library folder to identify tracks".** Set the library folder in Settings.

**"Mixxx database unavailable: …" (shown as "via file tags").** The app couldn't read `mixxxdb.sqlite`. It still works using file tags. To fix it, set `MIXXX_DB_PATH` to the database file and restart the app. If the message mentions a missing column, please open an issue with the full text.

**"No library file near [x] s".** No file in your library folder has that duration. Check you chose the right folder and that the track is inside it.

**"Best guess of [x] similar files".** Several different songs share almost the same length and BPM/key couldn't separate them. The lyrics shown may be for the wrong one. Analysing the tracks in Mixxx, or adding `.lrc` files for the right ones, improves this.

**BPM or key shows "—".** The track hasn't been analysed in Mixxx yet, or Mixxx didn't detect a value.

**Bridge doesn't connect.** Start the app first, then Mixxx, and confirm the `Mixxx LRC Bridge` device is enabled in Mixxx's controller preferences. The bridge is off by default, so also check **Use Mixxx bridge** in Settings.

**Seeking doesn't work.** Yeah idk about that one it works when ot wants to, there's something wrong with the controller and I'm too lazy to fix it

## Development

```bash
npm test               # JavaScript tests (matching, key parsing, LRC parsing)
python3 -m unittest    # tests for the terminal version
```

The bridge protocol is a JSON payload sent as MIDI SysEx from `mixxx/mixxx_lrc.js` (`title`, `loaded`, `position`, `duration`, `playing`, `bpm`, `key`). Log lines from the bridge and the library lookup are prefixed with `[mixxx-lrc bridge]`.

## License

GNU GPL v3 license,
see [LICENSE](LICENSE).