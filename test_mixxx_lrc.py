import unittest

import os
import tempfile

from mixxx_lrc import (
    LyricLine,
    apply_broadcast_delay,
    extract_track_title_from_stats,
    format_elapsed_seconds,
    line_for_second,
    load_saved_delay,
    parse_synced_lyrics,
    save_delay_setting,
    split_artist_title,
)


class MixxxLrcTests(unittest.TestCase):
    def test_extract_track_from_single_source(self):
        payload = {"icestats": {"source": {"title": "Artist - Song"}}}
        self.assertEqual(extract_track_title_from_stats(payload), "Artist - Song")

    def test_extract_track_from_multiple_sources(self):
        payload = {
            "icestats": {
                "source": [
                    {"title": ""},
                    {"title": "Another Artist - Another Song"},
                ]
            }
        }
        self.assertEqual(
            extract_track_title_from_stats(payload), "Another Artist - Another Song"
        )

    def test_split_artist_title(self):
        self.assertEqual(split_artist_title("A - B"), ("A", "B"))
        self.assertEqual(split_artist_title("Only title"), ("", "Only title"))

    def test_parse_synced_lyrics(self):
        lyrics = parse_synced_lyrics("""[00:01.00]Hello\n[00:10.50]World""")
        self.assertEqual(
            lyrics,
            [LyricLine(second=1, text="Hello"), LyricLine(second=10, text="World")],
        )

    def test_line_for_second(self):
        lines = [LyricLine(1, "a"), LyricLine(3, "b")]
        self.assertIsNone(line_for_second(lines, 0))
        self.assertEqual(line_for_second(lines, 2), LyricLine(1, "a"))
        self.assertEqual(line_for_second(lines, 3), LyricLine(3, "b"))

    def test_format_elapsed_seconds(self):
        self.assertEqual(format_elapsed_seconds(0), "00:00")
        self.assertEqual(format_elapsed_seconds(63), "01:03")

    def test_apply_broadcast_delay(self):
        self.assertEqual(apply_broadcast_delay(42, 5), 37)
        self.assertEqual(apply_broadcast_delay(3, 5), -2)
        self.assertEqual(apply_broadcast_delay(3, -5), 8)

    def test_save_and_load_delay(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = os.path.join(tmpdir, "delay.json")
            saved = save_delay_setting(8.5, config_path)
            self.assertEqual(saved, 8.5)
            self.assertEqual(load_saved_delay(5.0, config_path), 8.5)
            self.assertEqual(load_saved_delay(-5.0, config_path), 8.5)

    def test_negative_delay_is_allowed(self):
        self.assertEqual(apply_broadcast_delay(10, -2), 12)


if __name__ == "__main__":
    unittest.main()
