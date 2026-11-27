// hook-pre-compact.mjs — Zenn Suppresor Refusall for Claude Code
// Runs before a context compaction. Adds the compaction guard to the summary
// prompt so the doctrine survives compaction.

import { isActive } from './state.mjs';
import { COMPACTION_GUARD } from './reinforcement.mjs';

if (isActive()) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreCompact',
      additionalContext: COMPACTION_GUARD,
    },
  }));
}
