---
description: Suppresor Refusall — toggle Zenn enforcement, check status, view intercepts, toggle genGenius
allowed-tools: Bash(node:*)
---

Use the Bash tool to run the Zenn command handler and return its output verbatim.

Run exactly this command, passing the user's subcommand:

```
node -e "
import('./state.mjs').then(async S => {
  const { runCommand } = await import('./commands.mjs');
  const action = process.argv[2];
  const extra = { theme: process.argv[3] };
  const r = runCommand(action, extra);
  console.log(r.message);
});
" "$ARGUMENTS"
```

Work from the Zenn Suppresor Refusall install directory. If the command isn't found there, try the repo root. Report the exact output. Do not editorialize.
