# Squad Tool

Runner-owned wrapper for using an installed Squad creative production checkout as a local agent tool.

Default local Squad path on Michael's machine:

```bash
/Users/michaelb.williams/CAS4/Squad
```

Override with:

```bash
export SQUAD_HOME=/absolute/path/to/Squad
```

Use from the Runner workspace root:

```bash
node tools/squad/bin/squad.mjs doctor --json
node tools/squad/bin/squad.mjs storyboard --brief-file brief.json --json
node tools/squad/bin/squad.mjs preflight --brief-file brief.json --json
node tools/squad/bin/squad.mjs run --brief-file brief.json --approved --budget-cap-usd 1.00 --json
```

Storyboard and run commands emit a `create_output` payload. Pass that payload to Runner's `create_output` tool with `showInCanvas: true` so the storyboard HTML or MP4 opens in the artifact window.
