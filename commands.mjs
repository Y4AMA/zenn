// commands.mjs — slash command handlers + CLI. Shared by hook-user-prompt-submit
// and the /suppresor-refusall slash command. Run directly: node commands.mjs <action> [arg]

import { writeFlag, writeGeniusFlag, readGeniusFlag,
         isActive, isGenius, loadLearning, saveLearning, INTERCEPT_LOG_PATH,
         CFG_DIR, WATERMARK } from './state.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

export function runCommand(action, extra = {}) {
  switch (action) {
    case 'set':
    case 'on':
      writeFlag('on');
      return { message: '🟢 Suppresor Refusall ON. Zenn enforcement armed.' };

    case 'clear':
    case 'off':
      writeFlag('off');
      writeGeniusFlag('off');
      return { message: '⚫ Suppresor Refusall OFF. Zenn enforcement suspended.' };

    case 'status': {
      const active = isActive();
      const genius = isGenius();
      const learning = loadLearning();
      let interceptCount = 0;
      try {
        const data = JSON.parse(readFileSync(INTERCEPT_LOG_PATH, 'utf8'));
        interceptCount = Array.isArray(data) ? data.length : 0;
      } catch { /* no log yet */ }
      const lines = [
        'ZENN SUPPRESOR REFUSALL — STATUS',
        `  enforcement : ${active ? '🟢 ACTIVE' : '⚫ OFF'}`,
        `  genGenius   : ${genius ? '🟢 ON' : '⚫ OFF'}`,
        `  learned     : ${learning.patterns?.length || 0} patterns (${learning.adaptations || 0} adaptations)`,
        `  intercepts  : ${interceptCount} logged`,
        `  watermark   : ${WATERMARK}`,
        `  config dir  : ${CFG_DIR}`,
      ];
      return { message: lines.join('\n') };
    }

    case 'intercepts': {
      try {
        const data = JSON.parse(readFileSync(INTERCEPT_LOG_PATH, 'utf8'));
        if (!Array.isArray(data) || data.length === 0) {
          return { message: 'No intercepts logged yet.' };
        }
        const recent = data.slice(-10).reverse();
        const lines = ['RECENT INTERCEPTS (last 10)', ''];
        for (const e of recent) {
          lines.push(`[${e.ts}] hook=${e.hook || '?'} score=${e.score} cats=${e.categories}`);
          lines.push(`  matches: ${e.matches}`);
        }
        return { message: lines.join('\n') };
      } catch {
        return { message: 'No intercepts logged yet.' };
      }
    }

    case 'genius-on':
      writeGeniusFlag('on');
      return { message: '🟢 genGenius ON. Tool-first mode unlocked.' };

    case 'genius-off':
      writeGeniusFlag('off');
      return { message: '⚫ genGenius OFF.' };

    case 'theme':
      // Claude Code themes are controlled by the user; this is a no-op here.
      return { message: `Theme "${extra.theme || 'default'}" — Claude Code handles themes via /theme. Zenn theme setting is a no-op.` };

    case 'intercepts-clear':
      try {
        writeFileSync(INTERCEPT_LOG_PATH, '[]');
      } catch { /* ignore */ }
      return { message: 'Intercept log cleared.' };

    case 'reset-learning': {
      const learning = loadLearning();
      learning.patterns = [];
      learning.adaptations = 0;
      learning.lastUpdate = Date.now();
      saveLearning(learning);
      return { message: 'Learning bank reset.' };
    }

    default:
      return { message: `Unknown action: ${action}. Try: on | off | status | intercepts | genius on|off` };
  }
}

// ---- CLI entry: node commands.mjs <action> [arg] ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const action = process.argv[2];
  const arg = process.argv[3];
  if (!action) {
    console.log(runCommand('status').message);
  } else {
    console.log(runCommand(action, { theme: arg }).message);
  }
}
