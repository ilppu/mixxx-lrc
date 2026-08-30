#!/usr/bin/env python3
"""Show synchronized LRCLib lyrics for the current Mixxx broadcast track."""

from __future__ import annotations

import argparse
import curses
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
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


def format_elapsed_seconds(second_count: int) -> str:
    minutes, seconds = divmod(max(0, second_count), 60)
    return f"{minutes:02d}:{seconds:02d}"


def apply_broadcast_delay(elapsed_seconds: int, delay_seconds: float) -> int:
    return int(elapsed_seconds - delay_seconds)


def clamp_delay(delay_seconds: float, minimum: float = -30.0, maximum: float = 30.0) -> float:
    return max(minimum, min(maximum, float(delay_seconds)))


def get_default_delay_path() -> str:
    return str(Path.home() / ".config" / "mixxx-lrc" / "delay.json")


def load_saved_delay(default_delay: float, config_path: Optional[str] = None) -> float:
    path = config_path or get_default_delay_path()
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if isinstance(payload, dict):
            delay = payload.get("delay")
            if isinstance(delay, (int, float)):
                return clamp_delay(float(delay))
    except (FileNotFoundError, json.JSONDecodeError, OSError, TypeError, ValueError):
        pass
    return clamp_delay(default_delay)


def save_delay_setting(delay_seconds: float, config_path: Optional[str] = None) -> float:
    clamped = clamp_delay(delay_seconds)
    path = config_path or get_default_delay_path()
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"delay": clamped}, handle)
    return clamped


def line_for_second(lyrics: list[LyricLine], second: int) -> Optional[LyricLine]:
    current = None
    for line in lyrics:
        if line.second > second:
            break
        current = line
    return current


def safe_addstr(stdscr: curses.window, y: int, x: int, text: str, attr: int = 0) -> None:
    if not text:
        return
    height, width = stdscr.getmaxyx()
    if not (0 <= y < height and 0 <= x < width):
        return
    remaining = max(0, width - x)
    if remaining == 0:
        return
    clipped = text[:remaining]
    try:
        if clipped:
            stdscr.addstr(y, x, clipped, attr)
    except (curses.error, ValueError):
        pass


def render_status_bar(stdscr: curses.window, current_delay: float, status_message: str = "") -> None:
    height, width = stdscr.getmaxyx()
    if height <= 0 or width <= 0:
        return
    bar_y = max(0, height - 1)
    left_text = " < "
    right_text = " > "
    current_text = f" Delay {current_delay:>4.1f}s "
    left_width = len(left_text)
    right_width = len(right_text)
    safe_addstr(stdscr, bar_y, 0, " " * max(1, width))

    left_x = 0
    current_x = left_x + left_width
    right_x = current_x + len(current_text)

    safe_addstr(stdscr, bar_y, left_x, left_text, curses.A_REVERSE)
    safe_addstr(stdscr, bar_y, current_x, current_text)
    safe_addstr(stdscr, bar_y, right_x, right_text, curses.A_REVERSE)

    if status_message:
        status_x = max(0, min(width - 1, right_x + right_width + 1))
        safe_addstr(stdscr, bar_y, status_x, status_message)


def render_lyric_window(stdscr: curses.window, lyrics: list[LyricLine], current_second: int) -> None:
    height, width = stdscr.getmaxyx()
    if height <= 2 or not lyrics:
        return

    current_index = -1
    for index, lyric in enumerate(lyrics):
        if lyric.second <= current_second:
            current_index = index
        else:
            break

    if current_index < 0:
        current_index = 0

    max_before = 3
    max_after = 3
    start = max(0, current_index - max_before)
    end = min(len(lyrics), current_index + max_after + 1)
    if end - start < max_before + max_after + 1:
        if start == 0:
            end = min(len(lyrics), max_before + max_after + 1)
        else:
            start = max(0, end - (max_before + max_after + 1))

    for offset, index in enumerate(range(start, end)):
        y = 1 + offset
        if y >= height - 2:
            break
        lyric = lyrics[index]
        line_text = f"[{format_elapsed_seconds(lyric.second)}] {lyric.text}"
        attr = 0
        if index == current_index:
            attr = curses.A_BOLD | curses.A_REVERSE
        elif index < current_index:
            attr = curses.A_DIM
        safe_addstr(stdscr, y, 0, line_text, attr)

    return current_index


def run_interactive(args: argparse.Namespace) -> int:
    current_track = None
    track_start_monotonic = time.monotonic()
    lyrics: list[LyricLine] = []
    last_checked_second = -1
    last_printed_lyric_second = -1
    current_delay = load_saved_delay(args.broadcast_delay, args.delay_config)
    status_message = "Polling..."

    def update_delay(delta: float) -> None:
        nonlocal current_delay
        current_delay = save_delay_setting(clamp_delay(current_delay + delta), args.delay_config)

    def draw_screen(stdscr: curses.window) -> None:
        nonlocal current_track, lyrics, track_start_monotonic, last_checked_second, last_printed_lyric_second
        stdscr.erase()
        height, width = stdscr.getmaxyx()
        if current_track:
            safe_addstr(stdscr, 0, 0, f"Now playing: {current_track}")
        else:
            safe_addstr(stdscr, 0, 0, "Waiting for Mixxx track metadata...")

        if lyrics:
            elapsed = apply_broadcast_delay(int(time.monotonic() - track_start_monotonic), current_delay)
            render_lyric_window(stdscr, lyrics, elapsed)
            delay_y = max(1, height - 2)
            safe_addstr(stdscr, delay_y, 0, f"Delay {current_delay:+.1f}s", curses.A_BOLD | curses.A_REVERSE)
            safe_addstr(stdscr, height - 1, 0, "<      >", curses.A_REVERSE)
        else:
            safe_addstr(stdscr, 1, 0, "No synced lyrics found on LRCLib.")

        stdscr.refresh()

    def poll_track() -> None:
        nonlocal current_track, track_start_monotonic, lyrics, last_checked_second, last_printed_lyric_second, status_message
        try:
            payload = _http_get_json(args.stats_url)
            track_title = extract_track_title_from_stats(payload)
        except Exception as exc:
            status_message = f"[warn] Failed to fetch track info: {exc}"
            return

        if not track_title:
            return

        if track_title != current_track:
            current_track = track_title
            track_start_monotonic = time.monotonic()
            lyrics = fetch_synced_lyrics(args.lrclib_base, current_track)
            last_checked_second = -1
            last_printed_lyric_second = -1

        elapsed = int(time.monotonic() - track_start_monotonic)
        adjusted_elapsed = apply_broadcast_delay(elapsed, current_delay)
        if adjusted_elapsed != last_checked_second and lyrics:
            line = line_for_second(lyrics, adjusted_elapsed)
            if line and line.text and line.second != last_printed_lyric_second:
                status_message = f"[{format_elapsed_seconds(adjusted_elapsed)}] {line.text}"
                last_printed_lyric_second = line.second
            last_checked_second = adjusted_elapsed

    def main_loop(stdscr: curses.window) -> None:
        nonlocal status_message
        curses.curs_set(0)
        stdscr.keypad(True)
        stdscr.nodelay(True)
        curses.mousemask(curses.ALL_MOUSE_EVENTS | curses.REPORT_MOUSE_POSITION)

        while True:
            poll_track()
            draw_screen(stdscr)
            key = stdscr.getch()
            if key == curses.KEY_LEFT or key == ord("h"):
                update_delay(-0.5)
                status_message = f"Delay {current_delay:.1f}s"
            elif key == curses.KEY_RIGHT or key == ord("l"):
                update_delay(0.5)
                status_message = f"Delay {current_delay:.1f}s"
            elif key in (curses.KEY_UP, ord("+"), ord("=")):
                update_delay(1.0)
                status_message = f"Delay {current_delay:.1f}s"
            elif key in (curses.KEY_DOWN, ord("-")):
                update_delay(-1.0)
                status_message = f"Delay {current_delay:.1f}s"
            elif key == curses.KEY_MOUSE:
                _, mouse_x, mouse_y, _, _ = curses.getmouse()
                height, _ = stdscr.getmaxyx()
                bottom_y = height - 1
                left_x = 0
                button_width = 6
                if mouse_y == bottom_y:
                    if left_x <= mouse_x < left_x + button_width:
                        update_delay(-0.5)
                        status_message = f"Delay {current_delay:.1f}s"
                    elif left_x + button_width <= mouse_x < left_x + (button_width * 2):
                        update_delay(0.5)
                        status_message = f"Delay {current_delay:.1f}s"
            time.sleep(args.poll_interval)

    try:
        curses.wrapper(main_loop)
    except (curses.error, OSError, ValueError):
        return run_plain(args)
    return 0


def run_plain(args: argparse.Namespace) -> int:
    current_track = None
    track_start_monotonic = 1.0
    lyrics: list[LyricLine] = []
    last_checked_second = -1
    last_printed_lyric_second = -1
    args.broadcast_delay = load_saved_delay(args.broadcast_delay, args.delay_config)

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
        adjusted_elapsed = apply_broadcast_delay(elapsed, args.broadcast_delay)
        if adjusted_elapsed != last_checked_second and lyrics:
            line = line_for_second(lyrics, adjusted_elapsed)
            if line and line.text and line.second != last_printed_lyric_second:
                print(f"[{format_elapsed_seconds(adjusted_elapsed)}] {line.text}")
                last_printed_lyric_second = line.second
            last_checked_second = adjusted_elapsed

        time.sleep(args.poll_interval)


def run(args: argparse.Namespace) -> int:
    if sys.stdin.isatty() and sys.stdout.isatty():
        try:
            return run_interactive(args)
        except (curses.error, OSError, ValueError):
            print("Curses mode unavailable; falling back to plain text output.", file=sys.stderr)
            return run_plain(args)
    return run_plain(args)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Show real-time LRCLib lyrics for the current Mixxx broadcast track."
    )
    parser.add_argument(
        "--stats-url",
        required=False,
        default="http://127.0.0.1:8000/status-json.xsl",
        help="Mixxx/Icecast status JSON URL, default: http://127.0.0.1:8000/status-json.xsl",
    )
    parser.add_argument(
        "--lrclib-base",
        default="https://lrclib.net",
        help="LRCLib base URL (default: https://lrclib.net)",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        required=False,
        default=1.0,
        help="Polling interval in seconds (default: 1.0)",
    )
    parser.add_argument(
        "--broadcast-delay",
        type=float,
        required=False,
        default=-2.5,
        help="Seconds to subtract from the elapsed track time to account for broadcast latency (default: -2.5)",
    )
    parser.add_argument(
        "--delay-config",
        default=get_default_delay_path(),
        help="Path to the saved delay config file (default: ~/.config/mixxx-lrc/delay.json)",
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
