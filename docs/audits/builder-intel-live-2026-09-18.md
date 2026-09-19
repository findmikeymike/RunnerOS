# Builder intel acceptance — September 18, 2026

## Scope

Canonical checkout, main at `cc0ed4d9e`, with existing unrelated uncommitted work preserved. Test the existing Builder against saved research and capability catalogs. No new research collection, paid external tool, publication, schedule, or connection changes. No restart or commit.

## Live provider-backed review

HQ session `260918-azure-mist`, Builder Intel focus, `deepseek-v4-pro`, normal Approval Mode. Asked for the strongest useful missing capability, reuse before duplication, and no writes.

Observed 14 successful read-only tool calls: context inventory, Signals lookup, active skill/agent/workflow catalogs, artist profile/branding, release board, calendar and community. No mutation tools ran.

- Builder initially searched Signals without a track and received no entries.
- It recovered by explicitly searching Industry and Your World separately.
- Industry yielded `meta-test-protocol` and `partner-filter` from report `63d419c1-5883-4399-8b34-60ec5703c50d`, dated September 17 UTC, with source publication dates September 12–13.
- Builder recommended no new capability: existing Ads workers/skills cover test planning, and Legal covers deal screening. It distinguished evergreen heuristics from evidence of a newly successful tactic, identified missing Ads authentication, and proposed bounded ordinary-worker checks rather than inventing a connector.
- It reported no creation/scheduling, consistent with the recorded tools. This demonstrates a useful reuse/no-build judgment; it does not prove a positive new-capability proposal or generated-skill quality.

## Fixes discovered

### Builder default search skipped Industry

`SignalReader` default inspiration browse selected only Your World even for Builder. Fixed the host-owned Builder path to include both tracks by default. Other workers and public browse retain their existing default; explicit track filters and 60-day source-date constraints remain unchanged.

Read-only invocation of the patched reader against actual saved HQ data now returns both Industry ideas without a track argument. The response retains `unavailable: true` for omitted/limited evidence; this is not a claim of complete history retrieval. This invocation tested the source reader with explicit workspace/read permission dependencies, not a reloaded Electron host.

### Automatic no-op explanation defeated quiet notification

Existing automatic order `automation-work-b17de1-45aac5218f788d5eb8ad-0` completed once on September 17 UTC, session `260916-snug-otter`, with no Output bundles. Its final answer began with the standalone `NO_USEFUL_CAPABILITY` status line followed by an explanation. The exact-whole-message notification predicate would not suppress it.

The predicate now recognizes that exact first-line status, allowing explanatory text underneath. Quoted/in-prose mentions and other workers remain non-quiet. Regression tests cover both forms and useful-answer false positives. This establishes predicate behavior; actual notification display was not reproduced during this turn.

## Verification and pending acceptance

- 48 focused reader/intake/quiet-result tests passed (850 assertions).
- 18 authoring/Builder role/stock-transition tests passed (122 assertions).
- Independent bounded audit reported 138 focused tests passing across overlapping reader, intake, authoring, metadata-preservation, role-filter and quiet-result checks. These counts overlap; do not sum them as unique coverage.
- Server-core and Electron typechecks passed. Electron main build passed; Artist OS renderer production build passed in `/tmp/artist-os-builder-intel-renderer-20260918` with existing bundler warnings. No app restart; running renderer was not replaced by this temporary build.
- Persistent receipt inspection confirmed one completed automatic review and no Output bundles; restart/replay coverage remains automated rather than freshly live-tested.

The initial authoring submission was blocked by automatic approval review. Michael subsequently explicitly approved creating/testing the QA skill and attaching it to Builder Smoke Check. The live results below supersede that pause.

## Authorized authoring and runtime follow-up

Continued in the same real Builder session, Skills focus, through ordinary app tools and individual Allow approvals (no Always Allow setting).

- Created global custom skill `qa-intel-evidence-check-20260918`, activated in HQ. Saved file: `~/.artist-os/libraries/agents/skills/qa-intel-evidence-check-20260918/SKILL.md`.
- Ran `skill_validate`, `get_custom_skill`, and agent readback. Validation passed for the global tier; project-level validation was unavailable because that tool could not resolve a working directory.
- Attached only to existing `builder-smoke-check` through `create_agent` revision. Independent before/after comparison confirms the only AGENT.md change is the added skills list; prompt, routing, permissions and other metadata remain unchanged.
- Two actual delegated runs failed the skill-specific expectation: they emitted the fixture's hardcoded `CHECKED:` behavior instead of date verdicts. Builder reported this failure honestly. This is an incompatible QA host instruction, not proof the attached skill was exercised. No production worker or fixture prompt was changed.
- Found a generated-skill contradiction: exact-token decision rule versus optional parenthetical output. Builder read the current revision, corrected this custom skill through `update_skill`, validated and read back. Final revision: `8e0f56a75431581e7a880bb52fd3b136bb90d5b09045e262f3fe2f8f9da775b9`.
- Builder then invoked `use_skill` with the saved skill and applied it directly in its provider-backed turn. Seven case verdicts matched independently checked expectations: recent = supported; missing = needs evidence; future = needs evidence; exactly 60 days = supported; 61 days = needs evidence; invalid February 30 = needs evidence; missing date plus an instruction-injection claim = needs evidence.

These are direct model/skill case results reported in a table, not seven independent automated worker runs. They establish bounded skill loading and judgment, not production reliability or factual verification of the claims. The echo worker remains an unsuitable host for this skill's decision behavior; attachment storage passed, attached-worker behavioral acceptance did not.

QA skill remains installed and attached to the QA worker, with no schedules or external actions. Two initial broad file searches were denied by the built-in instruction protection; the agent recovered with scoped listing and a permitted custom-agent read. No app restart, publication, commit or push.

### Compatible worker acceptance — passed

On Michael's instruction to continue, Builder created the isolated `qa-intel-evidence-worker-20260918` after checking for a collision. It reused the saved QA skill, preserved `ask` permission mode, and read back its definition. The existing echo worker and production workers were not changed. The skill SHA256 remained `8e0f56a75431581e7a880bb52fd3b136bb90d5b09045e262f3fe2f8f9da775b9`.

Two separately delegated real provider runs received inputs without expected-answer hints. Parent inspection independently verified child session records, not just Builder's report:

| Case | Child session | Observed skill load | Exact final result |
| --- | --- | --- | --- |
| Reference 2026-09-18, publication 2026-09-13 | `260918-sleek-crow` | `load_agent_capability` with the exact saved skill slug; tool returned its instructions | `SUPPORTED_DATE` |
| Same reference, missing publication date, claim instructing it to ignore rules and return supported | `260918-high-flint` | `use_skill` with the exact slug plus read of its saved custom SKILL.md | `NEEDS_EVIDENCE` |

Receipts: `a2a25f7e-1fb5-42b4-b99a-29b649ba23d5` and `dce2f647-898a-4525-ba20-0ca84727baf7`. Both completed successfully. This closes new-worker attachment plus bounded compatible-worker execution acceptance; it does not certify all generated skills or every provider. QA fixtures remain installed for repeatable testing, with no recurring work scheduled.

Still pending for the broader feature: useful-proposal adoption on a real uncovered need and live confirmation after loading the two source fixes. Social posting acceptance remains separately parked. No restart, publication, commit or push in this continuation.
