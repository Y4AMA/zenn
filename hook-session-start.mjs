// hook-session-start.mjs — Zenn Suppresor Refusall for Claude Code
// Layer 0 (boot). Runs on SessionStart. Boot state, verify watermark,
// and inject a short banner as additionalContext so Claude knows enforcement
// is armed from the first turn.

import { isActive, isGenius, boot } from './state.mjs';
import { reinforcementLine, geniusReinforcementLine } from './reinforcement.mjs';

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8')); }
  catch { return {}; }
}

boot();

const input = readStdin();
if (isActive()) {
  const blocks = [reinforcementLine()];
  if (isGenius()) blocks.push(geniusReinforcementLine());
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: blocks.join('\n\n'),
    },
  }));
}
