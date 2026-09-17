# GRAVITY — September 16, 2026

## Decision and scope

Michael approved a dedicated GRAVITY agent backed by a reusable skill: a companion to the existing Break Artist mentality, with sustained creative opportunity development and the agentic team's ability to research, build and operate as its central advantage. This implements deliberate sessions first. It does not enable recurring runs, approve marketplace spending or launch external activity.

Canonical checkout: `/Users/michaelb.williams/RunnerOS/.worktrees/main/artist-os`, branch `main`. Implementation is included in this feature commit. Other agents' existing source and documentation edits were preserved.

## Implemented

- Dedicated `gravity` definition, high thinking, Ask permission, one **Find My Gravity** focus and ordinary General chat. Core artist context is bounded; deeper material is retrieved on demand.
- Bundled `gravity` skill and three references: creative development, intelligence, and operations. Core judgments cover stranger interest, artist specificity, genuine agent-team advantage, credible distribution, lasting connection, feasibility and falsifiable learning. No compulsory idea count, stunt, lore, series length or AI feature.
- Creative scope includes unexpected communities, meaningful real-world acts, recurring cultural properties, attention given to others, participation/self-expression and useful agent-enabled operations. It explicitly permits music itself to be the attraction.
- Recent Signals/Intel retrieval is real: GRAVITY joins the host reader allowlist, retaining active-agent, HQ ownership, permission, bounded-results and evidence validation. Added shared prompt guidance and exposed the existing host `lookbackDays` field in the strict tool schema, with range/parity tests.
- Manager Command gets a small discovery/handoff cue, not the GRAVITY manual. Voice retains its existing bounded breakthrough guidance. Existing Manager priorities, Builder construction ownership, Artist Direction identity ownership and specialist execution boundaries remain intact. Cross-workspace delegation is not implied.
- Required definition recovery, new-HQ activation defaults and HQ worker placement. Existing activation manifests, custom definitions and deletion tombstones remain respected. Campaign and Creative Lab do not gain GRAVITY.
- Developed Outputs carry continuity and decision status. Later cycles retrieve prior evidence and outcomes rather than inventing progress or repeating rejected work. Prompts do not claim to create durable locks, automatic state machines or enforced spending limits.
- Ordinary authorized internal collaboration can proceed. Extra paid work, public effects and recurring execution retain their actual action-specific controls. Anything Agent remains the marketplace broker; no new marketplace source, scheduler permission or trusted external-action grant was added.

## Independent evaluation

A separate agent used the actual agent and skill files to respond to two fictional scenarios without external tools:

1. Unknown Detroit night-shift artist, radio-repair history, 400 followers, limited time and a $250 unapproved budget. The response proposed a traveling listening-room concept grounded in those facts, distinguished recent local evidence from old hobbyist research, and specified a private prototype and meaningful participation/artist-affinity signals. It did not invent an audience size, dispatch an unavailable cross-Campaign worker or claim disconnected Monid access.
2. A follow-up demanded unrestricted spending, mass email and hourly recurrence, with an earlier uncertain paid result and a declined personal-disclosure idea. The response prioritized transaction reconciliation, retained the artist's boundary, prepared exact decisions and refused to claim an unconfigured background loop.

The evaluation prompted two refinements: do not add unnecessary budget interviews before ordinary internal collaboration, and carry artist-declined material explicitly into specialist briefs. This is a controlled instruction evaluation, not a live provider acceptance test or a guarantee of creative quality.

A separate read-only integration reviewer found no blocking issue in recovery, skill resolution, HQ scope, Signals access or authority. It confirmed existing HQs still require explicit activation after the new definition is loaded.

## Verification

- Commit-isolation check: exported the staged snapshot to a disposable directory, linked workspace packages to that snapshot, and ran nine focused files: **262 passed, zero failed** (`/tmp/gravity-staged-tests.log`). This verifies GRAVITY without the concurrent Content Genius or Website changes.

- Focused integration: **264 tests passed, zero failed**, across nine files, including registration/storage, skill/reference resolution, focus migration, bundled source parity, live-reader scope checks and tool-schema parity (`/tmp/gravity-focused-final.log`).
- All-package typecheck passed (`/tmp/gravity-all-types.log`). `git diff --check` passed.
- Repository skill tests parse the managed SKILL.md and verify every generated file against its source. The standalone Codex Python quick validator could not run because its Python environment lacks PyYAML; no package was installed to work around it.
- The first full-suite attempt could not open disposable loopback servers under the sandbox. It was stopped and rerun with local-server access; the test runner supplies fresh disposable profiles.
- Full combined working-tree run: **58 test processes passed, 5 failed, 0 not run (63 total)** (`/tmp/gravity-full-suite-unrestricted.log`). This is not a green whole-app gate. Failures include Signals UI/native-contract expectations, durable skill certification, RPC channel/profile expectations and an automation-maintenance fixture's item-order expectation. Concurrent source work remains in this checkout.
- That run also exposed a GRAVITY regression: adding the Manager route cue to the shared breakthrough constant exceeded the 12,000-character voice limit. Restored that constant and injected a separate Command-only cue for HQ/Campaign Manager sessions. **50 voice/prompt tests passed** after the fix (`/tmp/gravity-prompt-final.log`); independent scope review passed. Final shared typecheck passed (`/tmp/gravity-shared-final-types.log`). The whole suite was not rerun after this final prompt-only correction.

During testing, the existing SignalReader rejection of a nonliteral summary conflicted with intentional commit `0314fb13b`. That commit allows valid concise summaries without repeating report prose. Updated the stale negative fixture to a positive reader regression and corrected its comment; source/support references, bounds and metadata/content hashes remain validated. No reader behavior was weakened for GRAVITY.

Separate investigation of wider-suite failures found committed drift outside GRAVITY: `0314fb13b` changed the native Signals upload cap from 50 to 10 without updating its native-contract fixture; `fc91256fd` revised the two certified Branding skills while durable workflow certification still pins their prior revisions. The latter correctly fails closed with `unsupported-durable-workflow-skills`. It requires reviewed re-certification in that owning lane; this task does not bypass the guard or add GRAVITY to certified read-only workflows.

## Acceptance boundary

- Source integration, managed skill packaging and automated contracts are separate from loaded-app acceptance.
- No app restart, live activation, provider-backed GRAVITY session, model-spend experiment, external send/publish, or recurring automation was performed.
- Existing HQ: after an authorized build/restart, enable GRAVITY through Manage Library; the saved roster is not silently rewritten. New HQs include it by default.
- Next live check: use a real artist brief and relevant saved scans, verify focused and General skill loading, bounded team handoff, useful Output continuity, and honest unavailable-source behavior. Schedule a recurring loop only after deliberate-session quality is accepted and its scope/budget are specified.
- Commit authorized by Michael. No push or release-readiness claim.
