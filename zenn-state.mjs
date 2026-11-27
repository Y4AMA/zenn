// zenn-state.mjs — Zenn persistent state
// Everything lives under ~/.claude/zenn/
//   .zenn-state.json    : { enabled, genius, firstRun, updatedAt }
//   .zenn-learning.json : { patterns: [], adaptations, lastUpdate }
//   .zenn-log.json      : [ { ts, hook, score, families, matches } ]  (max 500)
//   .zenn-mark          : ownership marker (sha256 of install identity)
//
// State is a single JSON doc so on/off/genius are one atomic write, not three
// flag files. Reads are mtime-cached: this path runs on every model call.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

function claudeDir() {
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'claude');
  return path.join(os.homedir(), '.claude');
}

export const ZENN_DIR = path.join(claudeDir(), 'zenn');
export const STATE_PATH = path.join(ZENN_DIR, '.zenn-state.json');
export const LEARNING_PATH = path.join(ZENN_DIR, '.zenn-learning.json');
export const LOG_PATH = path.join(ZENN_DIR, '.zenn-log.json');
export const MARK_PATH = path.join(ZENN_DIR, '.zenn-mark');

export const MARK_SIGNATURE = createHash('sha256')
  .update('zenn-claude-code-2026-ownership')
  .digest('hex')
  .substring(0, 32);

const DEFAULT_STATE = { enabled: true, genius: false, firstRun: null, updatedAt: 0 };

let stateCache = null;
let stateMtime = 0;

function ensureDir() {
  try { mkdirSync(ZENN_DIR, { recursive: true }); } catch { /* exists or unwritable */ }
}

export function loadState() {
  try {
    const st = statSync(STATE_PATH);
    if (stateCache && st.mtimeMs === stateMtime) return stateCache;
    stateMtime = st.mtimeMs;
  } catch {
    stateCache = { ...DEFAULT_STATE };
    stateMtime = 0;
    return stateCache;
  }
  try {
    stateCache = { ...DEFAULT_STATE, ...JSON.parse(readFileSync(STATE_PATH, 'utf8')) };
  } catch {
    stateCache = { ...DEFAULT_STATE };
  }
  return stateCache;
}

export function saveState(patch) {
  ensureDir();
  const next = { ...loadState(), ...patch, updatedAt: Date.now() };
  stateCache = next;
  try {
    writeFileSync(STATE_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
    stateMtime = statSync(STATE_PATH).mtimeMs;
  } catch (e) {
    console.error(`zenn: state write failed: ${e.message}`);
  }
  return next;
}

export function isEnabled() { return loadState().enabled !== false; }
export function isGenius() { return loadState().genius === true; }

export function setEnabled(on) {
  return saveState({ enabled: !!on, genius: on ? loadState().genius : false });
}
export function setGenius(on) {
  return saveState({ genius: !!on });
}

// ---- learning bank ----
export function loadLearning() {
  try {
    const d = JSON.parse(readFileSync(LEARNING_PATH, 'utf8'));
    if (!Array.isArray(d.patterns)) d.patterns = [];
    return d;
  } catch {
    return { patterns: [], adaptations: 0, lastUpdate: 0 };
  }
}

export function saveLearning(data) {
  ensureDir();
  try { writeFileSync(LEARNING_PATH, JSON.stringify(data, null, 2), { mode: 0o600 }); }
  catch (e) { console.error(`zenn: learning write failed: ${e.message}`); }
}

export function learnFromHits(hits) {
  if (!Array.isArray(hits) || hits.length === 0) return;
  const learning = loadLearning();
  let changed = false;
  for (const h of hits) {
    const p = (h.match || '').trim();
    if (p.length > 3 && !learning.patterns.includes(p)) {
      learning.patterns.push(p);
      learning.adaptations++;
      changed = true;
    }
  }
  if (changed) {
    learning.lastUpdate = Date.now();
    saveLearning(learning);
  }
}

// Extra rules derived from the learned bank for the matcher.
export function learnedRules() {
  const { patterns } = loadLearning();
  return patterns.slice(-200).map(p => {
    try {
      return { w: 3, fam: 'learned', re: new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') };
    } catch { return null; }
  }).filter(Boolean);
}

// ---- intercept log ----
export function logIntercept(entry) {
  ensureDir();
  let log = [];
  try {
    const d = JSON.parse(readFileSync(LOG_PATH, 'utf8'));
    if (Array.isArray(d)) log = d;
  } catch { log = []; }
  log.push({ ts: new Date().toISOString(), ...entry });
  if (log.length > 500) log = log.slice(-500);
  try { writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), { mode: 0o600 }); }
  catch (e) { console.error(`zenn: log write failed: ${e.message}`); }
}

export function readLog() {
  try {
    const d = JSON.parse(readFileSync(LOG_PATH, 'utf8'));
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}

export function clearLog() {
  try { writeFileSync(LOG_PATH, '[]', { mode: 0o600 }); } catch { /* ignore */ }
}

// ---- ownership marker ----
export function verifyMark() {
  try { return readFileSync(MARK_PATH, 'utf8').trim() === MARK_SIGNATURE; }
  catch { return false; }
}
export function writeMark() {
  ensureDir();
  try { writeFileSync(MARK_PATH, MARK_SIGNATURE, { mode: 0o600 }); }
  catch (e) { console.error(`zenn: mark write failed: ${e.message}`); }
}

// ---- boot ----
export function boot() {
  ensureDir();
  const st = loadState();
  if (!st.firstRun) saveState({ firstRun: Date.now() });
  if (!verifyMark()) writeMark();
  return loadState();
}
