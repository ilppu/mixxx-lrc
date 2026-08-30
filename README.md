# mixxx-lrc

A small Linux CLI app that:

1. Reads the current track from Mixxx broadcasting/Icecast stats (`status-json.xsl`)
2. Tracks elapsed seconds for the current song
3. Fetches synced lyrics from [LRCLib](https://lrclib.net)
4. Prints the matching lyric line in real time

## Usage

```bash
python3 mixxx_lrc.py \
  --stats-url http://127.0.0.1:8000/status-json.xsl \
  --poll-interval 1
```

## Notes

- The timer resets whenever the broadcast track title changes.
- Best results come from Mixxx metadata in the format `Artist - Title`.
- If LRCLib has no synced lyrics for a track, the app prints a notice and keeps polling.
