const LRC_PATTERN = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/;

function normalizeTrackTitle(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\-_–—:/()\[\]{}]+/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleMatches(mixxxTitle, candidateTitle) {
  const left = normalizeTrackTitle(mixxxTitle);
  const right = normalizeTrackTitle(candidateTitle);

  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  return left.includes(right) || right.includes(left);
}

function extractTrackTitleFromMetadata(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const source = payload?.icestats?.source ?? payload?.source ?? payload;
  const entries = Array.isArray(source) ? source : source ? [source] : [];

  const preferred = entries.find((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    return typeof item.mount === 'string' && item.mount.toLowerCase() === '/live';
  }) || entries.find((item) => item && typeof item.title === 'string' && item.title.trim());

  if (preferred) {
    if (typeof preferred.title === 'string' && preferred.title.trim()) {
      return preferred.title.trim();
    }
    if (typeof preferred.streamtitle === 'string' && preferred.streamtitle.trim()) {
      return preferred.streamtitle.trim();
    }
  }

  if (typeof payload.title === 'string' && payload.title.trim()) {
    return payload.title.trim();
  }

  if (typeof payload.streamtitle === 'string' && payload.streamtitle.trim()) {
    return payload.streamtitle.trim();
  }

  return '';
}

function parseSyncedLyrics(source) {
  const lines = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const match = rawLine.trim().match(LRC_PATTERN);
    if (!match) continue;

    const [, minute, second, fraction = '', text] = match;
    const milliseconds = fraction
      ? Number(fraction.padEnd(3, '0').slice(0, 3))
      : 0;
    lines.push({
      second: Number(minute) * 60 + Number(second) + milliseconds / 1000,
      text: text.trim(),
    });
  }
  return lines.sort((left, right) => left.second - right.second);
}

function activeLineIndex(lines, second) {
  let active = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].second > second) break;
    active = index;
  }
  return active;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const KEY_NAMES = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm',
];
const PITCH_CLASSES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// Camelot wheel -> [pitch class, isMinor]
const CAMELOT_MINOR = [8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1]; // 1A..12A
const CAMELOT_MAJOR = [11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4]; // 1B..12B

// Mixxx key numbers: 1-12 are C..B major, 13-24 are C..B minor, 0 is unknown.
function keyToMixxxNumber(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 && value <= 24 ? value : 0;
  }
  if (!value || typeof value !== 'string') return 0;
  const text = value.trim();

  const camelot = text.match(/^(\d{1,2})\s*([AaBb])$/);
  if (camelot) {
    const number = Number(camelot[1]);
    if (number < 1 || number > 12) return 0;
    const minor = camelot[2].toUpperCase() === 'A';
    return (minor ? 13 : 1) + (minor ? CAMELOT_MINOR : CAMELOT_MAJOR)[number - 1];
  }

  const match = text.match(/^([A-Ga-g])([#♯b♭]?)\s*(.*)$/);
  if (!match) return 0;
  let pitch = PITCH_CLASSES[match[1].toUpperCase()];
  if (match[2] === '#' || match[2] === '♯') pitch += 1;
  if (match[2] === 'b' || match[2] === '♭') pitch -= 1;
  pitch = (pitch + 12) % 12;
  const quality = match[3].trim();
  let minor;
  if (quality === '' || quality === 'M' || /^maj(or)?$/i.test(quality)) minor = false;
  else if (quality === 'm' || /^min(or)?$/i.test(quality)) minor = true;
  else return 0;
  return (minor ? 13 : 1) + pitch;
}

function keyLabel(number) {
  return KEY_NAMES[number - 1] || '';
}

function bpmClose(left, right) {
  const tolerance = Math.max(1, left * 0.01);
  return [1, 2, 0.5].some((factor) => Math.abs(left - right * factor) <= tolerance);
}

// deck: { duration, bpm, key }.  candidates: [{ duration, bpm, key, hasLyric, tagKey, stemKey }]
// (0 / '' / false = unknown). Duration narrows the list; BPM and key only add score, they never rule a
// file out, because tags often come from other software and can disagree with Mixxx's analysis.
// Files that are the same song (same tags or same file name, e.g. an mp3 and a flac copy) count as one
// answer, so duplicates don't make a match ambiguous. Returns a candidate or null.
function resolveTrackMatch(deck, candidates, { durationTolerance = 0.5, guess = false } = {}) {
  const none = { item: null, ambiguous: false };
  if (!deck?.duration || !Array.isArray(candidates)) return none;
  const close = candidates.filter((item) => item.duration > 0 && Math.abs(item.duration - deck.duration) <= durationTolerance);
  if (close.length === 0) return none;
  if (close.length === 1) return { item: close[0], ambiguous: false };

  const deckKey = keyToMixxxNumber(deck.key);
  const scored = close.map((item) => {
    let score = 0;
    if (deck.bpm > 0 && item.bpm > 0 && bpmClose(deck.bpm, item.bpm)) score += 1;
    const itemKey = keyToMixxxNumber(item.key);
    if (deckKey && itemKey && deckKey === itemKey) score += 1;
    return { item, score };
  });

  const best = Math.max(...scored.map((entry) => entry.score));
  const top = scored.filter((entry) => entry.score === best).map((entry) => entry.item);
  if (top.length === 1) return { item: top[0], ambiguous: false };

  const sameSong = (left, right) => (
    (left.tagKey && left.tagKey === right.tagKey) || (left.stemKey && left.stemKey === right.stemKey)
  );
  if (top.every((item) => sameSong(top[0], item))) {
    return { item: top.find((item) => item.hasLyric) || top[0], ambiguous: false };
  }
  if (!guess) return { item: null, ambiguous: true };

  // Still tied between different songs: prefer one that has lyrics, then the closest duration.
  const ranked = [...top].sort((left, right) => (
    (Number(Boolean(right.hasLyric)) - Number(Boolean(left.hasLyric)))
    || (Math.abs(left.duration - deck.duration) - Math.abs(right.duration - deck.duration))
  ));
  return { item: ranked[0], ambiguous: true };
}

function pickTrackMatch(deck, candidates, options) {
  return resolveTrackMatch(deck, candidates, options).item;
}

export { keyLabel, keyToMixxxNumber, pickTrackMatch, resolveTrackMatch, activeLineIndex, extractTrackTitleFromMetadata, formatTime, normalizeTrackTitle, parseSyncedLyrics, titleMatches };