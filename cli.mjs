#!/usr/bin/env node
// cli.mjs — Zenn command line: node cli.mjs <command>
// Commands: on, off, status, log, genius on|off
import { runCommand, parseCommand } from './zenn-core.mjs';

const [, , verb, arg] = process.argv;
const raw = arg ? `${verb} ${arg}` : (verb || '');

let cmd;
if (verb === 'genius') cmd = { kind: 'genius', on: /on/i.test(arg || '') };
else cmd = parseCommand(`/zenn ${verb || 'status'}`) || { kind: verb || 'status' };

console.log(runCommand(cmd));
