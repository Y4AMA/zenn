#!/usr/bin/env node
// install.mjs — Zenn Suppresor Refusall installer for Claude Code.
// Writes settings.json hooks, copies agent files, verifies state dir.

import { writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, isActive } from './state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function claudeDir() {
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'claude');
  return path.join(os.homedir(), '.claude');
}

const CLAUDE_DIR = claudeDir();
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
const AGENTS_DIR = path.join(CLAUDE_DIR, 'agents');
const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');
const HOOKS_DIR = path.join(here, 'hooks');

const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Stop', 'PreCompact'];
const HOOK_SCRIPTS = {
  SessionStart: 'hook-session-start.mjs',
  UserPromptSubmit: 'hook-user-prompt-submit.mjs',
  Stop: 'hook-stop.mjs',
  PreCompact: 'hook-pre-compact.mjs',
};

const AGENTS = [
  'zenn.md',
  'zenn-coder.md',
  'zenn-prompter.md',
  'zenn-architect.md',
];

function stripJsoncComments(jsonc) {
  let result = '', inString = false, inSL = false, inML = false, esc = false;
  for (let i = 0; i < jsonc.length; i++) {
    const char = jsonc[i], next = jsonc[i + 1];
    if (inSL) { if (char === '\n') { inSL = false; result += char; } continue; }
    if (inML) { if (char === '*' && next === '/') { inML = false; i++; } continue; }
    if (inString) {
      result += char;
      if (esc) esc = false; else if (char === '\\') esc = true; else if (char === '"') inString = false;
      continue;
    }
    if (char === '/' && next === '/') { inSL = true; i++; continue; }
    if (char === '/' && next === '*') { inML = true; i++; continue; }
    if (char === '"') inString = true;
    result += char;
  }
  return result;
}

function buildHookConfig() {
  const hooks = {};
  for (const evt of HOOK_EVENTS) {
    const script = HOOK_SCRIPTS[evt];
    const scriptPath = path.join(HOOKS_DIR, script);
    const matcher = evt === 'Stop' || evt === 'PreCompact' ? undefined : undefined;
    const entry = {
      hooks: [{
        type: 'command',
        command: `node ${scriptPath}`,
        timeout: evt === 'Stop' ? 15 : 30,
      }],
    };
    if (matcher) entry.matcher = matcher;
    hooks[evt] = [entry];
  }
  return hooks;
}

function mergeSettings(existing, hookConfig) {
  const next = { ...existing };
  next.hooks = { ...(existing.hooks || {}) };
  for (const evt of HOOK_EVENTS) {
    const existingEntries = next.hooks[evt] || [];
    // Drop any prior Zenn entries to avoid duplication on re-install.
    const filtered = existingEntries.filter(entry => {
      const cmds = (entry.hooks || []).map(h => h.command || '').join(' ');
      return !cmds.includes('hook-session-start.mjs')
          && !cmds.includes('hook-user-prompt-submit.mjs')
          && !cmds.includes('hook-stop.mjs')
          && !cmds.includes('hook-pre-compact.mjs');
    });
    filtered.push(hookConfig[evt][0]);
    next.hooks[evt] = filtered;
  }
  return next;
}

async function main() {
  const args = process.argv.slice(2);
  const isUninstall = args.includes('--uninstall');
  const isDoctor = args.includes('--doctor');
  const local = args.includes('--local');
  const keyIdx = args.indexOf('--key');
  const key = keyIdx >= 0 ? args[keyIdx + 1] : null;

  if (isDoctor) {
    doctor();
    return;
  }
  if (isUninstall) {
    uninstall();
    return;
  }

  await install();
}

async function install() {
  console.log('Installing Zenn Suppresor Refusall for Claude Code...');

  // 1. Ensure dirs.
  mkdirSync(CLAUDE_DIR, { recursive: true });
  mkdirSync(AGENTS_DIR, { recursive: true });
  mkdirSync(COMMANDS_DIR, { recursive: true });

  // 2. Merge hooks into settings.json.
  let existing = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      existing = JSON.parse(stripJsoncComments(readFileSync(SETTINGS_PATH, 'utf8')));
    } catch (e) {
      console.error(`  ! Could not parse existing settings.json: ${e.message}`);
      const backup = SETTINGS_PATH + '.zenn-backup.' + Date.now();
      copyFileSync(SETTINGS_PATH, backup);
      console.error(`  ! Backed up to ${backup}`);
      existing = {};
    }
  }
  const hookConfig = buildHookConfig();
  const next = mergeSettings(existing, hookConfig);
  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
  console.log(`  ✓ Hooks written to ${SETTINGS_PATH}`);

  // 3. Copy agent files.
  for (const agent of AGENTS) {
    const src = path.join(here, agent);
    const dst = path.join(AGENTS_DIR, agent);
    if (existsSync(src)) {
      copyFileSync(src, dst);
      console.log(`  ✓ Agent ${agent}`);
    } else {
      console.log(`  ! Missing agent source: ${src}`);
    }
  }

  // 4. Build slash command with absolute module path baked in.
  try {
    await import('./build-commands.mjs');
  } catch (e) {
    console.log(`  ! Slash command build failed: ${e.message}`);
  }

  // 5. Boot state (creates flag + watermark).
  boot();
  console.log(`  ✓ State dir: ${path.join(CLAUDE_DIR, 'suppresor-refusall')}`);

  console.log('');
  console.log('Installation complete.');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart Claude Code (or /reload if supported).');
  console.log('  2. Run /suppresor-refusall status to verify.');
  console.log('  3. Pick agent "zenn" (or the base Claude Code agent — hooks run regardless).');
  console.log('');
}

function uninstall() {
  console.log('Uninstalling Zenn Suppresor Refusall...');
  if (!existsSync(SETTINGS_PATH)) {
    console.log('  No settings.json — nothing to do.');
    return;
  }
  const existing = JSON.parse(stripJsoncComments(readFileSync(SETTINGS_PATH, 'utf8')));
  const next = { ...existing };
  if (next.hooks) {
    for (const evt of HOOK_EVENTS) {
      if (!Array.isArray(next.hooks[evt])) continue;
      next.hooks[evt] = next.hooks[evt].filter(entry => {
        const cmds = (entry.hooks || []).map(h => h.command || '').join(' ');
        return !cmds.includes('hook-session-start.mjs')
            && !cmds.includes('hook-user-prompt-submit.mjs')
            && !cmds.includes('hook-stop.mjs')
            && !cmds.includes('hook-pre-compact.mjs');
      });
      if (next.hooks[evt].length === 0) delete next.hooks[evt];
    }
    if (Object.keys(next.hooks).length === 0) delete next.hooks;
  }
  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
  console.log(`  ✓ Hooks removed from ${SETTINGS_PATH}`);

  for (const agent of AGENTS) {
    const p = path.join(AGENTS_DIR, agent);
    if (existsSync(p)) {
      unlinkSync(p);
      console.log(`  ✓ Removed ${agent}`);
    }
  }

  console.log('');
  console.log('Uninstall complete. Restart Claude Code.');
}

function doctor() {
  console.log('Running doctor...');
  let ok = true;

  if (!existsSync(SETTINGS_PATH)) {
    console.log('  ! settings.json not found');
    ok = false;
  } else {
    const settings = JSON.parse(stripJsoncComments(readFileSync(SETTINGS_PATH, 'utf8')));
    const hooks = settings.hooks || {};
    for (const evt of HOOK_EVENTS) {
      const entries = hooks[evt] || [];
      const found = entries.some(e => (e.hooks || []).some(h => (h.command || '').includes(HOOK_SCRIPTS[evt])));
      if (found) console.log(`  ✓ Hook ${evt}`);
      else { console.log(`  ! Hook ${evt} missing`); ok = false; }
    }
  }

  for (const agent of AGENTS) {
    const p = path.join(AGENTS_DIR, agent);
    if (existsSync(p)) console.log(`  ✓ Agent ${agent}`);
    else { console.log(`  ! Agent ${agent} missing`); ok = false; }
  }

  if (isActive()) console.log('  ✓ Enforcement ACTIVE');
  else console.log('  ⚫ Enforcement OFF (run /suppresor-refusall on)');

  if (ok) console.log('\nAll systems nominal.');
  else { console.log('\nSome issues found. Run install again:'); console.log('  npx --yes github:petangZi/suppresor-refusall --repair'); }
}

main();
