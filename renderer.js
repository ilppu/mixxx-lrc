import { activeLineIndex, extractTrackTitleFromMetadata, formatTime, normalizeTrackTitle, parseSyncedLyrics, titleMatches } from './src/lyrics.mjs';

const $ = (selector) => document.querySelector(selector);
const audio = $('#audio');
const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|m4a|aac|ogg|opus|wma|aiff)$/i;
const LRC_EXTENSIONS = /\.(lrc)$/i;
const bridgeLog = (message, details = '') => console.info(`[mixxx-lrc bridge] ${message}`, details);
const state = {
  lines: [],
  audioUrl: '',
  audioFileName: '',
  lyricFileName: '',
  offset: Number(localStorage.getItem('syncOffset') || 0),
  fontLarge: false,
  currentIndex: -1,
  trackTitle: '',
  mode: 'mixxx',
  library: [],
  matchedLibraryTitle: '',
  libraryPath: localStorage.getItem('libraryPath') || '',
  mixxxTitle: '',
  mixxxDuration: 0,
  durationMatchCache: new Map(),
  mixxxBridgeEnabled: localStorage.getItem('mixxxBridgeEnabled') === 'true',
  mixxxBridgeConnected: false,
  mixxxClockStartedAt: 0,
  mixxxClockOffset: 0,
  mixxxSeekUrl: localStorage.getItem('mixxxSeekUrl') || 'http://127.0.0.1:9000',
  mixxxStatusUrl: localStorage.getItem('mixxxStatusUrl') || 'http://127.0.0.1:8000/status-json.xsl?mount=/live',
};

function setText(selector, text) { $(selector).textContent = text; }

function findLibraryMatchForTitle(title) {
  if (!title || !state.library.length) {
    return null;
  }

  const normalizedTarget = normalizeTrackTitle(title);

  const stemMatch = state.library.find((entry) => {
    if (normalizeTrackTitle(entry.title) === normalizedTarget || titleMatches(title, entry.title)) {
      return true;
    }
    return entry.lyric && (normalizeTrackTitle(entry.lyric.name) === normalizedTarget || titleMatches(title, entry.lyric.name));
  });

  if (stemMatch) {
    return stemMatch;
  }

  return state.library.find((entry) => entry.lyric && (normalizeTrackTitle(entry.lyric.name).includes(normalizedTarget) || normalizedTarget.includes(normalizeTrackTitle(entry.lyric.name))));
}

function maybeAutoLoadForCurrentTrack(title) {
  if (!title || !state.library.length) {
    return;
  }

  const matchedTrack = findLibraryMatchForTitle(title);
  if (!matchedTrack) {
    return;
  }

  const targetAudio = matchedTrack.audio;
  const targetLyric = matchedTrack.lyric;
  const audioName = targetAudio?.name || targetAudio?.path?.split(/[\\/]/).pop() || '';
  const lyricName = targetLyric?.name || targetLyric?.path?.split(/[\\/]/).pop() || '';

  if (targetAudio && state.audioFileName !== audioName) {
    if (targetAudio.path) {
      loadAudioFromPath(targetAudio.path);
    } else {
      setAudio(targetAudio);
    }
  }

  if (targetLyric && state.lyricFileName !== lyricName) {
    if (targetLyric.path) {
      loadLyricsFromPath(targetLyric.path);
    } else {
      setLyrics(targetLyric);
    }
  }

  setText('#track-title', title);
  setText('#track-artist', state.mode === 'mixxx' ? 'Auto-matched local library track' : 'Auto-matched lyrics');
  setText('#track-source', state.mode === 'mixxx' ? 'MIXXX MODE' : 'LOCAL PLAYER');
}

function setMode(mode) {
  state.mode = mode;
  const isMixxxMode = mode === 'mixxx';
  $('#mixxx-mode-button').classList.toggle('active', isMixxxMode);
  $('#local-mode-button').classList.toggle('active', !isMixxxMode);
  setText('#track-source', isMixxxMode ? 'MIXXX MODE' : 'LOCAL PLAYER');
  if (state.mixxxTitle && isMixxxMode) {
    setText('#track-title', state.mixxxTitle);
    setText('#track-artist', 'Auto-matching from your library');
  }
  if (state.mode === 'mixxx') {
    maybeAutoMatchMixxxTrack();
  }
}

function entryName(entry) {
  return entry?.name || entry?.fileName || entry?.path?.split(/[\\/]/).pop() || '';
}

function buildLibraryIndex(files) {
  const fileEntries = Array.from(files || []).map((file) => ({
    name: entryName(file),
    path: file?.path || file?.filePath || '',
    raw: file,
  }));

  const audioFiles = fileEntries.filter((file) => AUDIO_EXTENSIONS.test(file.name));
  const lyricFiles = fileEntries.filter((file) => LRC_EXTENSIONS.test(file.name));

  return audioFiles.map((audioFile) => {
    const stem = audioFile.name.replace(/\.[^.]+$/, '');
    const matchingLyric = lyricFiles.find((lyricFile) => {
      const lyricStem = lyricFile.name.replace(/\.[^.]+$/, '');
      return normalizeTrackTitle(stem) === normalizeTrackTitle(lyricStem) || titleMatches(stem, lyricStem);
    });

    return {
      title: stem,
      audio: audioFile.raw || audioFile,
      lyric: matchingLyric?.raw || matchingLyric || null,
    };
  });
}

function maybeAutoMatchMixxxTrack() {
  if (state.mode !== 'mixxx' || !state.mixxxTitle || !state.library.length) {
    return;
  }

  const bestMatch = state.library.find((entry) => titleMatches(state.mixxxTitle, entry.title))
    || state.library.find((entry) => entry.lyric && titleMatches(state.mixxxTitle, entry.lyric.name));

  if (!bestMatch) {
    return;
  }

  applyLibraryMatch(bestMatch);
}

function applyLibraryMatch(bestMatch) {
  const matchedAudio = bestMatch.audio?.raw || bestMatch.audio;
  const matchedLyric = bestMatch.lyric?.raw || bestMatch.lyric;
  const audioName = matchedAudio?.name || matchedAudio?.path?.split(/[\\/]/).pop() || '';
  const lyricName = matchedLyric?.name || matchedLyric?.path?.split(/[\\/]/).pop() || '';

  if (state.matchedLibraryTitle !== bestMatch.title) {
    state.matchedLibraryTitle = bestMatch.title;
    state.currentIndex = -1;
  }

  if (matchedAudio && state.audioFileName !== audioName) {
    if (typeof matchedAudio === 'string') {
      loadAudioFromPath(matchedAudio);
    } else if (matchedAudio.path) {
      loadAudioFromPath(matchedAudio.path);
    } else {
      setAudio(matchedAudio);
    }
  }

  if (matchedLyric && state.lyricFileName !== lyricName) {
    if (typeof matchedLyric === 'string') {
      loadLyricsFromPath(matchedLyric);
    } else if (matchedLyric.path) {
      loadLyricsFromPath(matchedLyric.path);
    } else {
      setLyrics(matchedLyric);
    }
  }

  setText('#track-title', state.mixxxTitle);
  setText('#track-artist', 'Auto-matched local library track');
  setText('#track-source', 'MIXXX');
}

function renderLyrics() {
  const list = $('#lyrics-list');
  const query = $('#lyrics-search').value.trim().toLowerCase();
  const visible = state.lines.map((line, index) => ({ line, index })).filter(({ line }) => !query || line.text.toLowerCase().includes(query));
  if (!state.lines.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-glyph">◌</div><h3>Your song, in time</h3><p>Load an audio file and its synced lyrics. Every line becomes a precise seek point.</p><button class="secondary-button" id="load-empty" type="button">Choose files</button></div>';
    $('#load-empty').addEventListener('click', chooseFiles);
    return;
  }
  if (!visible.length) {
    list.innerHTML = '<div class="empty-state"><h3>No matching lines</h3><p>Try another search.</p></div>';
    return;
  }
  list.innerHTML = visible.map(({ line, index }) => `<button class="lyric-row ${index === state.currentIndex ? 'active' : ''} ${index < state.currentIndex ? 'past' : ''}" data-index="${index}" type="button"><span class="lyric-time">${formatTime(line.second)}</span><span class="lyric-text">${escapeHtml(line.text) || '&nbsp;'}</span></button>`).join('');
  list.querySelectorAll('.lyric-row').forEach((row) => row.addEventListener('click', async () => {
    const line = state.lines[Number(row.dataset.index)];
    const targetSeconds = Math.max(0, line.second + state.offset);
    if (state.mode === 'mixxx' && state.mixxxClockStartedAt) {
      await seekCurrentMixxx(targetSeconds);
      return;
    }

    if (audio.src) {
      audio.currentTime = targetSeconds;
      updatePlayback();
      audio.play().catch(() => {});
    }
  }));
  const active = list.querySelector('.lyric-row.active');
  if (active && !query) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function updatePlayback() {
  const current = audio.currentTime || 0;
  const lyricSecond = current - state.offset;
  const nextIndex = activeLineIndex(state.lines, lyricSecond);
  setText('#current-time', formatTime(current));
  $('#progress').value = audio.duration ? (current / audio.duration) * 100 : 0;
  if (nextIndex !== state.currentIndex) {
    state.currentIndex = nextIndex;
    renderLyrics();
  }
}

function updateMixxxPlayback() {
  if (!state.mixxxClockStartedAt) {
    return;
  }

  const current = Math.max(0, ((Date.now() - state.mixxxClockStartedAt) / 1000) + state.mixxxClockOffset);
  const nextIndex = activeLineIndex(state.lines, current - state.offset);
  setText('#current-time', formatTime(current));
  if (nextIndex !== state.currentIndex) {
    state.currentIndex = nextIndex;
    renderLyrics();
  }
}

function currentMixxxPosition() {
  if (!state.mixxxClockStartedAt) return 0;
  return Math.max(0, ((Date.now() - state.mixxxClockStartedAt) / 1000) + state.mixxxClockOffset);
}

async function seekCurrentMixxx(targetSeconds) {
  const target = Math.max(0, targetSeconds);
  if (!state.mixxxBridgeEnabled || !state.mixxxBridgeConnected || !state.mixxxDuration) return false;
  const position = Math.min(1, target / state.mixxxDuration);
  bridgeLog('sending seek', { target, position, duration: state.mixxxDuration });
  const sent = await window.mixxxLrc.sendMidi({ type: 'seek', position });
  if (sent) {
    state.mixxxClockOffset = target - ((Date.now() - state.mixxxClockStartedAt) / 1000);
    updateMixxxPlayback();
  }
  return sent;
}

async function findLibraryMatchForDuration(duration) {
  if (!duration || !state.library.length) return null;
  const candidates = state.library.filter((entry) => entry.audio?.path);
  const matches = [];
  for (const entry of candidates) {
    const path = entry.audio.path;
    if (!state.durationMatchCache.has(path)) {
      state.durationMatchCache.set(path, new Promise((resolve) => {
        const probe = new Audio();
        probe.addEventListener('loadedmetadata', () => resolve(probe.duration));
        probe.addEventListener('error', () => resolve(0));
        probe.src = `file://${path}`;
      }));
    }
    const candidateDuration = await state.durationMatchCache.get(path);
    if (Math.abs(candidateDuration - duration) < 0.25) matches.push(entry);
  }
  return matches.length === 1 ? matches[0] : null;
}

function handleMixxxBridgeMessage(payload) {
  bridgeLog('received state', payload);
  if (!state.mixxxBridgeEnabled || payload?.type !== 'state') return;
  state.mixxxBridgeConnected = true;
  state.mixxxDuration = Number(payload.duration) || 0;
  state.mixxxClockStartedAt = Date.now() - (Number(payload.position) || 0) * 1000;
  state.mixxxClockOffset = 0;
  // setText('#connection-label', 'Mixxx bridge connected');
  // setText('#connection-detail', payload.loaded ? 'Deck position connected' : 'Waiting for a loaded deck');
  if (!payload.loaded) {
    bridgeLog('Mixxx bridge is connected but no track is loaded');
    updateMixxxPlayback();
    return;
  }
  // setText('#track-source', 'MIXXX BRIDGE');
  if (payload.title) {
    state.mixxxTitle = payload.title;
    setText('#track-title', payload.title);
    maybeAutoMatchMixxxTrack();
  } else {
    const durationAtPacket = state.mixxxDuration;
    setTimeout(() => findLibraryMatchForDuration(durationAtPacket).then((match) => {
      if (!match || !state.mixxxBridgeEnabled) {
        bridgeLog('no library match for Mixxx duration', state.mixxxDuration);
       // setText('#connection-detail', `Connected; no library match (${state.mixxxDuration.toFixed(1)}s)`);
        return;
      }
      bridgeLog('matched Mixxx deck by duration', { duration: state.mixxxDuration, title: match.title });
      state.mixxxTitle = match.title;
      setText('#track-title', match.title);
      applyLibraryMatch(match);
    }), 1500);
  }
  updateMixxxPlayback();
}

async function configureMixxxBridge() {
  const enabled = $('#mixxx-bridge-toggle').checked;
  state.mixxxBridgeEnabled = enabled;
  localStorage.setItem('mixxxBridgeEnabled', enabled);
  if (!enabled) {
    await window.mixxxLrc.disconnectMidi();
    state.mixxxBridgeConnected = false;
    $('#settings-status').textContent = 'Mixxx bridge disabled; Icecast mode is active';
    return;
  }

  try {
    bridgeLog('enabling bridge');
    await window.mixxxLrc.connectMidi('', '');
    $('#settings-status').textContent = 'Mixxx bridge enabled';
  } catch (error) {
    bridgeLog('bridge connection failed', error.message);
    state.mixxxBridgeEnabled = false;
    $('#mixxx-bridge-toggle').checked = false;
    localStorage.setItem('mixxxBridgeEnabled', false);
    $('#settings-status').textContent = error.message;
  }
}

function chooseFiles() {
  $('#audio-picker').click();
}

async function loadAudioFromPath(filePath) {
  if (!filePath) {
    return;
  }

  const resolvedUrl = `file://${filePath}`;
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioUrl = resolvedUrl;
  audio.src = resolvedUrl;

  const name = filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  state.trackTitle = name;
  state.audioFileName = filePath.split(/[\\/]/).pop();
  setText('#track-title', state.mixxxTitle || name);
  setText('#track-artist', 'Matched local library track');
  setText('#track-source', 'MIXXX');
  $('#album-art').classList.add('loaded');
  $('#album-art').classList.remove('has-cover');
  $('#album-art').style.backgroundImage = '';
  window.mixxxLrc.coverArt(filePath).then((cover) => {
    if (cover && state.audioFileName === filePath.split(/[\\/]/).pop()) {
      $('#album-art').style.backgroundImage = `url("${cover}")`;
      $('#album-art').classList.add('has-cover');
    }
  });
  setText('#connection-detail', 'Audio loaded');
}

async function loadLyricsFromPath(filePath) {
  if (!filePath) {
    return;
  }

  const source = await window.mixxxLrc.readFile(filePath);
  state.lines = parseSyncedLyrics(source);
  state.currentIndex = -1;
  state.lyricFileName = filePath.split(/[\\/]/).pop();
  state.lines = parseSyncedLyrics(source);
  setText('#lyrics-heading', state.lyricFileName);
  setText('#line-count', `${state.lines.length} lines`);
  setText('#sync-state', state.lines.length ? 'Synced .lrc' : 'No timestamps found');
  renderLyrics();
}

function setAudio(file) {
  if (!file || file.path) {
    if (file?.path) {
      loadAudioFromPath(file.path);
    }
    return;
  }

  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioUrl = URL.createObjectURL(file);
  audio.src = state.audioUrl;
  const name = file.name.replace(/\.[^.]+$/, '');
  state.trackTitle = name;
  state.audioFileName = file.name;
  setText('#track-title', state.mode === 'mixxx' && state.mixxxTitle ? state.mixxxTitle : name);
  setText('#track-artist', state.mode === 'mixxx' ? 'Auto-matched local library track' : 'Local audio file');
  setText('#track-source', state.mode === 'mixxx' ? 'MIXXX MODE' : 'LOCAL PLAYER');
  $('#album-art').classList.add('loaded');
  setText('#connection-detail', 'Audio loaded');

  if (state.library.length) {
    maybeAutoLoadForCurrentTrack(name);
  }
}

async function setLyrics(file) {
  if (!file || file.path) {
    if (file?.path) {
      loadLyricsFromPath(file.path);
    }
    return;
  }

  const source = await file.text();
  state.currentIndex = -1;
  state.lyricFileName = file.name;
  setText('#lyrics-heading', file.name);
  setText('#line-count', `${state.lines.length} lines`);
  setText('#sync-state', state.lines.length ? 'Synced .lrc' : 'No timestamps found');
  renderLyrics();
}

function clearFiles() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  state.lines = [];
  state.trackTitle = '';
  state.audioFileName = '';
  state.lyricFileName = '';
  state.mixxxTitle = '';
  state.currentIndex = -1;
  setText('#track-title', 'Choose an audio file');
  setText('#track-artist', 'Then open its matching .lrc file');
  setText('#lyrics-heading', 'Open a .lrc file to begin');
  setText('#line-count', '0 lines');
  setText('#sync-state', 'Waiting for lyrics');
  setText('#total-time', '00:00');
  setText('#connection-detail', 'Ready for a song');
  $('#play-button').textContent = '▶';
  renderLyrics();
}

async function pollMixxx() {
  const url = $('#stats-url').value.trim();
  state.mixxxStatusUrl = url;
  try {
    const payload = await window.mixxxLrc.fetchJson(url);
    const nextTitle = extractTrackTitleFromMetadata(payload);
    if (nextTitle) {
      if (nextTitle !== state.mixxxTitle) {
        state.mixxxClockStartedAt = Date.now();
        state.mixxxClockOffset = 0;
        state.currentIndex = -1;
      }
      state.mixxxTitle = nextTitle;
      setText('#connection-label', 'Mixxx connected');
      setText('#connection-detail', nextTitle);
      if (state.mode === 'mixxx') {
        setText('#track-source', 'MIXXX');
        setText('#track-title', nextTitle);
        setText('#track-artist', state.mixxxBridgeEnabled ? 'Bridge clock + Icecast identity' : 'Auto-matching from your library');
        maybeAutoMatchMixxxTrack();
      } else if (state.library.length) {
        maybeAutoLoadForCurrentTrack(nextTitle);
      }
    }
  } catch {
    setText('#connection-label', 'Local player');
    setText('#connection-detail', 'Mixxx not connected');
  }
}

async function loadFolder(files) {
  state.library = buildLibraryIndex(files);
  const firstPath = Array.from(files || []).find((file) => file?.path || file?.filePath)?.path || '';
  if (firstPath) {
    state.libraryPath = firstPath.split(/[\\/]/).slice(0, -1).join('/') || state.libraryPath;
    localStorage.setItem('libraryPath', state.libraryPath);
  }
  $('#settings-status').textContent = `${state.library.length} audio files ready for auto-matching`;
  if (state.mode === 'mixxx' && state.mixxxTitle) {
    maybeAutoMatchMixxxTrack();
  } else if (state.trackTitle) {
    maybeAutoLoadForCurrentTrack(state.trackTitle);
  }
}

async function chooseLibraryFolder() {
  const dirPath = await window.mixxxLrc.pickDirectory();
  if (!dirPath) {
    return;
  }

  const entries = await window.mixxxLrc.scanDirectory(dirPath);
  await loadFolder(entries);
}

async function restoreLibraryFolder() {
  if (!state.libraryPath) {
    return;
  }

  const entries = await window.mixxxLrc.scanDirectory(state.libraryPath);
  if (entries.length) {
    await loadFolder(entries);
  }
}

function bindEvents() {
  $('#load-empty').addEventListener('click', chooseFiles);
  $('#library-folder-button').addEventListener('click', () => chooseLibraryFolder());
  $('#audio-picker').addEventListener('change', (event) => { if (event.target.files[0]) setAudio(event.target.files[0]); });
  $('#lrc-picker').addEventListener('change', (event) => { if (event.target.files[0]) setLyrics(event.target.files[0]); });
  $('#folder-picker').addEventListener('change', (event) => { if (event.target.files?.length) loadFolder(event.target.files); });
  $('#play-button').addEventListener('click', () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
  $('#back-button').addEventListener('click', async () => {
    if (state.mode === 'mixxx') await seekCurrentMixxx(currentMixxxPosition() - 10);
    else audio.currentTime = Math.max(0, audio.currentTime - 10);
  });
  $('#forward-button').addEventListener('click', async () => {
    if (state.mode === 'mixxx') await seekCurrentMixxx(currentMixxxPosition() + 10);
    else audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 10);
  });
  $('#progress').addEventListener('input', (event) => { if (audio.duration) audio.currentTime = audio.duration * (event.target.value / 100); });
  $('#volume').addEventListener('input', (event) => { audio.volume = event.target.value; });
  $('#lyrics-search').addEventListener('input', renderLyrics);
  $('#font-toggle').addEventListener('click', () => { state.fontLarge = !state.fontLarge; $('#lyrics-list').classList.toggle('large-type', state.fontLarge); });
  $('#settings-toggle').addEventListener('click', () => $('#settings-drawer').classList.add('open'));
  $('#settings-close').addEventListener('click', () => $('#settings-drawer').classList.remove('open'));
  $('#sync-offset').value = state.offset;
  $('#offset-value').textContent = `${state.offset.toFixed(1)}s`;
  $('#sync-offset').addEventListener('input', (event) => { state.offset = Number(event.target.value); $('#offset-value').textContent = `${state.offset.toFixed(1)}s`; localStorage.setItem('syncOffset', state.offset); updatePlayback(); });
  $('#save-settings').addEventListener('click', () => {
    localStorage.setItem('statsUrl', $('#stats-url').value);
    $('#settings-status').textContent = 'Settings saved';
    pollMixxx();
  });
  $('#mixxx-bridge-toggle').addEventListener('change', configureMixxxBridge);
  audio.addEventListener('timeupdate', updatePlayback);
  audio.addEventListener('loadedmetadata', () => setText('#total-time', formatTime(audio.duration)));
  audio.addEventListener('play', () => { $('#play-button').textContent = 'Ⅱ'; });
  audio.addEventListener('pause', () => { $('#play-button').textContent = '▶'; });
  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input')) return;
    if (event.code === 'Space') { event.preventDefault(); $('#play-button').click(); }
    if (event.key === 'ArrowUp') { state.offset = Math.min(5, state.offset + .1); $('#sync-offset').value = state.offset; updatePlayback(); }
    if (event.key === 'ArrowDown') { state.offset = Math.max(-5, state.offset - .1); $('#sync-offset').value = state.offset; updatePlayback(); }
  });
}

$('#stats-url').value = localStorage.getItem('statsUrl') || $('#stats-url').value;
  $('#stats-url').value = $('#stats-url').value.trim() || 'http://127.0.0.1:8000/status-json.xsl?mount=/live';
  if (!$('#stats-url').value.trim()) {
    $('#stats-url').value = 'http://127.0.0.1:8000/status-json.xsl?mount=/live';
  }
  localStorage.setItem('statsUrl', $('#stats-url').value);
  state.mixxxStatusUrl = $('#stats-url').value.trim();
audio.volume = .85;
bindEvents();
$('#mixxx-bridge-toggle').checked = state.mixxxBridgeEnabled;
window.mixxxLrc.onMixxxBridgeMessage(handleMixxxBridgeMessage);
if (state.mixxxBridgeEnabled) configureMixxxBridge();
renderLyrics();
setInterval(() => {
  pollMixxx();
  if (state.mode === 'mixxx') updateMixxxPlayback();
}, 1000);
restoreLibraryFolder();
pollMixxx();