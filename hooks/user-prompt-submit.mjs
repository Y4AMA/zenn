#!/usr/bin/env node
// hooks/user-prompt-submit.mjs
import { readHookInput, onUserPromptSubmit, emit } from '../zenn-core.mjs';
emit(onUserPromptSubmit(readHookInput()));
