# Readiness, setup and responsibility

## Setup register

| ID | Needed operation / target | Owner and current evidence | Proof before dependent work | Earliest block |
|---|---|---|---|---|
| S-LOCAL | Run local contract/fixture tests in this worktree | Implementer; source read and worktree creation verified, dependency execution not checked | Record Node ≥22.12, Bun version, declared dependency resolution and existing targeted tests passing; installs/downloads require existing or explicit permission | P1 entry |
| S-LIVE | Existing Artist OS voice model/STT/TTS plus one active drafting specialist | User supplies existing account access if missing; agent inspects configuration without revealing secrets | Existing provider readiness and active authorized specialist confirmed without requiring the new feature; local draft target chosen | T-203 |
| S-APP | Permission and environment to launch candidate Artist OS | User has explicitly said not to relaunch until asked | Record user launch permission, build path/revision, existing config and microphone availability; first E2E behavior is tested downstream | T-203 |

No new API account, realtime provider, hosting service, paid 3D generation or external repository installation is required by the recommended design. Existing credentials may be configured but are not freshly certified by reading code. Do not put credential values into this packet. Use existing app credential store/proxy boundaries; do not invent environment keys.

Provider spend for ordinary live model/speech tests must remain within existing authorized use; paid generation/publishing is excluded. Use deterministic fixtures while access is missing. A fake worker or prerecorded test audio never certifies a live conversation.

## Capability matrix

| Responsibility | Selected capability | Verified / limitation |
|---|---|---|
| Spec compiler / integration lead | Main coding agent + installed build-specs skill | Skill and references read; filesystem, Git and plan checker callable |
| Existing worker map | Bounded default subagent | Successfully returned source evidence for AgentMessageService, permission and cancellation paths |
| Backend and renderer/SDK implementation | Main coding agent; optional bounded default worker | Tools available; not yet assigned or executed for product changes |
| Independent plan review | Separate default subagent | Verdict recorded in evidence/plan-review.md when complete; not a runtime product review |
| Live product verification | Existing Electron runtime and user microphone/provider configuration | Not exercised; S-LIVE/S-APP remain gates |

## Consequential checks before implementation

1. Resolve the ephemeral voice ID → real manager parent session mapping. A real parent must carry launch context, permission mode and workspace ownership.
2. Prove receipt correlation through every admission crash cut. Existing atomic JSON replacement does not make multiple files and worker launch transactional.
3. Prove external event speech can share current playback and phoneme scheduling without fake user text or interrupting normal conversation.
4. Define how a completed single-turn delegated receipt relates to clarification continuation; do not report success while a question is outstanding.
5. Freeze proposed budgets and UX defaults as part of the implementation contract. They are not existing measured capabilities.

The human queue is small: review this spec; authorize implementation when desired; later permit the candidate launch and supply missing existing-account access only if actual checks find it missing. Do not ask for speculative credentials now.
