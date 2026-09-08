# Monid routing migration baselines

`agents.json` captures the nine affected `STARTER_AGENTS` definitions from
`bf82317c1` before Monid-first edits. `baselines.json` contains only the body
SHA256 values and metadata needed by the runtime migration; the full prompt
fixtures are test evidence, not runtime prompt payloads.

`skills.json` records the source commit and SHA256 of every skill fixture.
All bytes were obtained using `git show <commit>:packages/shared/src/skills/bundled/<slug>/SKILL.md`.
Current-baseline copies plus the previous YouTube migration versions and older
stock versions actually observed in the installed Artist OS profile are retained.
The installed profile was read only; arbitrary installed contents were never
accepted as shipped baselines.

The older installed versions match:
- YouTube Research: `f7f42ee34`.
- YouTube Intelligence: `75d89dffb`.
- Zero: `60905b4d4`.

Any prompt-body whitespace or skill-file customization fails the exact-byte
check. Routing metadata is migrated only when the entire previous stock
skills/sources/optionalSources selection remains intact. Workspace activation,
missing files, and deletion tombstones are not modified.
