import test from 'node:test';
import assert from 'node:assert/strict';
import { activeLineIndex, extractTrackTitleFromMetadata, formatTime, normalizeTrackTitle, parseSyncedLyrics, titleMatches } from '../src/lyrics.mjs';

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