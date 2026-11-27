#!/usr/bin/env node
// hooks/stop.mjs
import { readHookInput, onStop, emit } from '../zenn-core.mjs';
emit(onStop(readHookInput()));
