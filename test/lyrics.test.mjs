import test from 'node:test';
import assert from 'node:assert/strict';
import { activeLineIndex, extractTrackTitleFromMetadata, formatTime, keyLabel, keyToMixxxNumber, normalizeTrackTitle, parseSyncedLyrics, pickTrackMatch, resolveTrackMatch, titleMatches } from '../src/lyrics.mjs';

test('parses millisecond timestamps and sorts lines', () => {
  assert.deepEqual(parseSyncedLyrics('[00:10.50]Later\n[00:01.2]First'), [
    { second: 1.2, text: 'First' },
    { second: 10.5, text: 'Later' },
  ]);
});

test('finds the line at or before the playback position', () => {
  const lines = parseSyncedLyrics('[00:01.00]First\n[00:03.00]Second');
  assert.equal(activeLineIndex(lines, 0), -1);
  assert.equal(activeLineIndex(lines, 2.99), 0);
  assert.equal(activeLineIndex(lines, 3), 1);
});

test('formats long and negative times predictably', () => {
  assert.equal(formatTime(63.9), '01:03');
  assert.equal(formatTime(-4), '00:00');
});

test('normalizes Mixxx track titles for matching', () => {
  assert.equal(normalizeTrackTitle('Artist - Song (Radio Edit)'), 'artist song radio edit');
  assert.equal(normalizeTrackTitle('  artist  -  song  '), 'artist song');
});

test('matches a Mixxx title against a local audio or lyric stem', () => {
  assert.equal(titleMatches('Artist - Song', 'artist - song'), true);
  assert.equal(titleMatches('Artist - Song (Radio Edit)', 'artist song'), true);
  assert.equal(titleMatches('Artist - Another Song', 'artist song'), false);
});

test('extracts a live Icecast title from the mounted stream metadata', () => {
  assert.equal(extractTrackTitleFromMetadata({
    icestats: {
      source: [{ mount: '/live', title: 'Artist - Song' }],
    },
  }), 'Artist - Song');

  assert.equal(extractTrackTitleFromMetadata({
    source: { mount: '/live', streamtitle: 'Artist - Song' },
  }), 'Artist - Song');
});

test('converts musical key notations to Mixxx key numbers', () => {
  assert.equal(keyToMixxxNumber('C'), 1);
  assert.equal(keyToMixxxNumber('Am'), 22);
  assert.equal(keyToMixxxNumber('A minor'), 22);
  assert.equal(keyToMixxxNumber('F#m'), 19);
  assert.equal(keyToMixxxNumber('Bb'), 11);
  assert.equal(keyToMixxxNumber('Bbm'), 23);
  assert.equal(keyToMixxxNumber('8A'), 22); // Camelot A minor
  assert.equal(keyToMixxxNumber('8B'), 1); // Camelot C major
  assert.equal(keyToMixxxNumber(13), 13);
  assert.equal(keyToMixxxNumber('nonsense'), 0);
  assert.equal(keyToMixxxNumber(''), 0);
});

test('labels Mixxx key numbers', () => {
  assert.equal(keyLabel(1), 'C');
  assert.equal(keyLabel(22), 'Am');
  assert.equal(keyLabel(0), '');
});

test('picks the only track within the duration tolerance', () => {
  const tracks = [{ id: 'a', duration: 200 }, { id: 'b', duration: 240 }];
  assert.equal(pickTrackMatch({ duration: 200.2 }, tracks).id, 'a');
  assert.equal(pickTrackMatch({ duration: 300 }, tracks), null);
});

test('uses BPM and key to break duration ties', () => {
  const tracks = [
    { id: 'slow', duration: 200, bpm: 90, key: 'Am' },
    { id: 'fast', duration: 200.1, bpm: 128, key: 'Cm' },
  ];
  assert.equal(pickTrackMatch({ duration: 200, bpm: 128, key: 22 }, tracks), null); // BPM says fast, key says slow: a tie
  assert.equal(pickTrackMatch({ duration: 200, bpm: 128, key: 0 }, tracks).id, 'fast');
  assert.equal(pickTrackMatch({ duration: 200, bpm: 0, key: 22 }, tracks).id, 'slow');
  assert.equal(pickTrackMatch({ duration: 200, bpm: 64.2, key: 13 }, tracks).id, 'fast'); // half-time BPM
});

test('refuses to guess when ties cannot be broken', () => {
  const tracks = [{ id: 'a', duration: 200 }, { id: 'b', duration: 200 }];
  assert.equal(pickTrackMatch({ duration: 200, bpm: 120, key: 1 }, tracks), null);
});

test('treats duplicate copies of one song as a single match', () => {
  const tracks = [
    { id: 'mp3', duration: 200, stemKey: 'artist song', hasLyric: false },
    { id: 'flac', duration: 200.05, stemKey: 'artist song', hasLyric: true },
  ];
  assert.equal(pickTrackMatch({ duration: 200 }, tracks).id, 'flac'); // prefers the copy with lyrics
  const different = [
    { id: 'a', duration: 200, stemKey: 'one' },
    { id: 'b', duration: 200, stemKey: 'two' },
  ];
  assert.equal(pickTrackMatch({ duration: 200 }, different), null);
});

test('a key or BPM mismatch does not rule out the only plausible file', () => {
  const tracks = [
    { id: 'a', duration: 200, bpm: 90, key: 'Am' },
    { id: 'b', duration: 200, bpm: 0, key: '' },
  ];
  assert.equal(pickTrackMatch({ duration: 200, bpm: 128, key: 1 }, tracks), null); // nothing supports either
  assert.equal(pickTrackMatch({ duration: 200, bpm: 90, key: 0 }, tracks).id, 'a');
});

test('can guess between tied different songs, preferring lyrics then closest duration', () => {
  const tracks = [
    { id: 'a', duration: 200.3, stemKey: 'one', hasLyric: false },
    { id: 'b', duration: 200.4, stemKey: 'two', hasLyric: true },
    { id: 'c', duration: 200.1, stemKey: 'three', hasLyric: true },
  ];
  assert.equal(pickTrackMatch({ duration: 200 }, tracks), null);
  const guessed = resolveTrackMatch({ duration: 200 }, tracks, { guess: true });
  assert.equal(guessed.item.id, 'c');
  assert.equal(guessed.ambiguous, true);
});
