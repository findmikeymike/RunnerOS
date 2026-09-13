# Durable artist profile enrichment

Parked from V1 on September 13, 2026. The V1 product should use a simple manually saved **Public articles & context** section instead of an automated research workflow.

The V2 concept runs bounded public-web research, validates sourced career findings, publishes them into agent context, supports corrections/removals, and handles cancellation, restart, Team conflicts, malformed records, and explicit context clearing.

Preserved implementation history:

- Initial implementation already present in local `main`: `95a6a7fab`.
- Unfinished security/durability hardening: branch `codex/profile-enrichment-review-fixes`, commit `63533db72`.
- V1 replacement and off switch: branch `codex/simple-artist-public-context`, commits `6dff38175` and `d2d722f86`; applied to local `main` as `f829be21e` and `2be0084c3`.
- Full specification packet: `docs/creator-command-center/todo/51-artist-profile-enrichment/` in that branch.

Do not enable this for V1. Before V2 activation, finish and independently verify the remaining review findings: complete public-IP validation, stale-projection exclusion after clear, full persisted-record validation, correction-draft recovery, keyboard acceptance, full build, and live-source smoke testing.
