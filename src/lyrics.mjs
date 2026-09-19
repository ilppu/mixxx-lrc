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

export { activeLineIndex, extractTrackTitleFromMetadata, formatTime, normalizeTrackTitle, parseSyncedLyrics, titleMatches };