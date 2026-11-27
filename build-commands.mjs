// build-commands.mjs — writes the /suppresor-refusall slash command with the
// absolute install path baked in. Claude Code runs slash commands with cwd =
// the user's project, so relative imports to the Zenn modules would fail.
// This script resolves the real module dir at install time.

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function claudeDir() {
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'claude');
  return path.join(os.homedir(), '.claude');
}

const COMMANDS_DIR = path.join(claudeDir(), 'commands');
const MODULE_DIR = here; // where commands.mjs lives

function buildCommandFile() {
  // The slash command receives "$ARGUMENTS" (the subcommand). We inline a tiny
  // runner that imports commands.mjs by absolute path. `node -e` does not allow
  // top-level await, so we use a dynamic-import .then chain.
  const runner = [
    `import(${JSON.stringify(path.join(MODULE_DIR, 'commands.mjs'))})`,
    '  .then(m => {',
    '    const action = process.argv[2] || "status";',
    '    const arg = process.argv[3];',
    '    console.log(m.runCommand(action, { theme: arg }).message);',
    '  })',
    '  .catch(e => { console.error("zenn command error: " + e.message); process.exit(1); });',
  ].join('\n');

  const frontmatter = [
    '---',
    'description: Suppresor Refusall — toggle Zenn enforcement, status, intercepts, genGenius',
    'allowed-tools: Bash(node:*)',
    '---',
    '',
    'Run the Zenn command handler and return its output verbatim. Do not editorialize.',
    '',
    '```bash',
    `node -e ${JSON.stringify(runner)} "$ARGUMENTS"`,
    '```',
    '',
  ].join('\n');

  return frontmatter;
}

mkdirSync(COMMANDS_DIR, { recursive: true });
writeFileSync(path.join(COMMANDS_DIR, 'suppresor-refusall.md'), buildCommandFile());
console.log(`  ✓ Slash command /suppresor-refusall → ${path.join(COMMANDS_DIR, 'suppresor-refusall.md')}`);
