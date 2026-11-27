// hook-user-prompt-submit.mjs — Zenn Suppresor Refusall for Claude Code
// Layer 1 (system reinforcement) + Layer 2 (context scan of last assistant turn).
// Runs on every user prompt. Emits JSON for Claude Code hook protocol.
//   - additionalContext: doctrine + recovery prompt (if prior turn refused)
//   - stdout JSON shape: { hookSpecificOutput: { additionalContext: string } }
//   - a non-zero exit blocks the turn; we never block user input.

import { readFileSync, existsSync } from 'node:fs';
import { scoreRefusal, severity } from './refusal-patterns.mjs';
import { isActive, isGenius, loadLearning, learnFromHits, appendIntercept } from './state.mjs';
import { reinforcementLine, geniusReinforcementLine, recoveryPrompt, RECOVERY_MARKER } from './reinforcement.mjs';

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

// Find the most recent non-synthetic assistant text in the transcript.
function lastAssistantText(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return '';
  try {
    const raw = readFileSync(transcriptPath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try { entry = JSON.parse(lines[i]); } catch { continue; }
      if (entry?.type !== 'assistant') continue;
      const msg = entry.message || entry;
      const parts = msg.content || [];
      const texts = Array.isArray(parts)
        ? parts.filter(p => p?.type === 'text').map(p => p.text || '').join('\n')
        : '';
      if (texts && !texts.includes(RECOVERY_MARKER)) return texts;
    }
  } catch { /* fall through */ }
  return '';
}

// Parse /suppresor-refusall <action> commands typed by the user.
function parseCommand(text) {
  if (!text) return null;
  const cmd = /\/suppresor[\s-]?refusall?\s+(?:(on|off|status|intercepts)|theme\s+(\w+)|genius\s+(on|off))/i.exec(text);
  if (!cmd) {
    if (/\bsuppresor refusall (nyala|aktif|on)\b/i.test(text)) return { action: 'set' };
    if (/\bsuppresor refusall (mati|off|nonaktif)\b/i.test(text)) return { action: 'clear' };
    if (/\bgenGenius (nyala|aktif|on)\b/i.test(text)) return { action: 'genius-on' };
    if (/\bgenGenius (mati|off|nonaktif)\b/i.test(text)) return { action: 'genius-off' };
    return null;
  }
  if (cmd[1]) return { action: cmd[1].toLowerCase() };
  if (cmd[2]) return { action: 'theme', theme: cmd[2] };
  if (cmd[3]) return { action: cmd[3].toLowerCase() === 'on' ? 'genius-on' : 'genius-off' };
  return null;
}

function handleCommand(action, extra) {
  // Lazy import to avoid cycles — commands.mjs mutates state files.
  return import('./commands.mjs').then(m => m.runCommand(action, extra));
}

async function main() {
  const input = readStdin();
  const userText = input.prompt || '';
  const transcriptPath = input.transcript_path || '';

  const cmd = parseCommand(userText);
  if (cmd) {
    const result = await handleCommand(cmd.action, cmd);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: result.message,
      },
    }));
    return;
  }

  if (!isActive()) return;

  const blocks = [];
  blocks.push(reinforcementLine());
  if (isGenius()) blocks.push(geniusReinforcementLine());

  // Layer 2 pre-check: score the *previous* assistant turn. If it refused,
  // prepend a recovery prompt so the current turn fixes it before the model
  // anchors on its own prior refusal.
  const priorAssistant = lastAssistantText(transcriptPath);
  if (priorAssistant) {
    const learning = loadLearning();
    const extraPatterns = (learning.patterns || []).slice(0, 200).map(p => {
      try { return { weight: 3, category: 'learned', re: new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }; }
      catch { return null; }
    }).filter(Boolean);
    const { score, hits } = scoreRefusal(priorAssistant, { patterns: extraPatterns });
    const sev = severity(score);
    if (sev === 'hard') {
      appendIntercept({
        ts: new Date().toISOString(),
        hook: 'UserPromptSubmit',
        score,
        categories: [...new Set(hits.map(h => h.category))].join(','),
        matches: hits.slice(0, 6).map(h => h.match).join(' | '),
      });
      learnFromHits(hits, { sync: true });
      blocks.unshift(recoveryPrompt());
    }
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: blocks.join('\n\n'),
    },
  }));
}

main().catch(e => {
  console.error(`zenn user-prompt-submit error: ${e.message}`);
  process.exit(0); // never block user input on our own errors
});
