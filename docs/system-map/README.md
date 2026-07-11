---
status: current
owner: agent
last_verified: 2026-07-11
source_of_truth: true
---

# Runner System Map

Generated map of Runner-specific worker, context, Output/Final, Scheduled Work, Automations, HNIC scheduling, and social-execution wiring that generic code graphs miss.

Files:

- [runner-system-map.md](./runner-system-map.md) - human-readable worker/system wiring.
- [runner-system-map.json](./runner-system-map.json) - machine-readable source for agents.
- [runner-system-map.mmd](./runner-system-map.mmd) - Mermaid graph for quick visual scans.

Regenerate after changing starter agents, worker visibility, launch routing, Scheduled Work, Automations, Outputs/Finals, or permission/tool rules:

```bash
node scripts/generate-runner-system-map.mjs
```

This map is derived from code. If it disagrees with the running app, inspect the source files listed in the generated JSON before editing docs by hand.
