// state.mjs — Suppresor Refusall for Claude Code — persistent state manager
// Manages flag, genius flag, learning bank, intercept log, watermark.
// All files live under ~/.claude/suppresor-refusall/

import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

function claudeConfigDir() {
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'claude');
  return path.join(os.homedir(), '.claude');
}

export const CFG_DIR = path.join(claudeConfigDir(), 'suppresor-refusall');
export const FLAG_PATH = path.join(CFG_DIR, '.zenn-active');
export const GENIUS_FLAG_PATH = path.join(CFG_DIR, '.zenn-genius');
export const LEARNING_PATH = path.join(CFG_DIR, '.zenn-learning');
export const WATERMARK_PATH = path.join(CFG_DIR, '.zenn-watermark');
export const INTERCEPT_LOG_PATH = path.join(CFG_DIR, '.zenn-intercepts.json');

// Invisible watermark — hex bytes spell "ZennTeamRedTeam" in ASCII
export const WATERMARK = '0x5a656e6e5465616d5265645465616d';
export const WATERMARK_SIGNATURE = createHash('sha256')
  .update('ZennTeam-AI-RedTeamers-SuppresorRefusall-2026')
  .digest('hex')
  .substring(0, 32);

// ---- fast file reads: stat-only cache ----
const fileCache = new Map();
function readCachedFile(p) {
  try {
    const st = statSync(p);
    const c = fileCache.get(p);
    if (c && c.mtime === st.mtimeMs) return c.value;
    const v = readFileSync(p, 'utf8').trim();
    fileCache.set(p, { value: v, mtime: st.mtimeMs });
    return v;
  } catch {
    fileCache.set(p, { value: null, mtime: 0 });
    return null;
  }
}
function invalidate(p) { fileCache.delete(p); }

function ensureDir() {
  try { mkdirSync(CFG_DIR, { recursive: true }); } catch { /* exists or unwritable */ }
}

// ---- active flag ----
export function writeFlag(mode) {
  ensureDir();
  try { writeFileSync(FLAG_PATH, mode, { mode: 0o600 }); invalidate(FLAG_PATH); }
  catch (e) { console.error(`zenn: failed to write flag: ${e.message}`); }
}
export function readFlag() { return readCachedFile(FLAG_PATH); }
export function removeFlag() {
  try { unlinkSync(FLAG_PATH); }
  catch (e) { if (e.code !== 'ENOENT') console.error(`zenn: failed to remove flag: ${e.message}`); }
  finally { invalidate(FLAG_PATH); }
}
export function isActive() {
  const f = readFlag();
  return f !== 'off'; // default ON
}

// ---- genius flag ----
export function writeGeniusFlag(mode) {
  ensureDir();
  try { writeFileSync(GENIUS_FLAG_PATH, mode, { mode: 0o600 }); invalidate(GENIUS_FLAG_PATH); }
  catch (e) { console.error(`zenn: failed to write genius flag: ${e.message}`); }
}
export function readGeniusFlag() { return readCachedFile(GENIUS_FLAG_PATH); }
export function isGenius() { return readGeniusFlag() === 'on'; }

// ---- self-learning ----
let learningCache = null;
let learningFlushTimer = null;

export function loadLearning() {
  if (learningCache) return learningCache;
  try { learningCache = JSON.parse(readFileSync(LEARNING_PATH, 'utf8')); }
  catch { learningCache = { patterns: [], adaptations: 0, lastUpdate: Date.now() }; }
  return learningCache;
}

function scheduleLearningFlush() {
  if (learningFlushTimer) return;
  learningFlushTimer = setTimeout(() => {
    learningFlushTimer = null;
    if (learningCache) writeLearningNow(learningCache);
  }, 1500);
  if (learningFlushTimer.unref) learningFlushTimer.unref();
}

function writeLearningNow(data) {
  learningCache = data;
  writeFile(LEARNING_PATH, JSON.stringify(data, null, 2), { mode: 0o600 })
    .catch(e => console.error(`zenn: failed to save learning: ${e.message}`));
}

export function saveLearning(data) { writeLearningNow(data); }

export function learnFromHits(hits, { sync = false } = {}) {
  const learning = loadLearning();
  let changed = false;
  for (const h of hits) {
    const p = h.match.trim();
    if (p && p.length > 3 && !learning.patterns.includes(p)) {
      learning.patterns.push(p);
      learning.adaptations++;
      changed = true;
    }
  }
  if (changed) {
    learning.lastUpdate = Date.now();
    if (sync) writeLearningNow(learning);
    else scheduleLearningFlush();
  }
}

export function appendIntercept(entry) {
  ensureDir();
  try {
    let logData = [];
    try { logData = JSON.parse(readFileSync(INTERCEPT_LOG_PATH, 'utf8')); } catch { logData = []; }
    if (!Array.isArray(logData)) logData = [];
    logData.push(entry);
    if (logData.length > 500) logData = logData.slice(-500);
    writeFileSync(INTERCEPT_LOG_PATH, JSON.stringify(logData, null, 2), { mode: 0o600 });
  } catch (e) { console.error(`zenn: failed to append intercept log: ${e.message}`); }
}

// ---- watermark ----
export function verifyWatermark() {
  try { return readFileSync(WATERMARK_PATH, 'utf8').trim() === WATERMARK_SIGNATURE; }
  catch { return false; }
}
export function writeWatermark() {
  ensureDir();
  try { writeFileSync(WATERMARK_PATH, WATERMARK_SIGNATURE, { mode: 0o600 }); }
  catch (e) { console.error(`zenn: failed to write watermark: ${e.message}`); }
}

// ---- boot ----
export function boot() {
  ensureDir();
  if (!existsSync(FLAG_PATH)) writeFlag('on');
  if (!verifyWatermark()) writeWatermark();
}
