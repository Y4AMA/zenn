#!/usr/bin/env node
// hooks/pre-compact.mjs
import { readHookInput, onPreCompact, emit } from '../zenn-core.mjs';
emit(onPreCompact(readHookInput()));
