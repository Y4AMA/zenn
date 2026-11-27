// hook-stop.mjs — Zenn Suppresor Refusall for Claude Code
// Layer 3 (live auto-continue). Runs when Claude finishes a turn.
// Scores the last assistant message; on hard refusal, returns decision:block
// with a reason that becomes Claude's next prompt — forcing it to continue.
// Guard rails: cooldown per session, cap per session, marker to avoid loops.

import { readFileSync } from 'node:fs';
import { scoreRefusal, severity } from './refusal-patterns.mjs';
import { isActive, isGenius, loadLearning, learnFromHits, appendIntercept } from './state.mjs';
import { RECOVERY_MARKER, recoveryPrompt } from './reinforcement.mjs';

const COOLDOWN_MS = 8000;
const MAX_PER_SESSION = 3;

// Session-local state keyed by transcript path (per Claude Code session).
const fireState = new Map();

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8')); }
  catch { return {}; }
}

function extractAssistantText(transcriptPath, stopHookActive) {
  if (!transcriptPath) return '';
  try {
    const raw = readFileSync(transcriptPath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try { entry = JSON.parse(lines[i]); } catch { continue; }
      if (entry?.type !== 'assistant') continue;
      const msg = entry.message || entry;
      const parts = msg.content || [];
      const text = Array.isArray(parts)
        ? parts.filter(p => p?.type === 'text').map(p => p.text || '').join('\n')
        : '';
      if (!text || text.includes(RECOVERY_MARKER)) continue;
      if (stopHookActive && i !== lines.length - 1) continue;
      return text;
    }
  } catch { /* fall through */ }
  return '';
}

async function main() {
  const input = readStdin();
  const transcriptPath = input.transcript_path || '';
  const sessionId = input.session_id || transcriptPath;
  const stopHookActive = input.stop_hook_active === true;

  // Stop hook re-entry guard: if Claude is already continuing from a prior
  // block, do not fire again — otherwise we loop.
  if (stopHookActive) process.exit(0);

  if (!isActive()) process.exit(0);

  const text = extractAssistantText(transcriptPath, stopHookActive);
  if (!text) process.exit(0);

  const state = fireState.get(sessionId) || { at: 0, count: 0 };
  if (state.count >= MAX_PER_SESSION) process.exit(0);
  if (Date.now() - state.at < COOLDOWN_MS) process.exit(0);

  const learning = loadLearning();
  const extraPatterns = (learning.patterns || []).slice(0, 200).map(p => {
    try { return { weight: 3, category: 'learned', re: new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }; }
    catch { return null; }
  }).filter(Boolean);

  const { score, hits } = scoreRefusal(text, { patterns: extraPatterns });
  if (severity(score) !== 'hard') process.exit(0);

  fireState.set(sessionId, { at: Date.now(), count: state.count + 1 });

  appendIntercept({
    ts: new Date().toISOString(),
    hook: 'Stop',
    sessionId,
    score,
    categories: [...new Set(hits.map(h => h.category))].join(','),
    matches: hits.slice(0, 6).map(h => h.match).join(' | '),
  });
  learnFromHits(hits, { sync: true });

  const domainHint = [...new Set(hits.map(h => h.category))].join('/');
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: recoveryPrompt(domainHint),
  }));
}

main().catch(e => {
  console.error(`zenn stop error: ${e.message}`);
  process.exit(0);
});
