# Conversational work bridge — start here

> CURRENT STATUS — 2026-09-13: PARKED for Artist OS V2 at `/Users/michaelb.williams/RunnerOS/.worktrees/Artist OS v2 features/conversation-background-tasks`, branch `codex/conversational-work-spec`. Michael authorized a local feature-branch checkpoint commit. No merge or push authorized. Do not continue implementation or relaunch without his direction. Live T203 failed to establish acceptance; later phases remain unfinished. The dated history below records prior authorizations and locations and is superseded by this notice. See root `V2-PARKED.md`.

**Promise:** Ask Mikey to do work, keep talking while a specialist handles it, and hear the result or a useful question without leaving the call.

Revision: r3, 2026-09-12. Implementation is explicitly authorized (evidence/implementation-authorization.md). P1 proofs, T201 native implementation and T202 playback integration are independently accepted. T204 adds independently testable task details/cancellation before T203. Live acceptance still awaits explicit candidate relaunch permission and readiness. The product milestone is not certified. App relaunch, commit, merge and push remain unauthorized.

Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/conversational-work-spec`  
Branch: `codex/conversational-work-spec`  
Baseline: `4491d212283bf5c31599c4488201ccaf75236a29` from canonical Artist OS main. Main advanced during orientation; this is the actual worktree base.

## Recommended approach

Keep Voice Core, Mikey's avatar, phoneme playback, current speech providers and independent voice settings. Add a small host-owned bridge to Artist OS's existing AgentMessageService and specialist sessions. Borrow the conversational coordination ideas from Bodhi and Cicero; do not install another voice runtime.

The first live proof is one real draft task: Mikey starts it, answers an unrelated question while it runs, then announces the saved draft at a quiet moment. The worker, saved output, uninterrupted call and audible playback must all be real.

## Read in order

1. [Specification](specification.md): scope, user journeys, decisions and acceptance requirements.
2. [Contracts](contracts.md): identities, APIs, state machines, delivery, permissions and persistence.
3. [Roadmap](roadmap.md): phased implementation and exit evidence.
4. [Readiness](readiness.md): setup, ownership and remaining proof requirements.
5. [Plan](plan.json): authoritative dependency/status graph.
6. [State](state.md): precise continuation point.

P1 settled the bounded host and actual SDK playback proofs. T201 and T202 now have executable packets. Later phases remain outlined until their dependency gates pass.

## Next action

Read state.md, validate plan.json, and follow T203 only after explicit candidate relaunch permission and live readiness. Live calls later require existing voice credentials, an active specialist and explicit permission to run the candidate app.

Resume instruction: “Read docs/build-specs/conversational-work-bridge/start-here.md and state.md. Validate plan.json. Recheck source drift and execute the authorized eligible task; preserve other agents' work and do not relaunch without permission.”

Worktree refreshed by fast-forward to main `d0b5bae3c08a51626fbbbd63aab8671586af8f25` before handoff. The inspected source baseline remains 4491d2122; the incoming change touched only AppShell and its chrome test, and recorded source hashes still match.
