#!/usr/bin/env python3
"""Show synchronized LRCLib lyrics for the current Mixxx broadcast track."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Iterable, Optional


@dataclass(frozen=True)
class LyricLine:
    second: int
    text: str


def _http_get_json(url: str, timeout: float = 5.0) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "mixxx-lrc/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def extract_track_title_from_stats(payload: dict) -> Optional[str]:
    icestats = payload.get("icestats")
    if not isinstance(icestats, dict):
        return None

    source = icestats.get("source")
    sources: Iterable[dict]
    if isinstance(source, dict):
        sources = [source]
    elif isinstance(source, list):
        sources = [s for s in source if isinstance(s, dict)]
    else:
        return None

    for candidate in sources:
        title = candidate.get("title")
        if isinstance(title, str) and title.strip():
            return title.strip()

        artist = candidate.get("artist")
        track = candidate.get("server_name") or candidate.get("listenurl")
        if isinstance(artist, str) and isinstance(track, str) and artist.strip() and track.strip():
            return f"{artist.strip()} - {track.strip()}"

    return None


def split_artist_title(track_title: str) -> tuple[str, str]:
    if " - " in track_title:
        artist, title = track_title.split(" - ", 1)
        return artist.strip(), title.strip()
    return "", track_title.strip()


def fetch_synced_lyrics(lrclib_base: str, track_title: str, timeout: float = 8.0) -> list[LyricLine]:
    artist, title = split_artist_title(track_title)
    query = {"track_name": title}
    if artist:
        query["artist_name"] = artist

    url = f"{lrclib_base.rstrip('/')}/api/get?{urllib.parse.urlencode(query)}"
    req = urllib.request.Request(url, headers={"User-Agent": "mixxx-lrc/1.0"})

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            data = json.load(response)
    except Exception:
        return []

    synced = data.get("syncedLyrics")
    if not isinstance(synced, str) or not synced.strip():
        return []

    return parse_synced_lyrics(synced)


_LRC_PATTERN = re.compile(r"^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$")


def parse_synced_lyrics(synced_lyrics: str) -> list[LyricLine]:
    parsed: list[LyricLine] = []
    for raw_line in synced_lyrics.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = _LRC_PATTERN.match(line)
        if not match:
            continue

        minute, second, fractional, text = match.groups()
        total = int(minute) * 60 + int(second)

        if fractional:
            frac = fractional.ljust(3, "0")
            total += int(frac) // 1000

        parsed.append(LyricLine(second=total, text=text.strip()))

    return sorted(parsed, key=lambda item: item.second)


def line_for_second(lyrics: list[LyricLine], second: int) -> Optional[LyricLine]:
    current = None
    for line in lyrics:
        if line.second > second:
            break
        current = line
    return current


def run(args: argparse.Namespace) -> int:
    current_track = None
    track_start_monotonic = 0.0
    lyrics: list[LyricLine] = []
    last_checked_second = -1
    last_printed_lyric_second = -1

    print(f"Polling Mixxx broadcast stats from: {args.stats_url}")

    while True:
        try:
            payload = _http_get_json(args.stats_url)
            track_title = extract_track_title_from_stats(payload)
        except Exception as exc:
            print(f"[warn] Failed to fetch track info: {exc}", file=sys.stderr)
            time.sleep(args.poll_interval)
            continue

        if not track_title:
            time.sleep(args.poll_interval)
            continue

        if track_title != current_track:
            current_track = track_title
            track_start_monotonic = time.monotonic()
            lyrics = fetch_synced_lyrics(args.lrclib_base, current_track)
            last_checked_second = -1
            last_printed_lyric_second = -1
            print(f"\nNow playing: {current_track}")
            if not lyrics:
                print("No synced lyrics found on LRCLib.")

        elapsed = int(time.monotonic() - track_start_monotonic)
        if elapsed != last_checked_second and lyrics:
            line = line_for_second(lyrics, elapsed)
            if line and line.text and line.second != last_printed_lyric_second:
                print(f"[{elapsed:>4}s] {line.text}")
                last_printed_lyric_second = line.second
            last_checked_second = elapsed

        time.sleep(args.poll_interval)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Show real-time LRCLib lyrics for the current Mixxx broadcast track."
    )
    parser.add_argument(
        "--stats-url",
        required=True,
        help="Mixxx/Icecast status JSON URL, e.g. http://127.0.0.1:8000/status-json.xsl",
    )
    parser.add_argument(
        "--lrclib-base",
        default="https://lrclib.net",
        help="LRCLib base URL (default: https://lrclib.net)",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=1.0,
        help="Polling interval in seconds (default: 1.0)",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return run(args)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
