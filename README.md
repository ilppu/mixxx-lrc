# mixxx-lrc

A small Linux CLI app that:

1. Reads the current track from Mixxx broadcasting/Icecast stats (`status-json.xsl`)
2. Tracks elapsed seconds for the current song
3. Fetches synced lyrics from [LRCLib](https://lrclib.net)
4. Prints the matching lyric line in real time

## Usage
1. Turn on Live Broadcasting in settings with the info of your choice. Example:
<img width="1018" height="245" alt="Screenshot from 2026-08-30 17-48-54" src="https://github.com/user-attachments/assets/1e646639-daec-418a-a220-69678e3e2392" />
2. Run these commands:
```bash
npm install
npm start
```
If that doesn't work, try 
```bash
npx electron . --disable-gpu --ozone-platform=x11
```
Choose **Load files**, open an audio file, then open its matching `.lrc` file from the **Open lyrics** item. The audio file is played locally; no files are downloaded or written by the app.

Open **Settings** to configure the Icecast stats URL. The Icecast clock remains the default. The optional **Use Mixxx bridge** toggle enables exact Mixxx position updates and real deck seeking.

## Optional Mixxx bridge

1. Copy `mixxx/mixxx_lrc.js` and `mixxx/mixxx_lrc.midi.xml` into Mixxx's user controller folder, normally `~/.mixxx/controllers` on Linux.
2. Start this app before opening Mixxx. It creates one bidirectional `Mixxx LRC Bridge` virtual MIDI device.
3. In Mixxx, select the **Mixxx LRC Bridge** mapping for the `Mixxx LRC Bridge` device.
4. In this app's Settings, enable **Use Mixxx bridge**. The virtual ports should already be selected automatically.

The bridge is disabled by default. With it disabled, the existing Icecast title matching and local clock continue to work unchanged.

## Tests

```bash
npm test
python3 -m unittest
```
