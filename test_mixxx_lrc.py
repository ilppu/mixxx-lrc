import unittest

from mixxx_lrc import (
    LyricLine,
    extract_track_title_from_stats,
    line_for_second,
    parse_synced_lyrics,
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


if __name__ == "__main__":
    unittest.main()
