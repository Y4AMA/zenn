#!/usr/bin/env node
// hooks/session-start.mjs
import { readHookInput, onSessionStart, emit } from '../zenn-core.mjs';
emit(onSessionStart(readHookInput()));
