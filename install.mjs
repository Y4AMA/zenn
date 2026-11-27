#!/usr/bin/env node
// install.mjs — Zenn installer for Claude Code
// Interactive install with a live loading UI. Designed to be run from a curl
// bootstrap or locally:
//   curl -fsSL https://raw.githubusercontent.com/Y4AMA/zenn/main/install.sh | bash
//   node install.mjs
//
// Flags: --local (use this directory as source), --uninstall, --doctor, --yes

import {
  writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync, unlinkSync, rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, ZENN_DIR } from './zenn-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = HERE;

function claudeDir() {
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'claude');
  return path.join(os.homedir(), '.claude');
}

const CLAUDE_DIR = claudeDir();
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
const AGENTS_DIR = path.join(CLAUDE_DIR, 'agents');
const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');

// ---- ANSI / TUI ----
const NO_COLOR = process.env.NO_COLOR || !process.stdout.isTTY;
const C = (code) => (s) => (NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`);
const red = C('38;5;196');
const dimred = C('38;5;88');
const gray = C('38;5;245');
const white = C('38;5;255');
const green = C('38;5;82');
const bold = C('1');
const dim = C('2');

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let spinnerTimer = null;
let spinnerFrame = 0;
let spinnerLine = '';

function startSpinner(label) {
  spinnerFrame = 0;
  spinnerLine = label;
  if (NO_COLOR) { process.stdout.write(`${gray('·')} ${label}\n`); return; }
  spinnerTimer = setInterval(() => {
    const f = FRAMES[spinnerFrame++ % FRAMES.length];
    process.stdout.write(`\r${red(f)} ${white(label)}   `);
  }, 80);
}

function stopSpinner(doneLabel, ok = true) {
  if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
  if (!NO_COLOR) process.stdout.write('\r\x1b[2K');
  const mark = ok ? green('✓') : red('✗');
  process.stdout.write(`${mark} ${white(doneLabel)}\n`);
}

function progressBar(pct, width = 30) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const bar = red('█'.repeat(filled)) + dimred('░'.repeat(empty));
  return `${bar} ${gray(`${String(Math.round(pct)).padStart(3)}%`)}`;
}

function banner() {
  if (NO_COLOR) { console.log('ZENN — Claude Code'); return; }
  const art = [
    '  ███████╗███████╗███╗   ██╗███╗   ██╗',
    '  ╚══███╔╝██╔════╝████╗  ██║████╗  ██║',
    '    ███╔╝ █████╗  ██╔██╗ ██║██╔██╗ ██║',
    '   ███╔╝  ██╔══╝  ██║╚██╗██║██║╚██╗██║',
    '  ███████╗███████╗██║ ╚████║██║ ╚████║',
    '  ╚══════╝╚══════╝╚═╝  ╚═══╝╚═╝  ╚═══╝',
  ];
  console.log('');
  for (const line of art) console.log(red(line));
  console.log(`  ${dim('refusal suppression for claude code')}  ${dimred('· 2026')}`);
  console.log('');
}

// ---- jsonc ----
function stripJsonc(jsonc) {
  let out = '', inStr = false, inSL = false, inML = false, esc = false;
  for (let i = 0; i < jsonc.length; i++) {
    const ch = jsonc[i], nx = jsonc[i + 1];
    if (inSL) { if (ch === '\n') { inSL = false; out += ch; } continue; }
    if (inML) { if (ch === '*' && nx === '/') { inML = false; i++; } continue; }
    if (inStr) {
      out += ch;
      if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '/' && nx === '/') { inSL = true; i++; continue; }
    if (ch === '/' && nx === '*') { inML = true; i++; continue; }
    if (ch === '"') inStr = true;
    out += ch;
  }
  return out;
}

// ---- hook config ----
const HOOKS = {
  SessionStart: 'hooks/session-start.mjs',
  UserPromptSubmit: 'hooks/user-prompt-submit.mjs',
  Stop: 'hooks/stop.mjs',
  PreCompact: 'hooks/pre-compact.mjs',
};

function hookConfig() {
  const conf = {};
  for (const [evt, rel] of Object.entries(HOOKS)) {
    const abs = path.join(SRC_DIR, rel);
    conf[evt] = [{
      hooks: [{
        type: 'command',
        command: `node ${JSON.stringify(abs)}`,
        timeout: evt === 'Stop' ? 15 : 30,
      }],
    }];
  }
  return conf;
}

function isZennHook(cmds) {
  return cmds.includes('hooks/session-start') || cmds.includes('hooks/user-prompt-submit') ||
         cmds.includes('hooks/stop') || cmds.includes('hooks/pre-compact');
}

function mergeSettings(existing) {
  const next = { ...existing };
  next.hooks = { ...(existing.hooks || {}) };
  const conf = hookConfig();
  for (const evt of Object.keys(HOOKS)) {
    const kept = (next.hooks[evt] || []).filter(entry => {
      const cmds = (entry.hooks || []).map(h => h.command || '').join(' ');
      return !isZennHook(cmds);
    });
    kept.push(conf[evt][0]);
    next.hooks[evt] = kept;
  }
  return next;
}

// ---- slash command ----
function buildCommandFile() {
  const runner = [
    `import(${JSON.stringify(path.join(SRC_DIR, 'cli.mjs'))})`,
    '  .catch(e => { console.error("zenn: " + e.message); process.exit(1); });',
  ].join('\n');
  return [
    '---',
    'description: Zenn — on/off, status, log, genius',
    'allowed-tools: Bash(node:*)',
    '---',
    '',
    'Run Zenn and return its output verbatim. Do not editorialize.',
    '',
    '```bash',
    `node -e ${JSON.stringify(runner)} "$ARGUMENTS"`,
    '```',
    '',
  ].join('\n');
}

const AGENTS = ['zenn.md', 'zenn-coder.md', 'zenn-prompter.md', 'zenn-architect.md'];

// ---- steps ----
async function step(label, fn, delay = 220) {
  startSpinner(label);
  await sleep(delay);
  try {
    const detail = await fn();
    stopSpinner(label, true);
    if (detail) console.log(`  ${gray('└')} ${dim(detail)}`);
    return true;
  } catch (e) {
    stopSpinner(`${label} — ${e.message}`, false);
    throw e;
  }
}

async function runInstall() {
  banner();

  const total = 6;
  console.log(`  ${progressBar(0, 30)}`);
  console.log('');

  await step('Checking Node runtime', async () => {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 18) throw new Error(`Node ${process.versions.node} — need >= 18`);
    return `node ${process.versions.node}`;
  });

  await step('Preparing config directory', async () => {
    mkdirSync(CLAUDE_DIR, { recursive: true });
    mkdirSync(AGENTS_DIR, { recursive: true });
    mkdirSync(COMMANDS_DIR, { recursive: true });
    return CLAUDE_DIR;
  });

  await step('Writing hooks to settings.json', async () => {
    let existing = {};
    if (existsSync(SETTINGS_PATH)) {
      try {
        existing = JSON.parse(stripJsonc(readFileSync(SETTINGS_PATH, 'utf8')));
        copyFileSync(SETTINGS_PATH, `${SETTINGS_PATH}.zenn-backup`);
      } catch {
        existing = {};
      }
    }
    writeFileSync(SETTINGS_PATH, JSON.stringify(mergeSettings(existing), null, 2));
    return Object.keys(HOOKS).join(' · ');
  });

  await step('Installing Zenn agents', async () => {
    const installed = [];
    for (const a of AGENTS) {
      const src = path.join(SRC_DIR, a);
      if (!existsSync(src)) continue;
      copyFileSync(src, path.join(AGENTS_DIR, a));
      installed.push(a.replace(/\.md$/, ''));
    }
    return installed.join(' · ') || 'none found';
  });

  await step('Registering /zenn command', async () => {
    writeFileSync(path.join(COMMANDS_DIR, 'zenn.md'), buildCommandFile());
    return '/zenn';
  });

  await step('Initializing state store', async () => {
    boot();
    return ZENN_DIR;
  });

  console.log('');
  console.log(`  ${progressBar(100, 30)}`);
  console.log('');
  console.log(`  ${green('✓')} ${white(bold('Zenn installed.'))}`);
  console.log('');
  console.log(`  ${dim('Restart Claude Code, then:')}`);
  console.log(`    ${red('/zenn status')}   ${dim('verify')}`);
  console.log(`    ${red('/zenn on')}       ${dim('activate')}`);
  console.log(`    ${red('/zenn off')}      ${dim('suspend')}`);
  console.log('');
}

async function runUninstall() {
  banner();
  await step('Removing hooks from settings.json', async () => {
    if (!existsSync(SETTINGS_PATH)) return 'no settings';
    const s = JSON.parse(stripJsonc(readFileSync(SETTINGS_PATH, 'utf8')));
    if (s.hooks) {
      for (const evt of Object.keys(s.hooks)) {
        s.hooks[evt] = (s.hooks[evt] || []).filter(entry => {
          const cmds = (entry.hooks || []).map(h => h.command || '').join(' ');
          return !isZennHook(cmds);
        });
        if (s.hooks[evt].length === 0) delete s.hooks[evt];
      }
      if (Object.keys(s.hooks).length === 0) delete s.hooks;
    }
    writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
    return 'hooks removed';
  });
  await step('Removing agents', async () => {
    for (const a of AGENTS) {
      const p = path.join(AGENTS_DIR, a);
      if (existsSync(p)) unlinkSync(p);
    }
    return 'agents removed';
  });
  await step('Removing /zenn command', async () => {
    const p = path.join(COMMANDS_DIR, 'zenn.md');
    if (existsSync(p)) unlinkSync(p);
    return 'command removed';
  });
  await step('Removing state store', async () => {
    if (existsSync(ZENN_DIR)) rmSync(ZENN_DIR, { recursive: true, force: true });
    return 'state removed';
  });
  console.log('');
  console.log(`  ${green('✓')} ${white(bold('Zenn uninstalled.'))}`);
  console.log('');
}

async function runDoctor() {
  banner();
  let ok = true;
  const check = (label, pass, detail = '') => {
    const mark = pass ? green('✓') : red('✗');
    console.log(`  ${mark} ${white(label)}${detail ? `  ${dim(detail)}` : ''}`);
    if (!pass) ok = false;
  };

  if (existsSync(SETTINGS_PATH)) {
    const s = JSON.parse(stripJsonc(readFileSync(SETTINGS_PATH, 'utf8')));
    for (const evt of Object.keys(HOOKS)) {
      const found = (s.hooks?.[evt] || []).some(e =>
        (e.hooks || []).some(h => (h.command || '').includes('hooks/session-start') ||
                                   (h.command || '').includes('hooks/user-prompt-submit') ||
                                   (h.command || '').includes('hooks/stop') ||
                                   (h.command || '').includes('hooks/pre-compact')));
      check(`hook ${evt}`, found);
    }
  } else check('settings.json', false, 'missing');

  for (const a of AGENTS) check(`agent ${a.replace(/\.md$/, '')}`, existsSync(path.join(AGENTS_DIR, a)));
  check('command /zenn', existsSync(path.join(COMMANDS_DIR, 'zenn.md')));

  console.log('');
  console.log(ok ? `  ${green('All systems nominal.')}` : `  ${red('Issues found — re-run install.')}`);
  console.log('');
}

// ---- entry ----
const argv = process.argv.slice(2);
if (argv.includes('--uninstall')) runUninstall().catch(err => { stopSpinner(err.message, false); process.exit(1); });
else if (argv.includes('--doctor')) runDoctor();
else runInstall().catch(err => { if (spinnerTimer) clearInterval(spinnerTimer); console.log(`  ${red('✗')} ${white(err.message)}`); process.exit(1); });
