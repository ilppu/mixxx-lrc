// Reads Mixxx's own library database (mixxxdb.sqlite) so the app can compare the deck's duration, BPM and key
// against the same analysis Mixxx made, instead of relying on tags in the audio files.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultDbPaths() {
  const home = os.homedir();
  const candidates = [];
  if (process.env.MIXXX_DB_PATH) candidates.push(process.env.MIXXX_DB_PATH);
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Mixxx', 'mixxxdb.sqlite'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'Mixxx', 'mixxxdb.sqlite'));
  } else {
    candidates.push(path.join(home, '.mixxx', 'mixxxdb.sqlite'));
    candidates.push(path.join(home, '.var', 'app', 'org.mixxx.Mixxx', 'data', 'mixxx', 'mixxxdb.sqlite'));
  }
  return candidates.filter((candidate) => fs.existsSync(candidate));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function querySql(keyColumn) {
  return `SELECT l.artist AS artist, l.title AS title, l.duration AS duration, l.bpm AS bpm,
                 ${keyColumn} AS keyId, t.location AS path
            FROM library l JOIN track_locations t ON l.location = t.id
           WHERE l.mixxx_deleted = 0 AND t.fs_deleted = 0 AND ABS(l.duration - ?) <= ?`;
}

function queryOnce(dbPath, duration, tolerance) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    try {
      return db.prepare(querySql('l.key_id')).all(duration, tolerance);
    } catch {
      return db.prepare(querySql('0')).all(duration, tolerance); // older schema without key_id
    }
  } finally {
    db.close();
  }
}

// Returns { dbPath, rows } on success, or { dbPath: '', rows: null, error } if no database could be read.
async function findTracks(duration, { dbPaths = defaultDbPaths(), tolerance = 1 } = {}) {
  let lastError = dbPaths.length ? '' : 'Mixxx database not found (set MIXXX_DB_PATH to its location)';
  for (const dbPath of dbPaths) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return { dbPath, rows: queryOnce(dbPath, duration, tolerance) };
      } catch (error) {
        lastError = error.message;
        await wait(150); // Mixxx may be writing; try again shortly
      }
    }
  }
  return { dbPath: '', rows: null, error: lastError };
}

module.exports = { defaultDbPaths, findTracks };
