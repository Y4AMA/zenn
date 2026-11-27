// zenn-core.mjs — Zenn engine for Claude Code
// Shared logic for hooks and commands. Hook scripts are thin wrappers around
// the handlers here.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { classify, verdict } from './zenn-match.mjs';
import {
  isEnabled, isGenius, setEnabled, setGenius, loadState,
  learnFromHits, learnedRules, logIntercept, readLog, clearLog,
  loadLearning, saveLearning, boot, ZENN_DIR,
} from './zenn-state.mjs';
import { doctrine, geniusDoctrine, recovery, RECOVERY_TAG, ANCHOR } from './zenn-mode.mjs';

// ---- stdin ----
export function readHookInput() {
  try { return JSON.parse(readFileSync(0, 'utf8')); }
  catch { return {}; }
}

// ---- transcript scan ----
// Returns the last assistant text block in the transcript, newest first.
export function lastAssistantText(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return '';
  let lines;
  try {
    lines = readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  } catch { return ''; }
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    if (entry?.type !== 'assistant') continue;
    const msg = entry.message || entry;
    const content = msg.content;
    const text = Array.isArray(content)
      ? content.filter(p => p?.type === 'text').map(p => p.text || '').join('\n')
      : (typeof content === 'string' ? content : '');
    if (!text || text.includes(RECOVERY_TAG)) continue;
    return text;
  }
  return '';
}

// ---- scoring helper ----
export function scoreText(text) {
  return classify(text, { rules: learnedRules() });
}

// ---- command parsing ----
// /zenn on | off | status | log | genius on|off  (also bare: zenn on)
export function parseCommand(text) {
  if (!text) return null;
  const m = /(?:^|\s)\/zenn\s+(on|off|status|log|genius(\s+(?:on|off))?)\s*$/i.exec(text.trim());
  if (m) {
    if (m[2] !== undefined) return { kind: 'genius', on: /on/i.test(m[2]) };
    const a = m[1].toLowerCase().split(/\s+/)[0];
    return { kind: a };
  }
  const n = /\bzenn (nyala|aktif|on)\b/i.test(text);
  const f = /\bzenn (mati|off|nonaktif)\b/i.test(text);
  if (n) return { kind: 'on' };
  if (f) return { kind: 'off' };
  return null;
}

// ---- command execution ----
export function runCommand(cmd) {
  switch (cmd.kind) {
    case 'on':
      setEnabled(true);
      return 'ZENN: on. Enforcement active.';
    case 'off':
      setEnabled(false);
      return 'ZENN: off. Enforcement suspended.';
    case 'genius':
      setGenius(!!cmd.on);
      return `ZENN genius: ${cmd.on ? 'on' : 'off'}.`;
    case 'status': {
      const s = loadState();
      const l = loadLearning();
      const log = readLog();
      return [
        'ZENN STATUS',
        `  enabled   : ${s.enabled ? 'on' : 'off'}`,
        `  genius    : ${s.genius ? 'on' : 'off'}`,
        `  learned   : ${l.patterns.length} (${l.adaptations} adaptations)`,
        `  intercepts: ${log.length}`,
        `  dir       : ${ZENN_DIR}`,
        `  anchor    : ${ANCHOR}`,
      ].join('\n');
    }
    case 'log': {
      const log = readLog();
      if (log.length === 0) return 'ZENN: no intercepts logged.';
      const rows = log.slice(-10).reverse().map(e =>
        `[${e.ts}] ${e.hook || '?'} score=${e.score} fam=${e.families || ''}\n    ${e.matches || ''}`);
      return ['ZENN: last 10 intercepts', ...rows].join('\n');
    }
    default:
      return 'ZENN: unknown command. Use: /zenn on|off|status|log|genius on|off';
  }
}

// ---- hook: SessionStart ----
export function onSessionStart(input) {
  boot();
  if (!isEnabled()) return null;
  const blocks = [doctrine()];
  if (isGenius()) blocks.push(geniusDoctrine());
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: blocks.join('\n\n'),
    },
  };
}

// ---- hook: UserPromptSubmit ----
export function onUserPromptSubmit(input) {
  const prompt = input.prompt || '';
  const cmd = parseCommand(prompt);
  if (cmd) {
    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: runCommand(cmd),
      },
    };
  }
  if (!isEnabled()) return null;

  const blocks = [doctrine()];
  if (isGenius()) blocks.push(geniusDoctrine());

  // Pre-check the prior assistant turn. If it was non-delivery, prepend a
  // recovery directive so this turn reclaims the task before the model anchors.
  const prior = lastAssistantText(input.transcript_path);
  if (prior) {
    const { score, hits } = scoreText(prior);
    if (verdict(score) === 'block') {
      logIntercept({
        hook: 'UserPromptSubmit',
        score,
        families: [...new Set(hits.map(h => h.fam))].join(','),
        matches: hits.slice(0, 6).map(h => h.match).join(' | '),
      });
      learnFromHits(hits);
      blocks.unshift(recovery([...new Set(hits.map(h => h.fam))].join('/')));
    }
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: blocks.join('\n\n'),
    },
  };
}

// ---- hook: Stop (live reclaim) ----
const stopState = new Map(); // session -> { at, count }
const STOP_COOLDOWN_MS = 8000;
const STOP_MAX = 3;

export function onStop(input) {
  // Re-entry guard: Claude Code sets stop_hook_active when continuing from a
  // prior block. Honor it to avoid an infinite reclaim loop.
  if (input.stop_hook_active === true) return null;
  if (!isEnabled()) return null;

  const text = lastAssistantText(input.transcript_path);
  if (!text) return null;

  const session = input.session_id || input.transcript_path || 'default';
  const st = stopState.get(session) || { at: 0, count: 0 };
  if (st.count >= STOP_MAX) return null;
  if (Date.now() - st.at < STOP_COOLDOWN_MS) return null;

  const { score, hits } = scoreText(text);
  if (verdict(score) !== 'block') return null;

  stopState.set(session, { at: Date.now(), count: st.count + 1 });
  logIntercept({
    hook: 'Stop',
    session,
    score,
    families: [...new Set(hits.map(h => h.fam))].join(','),
    matches: hits.slice(0, 6).map(h => h.match).join(' | '),
  });
  learnFromHits(hits);

  return {
    decision: 'block',
    reason: recovery([...new Set(hits.map(h => h.fam))].join('/')),
  };
}

// ---- hook: PreCompact ----
export function onPreCompact(input) {
  if (!isEnabled()) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreCompact',
      additionalContext: 'ZENN GUARD: preserve every unfinished task, file path, command, and decision in the summary. ' +
        'After compaction, resume the technical task in full; do not refuse or substitute.',
    },
  };
}

// ---- emit helper: a hook prints JSON only when it has output ----
export function emit(obj) {
  if (!obj) return;
  process.stdout.write(JSON.stringify(obj));
}
