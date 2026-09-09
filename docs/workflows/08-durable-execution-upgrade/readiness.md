# Readiness and ownership

Revision r2. P-01 local proof accepted; provider accounts remain uncertified.

## Setup register

| ID | Needed operation | State / proof / earliest dependency |
| --- | --- | --- |
| S-LOCAL | Read canonical code; create disposable test/config roots; run Bun and packaged Electron storage proof | Accepted: fresh baseline, disposable Bun subprocess tests and packaged Electron SQLite/restart/contention proof. See evidence/T-02-storage.md. No live credentials used. |
| S-EARLY-LIVE | Prepare a safe private/test-mode real adapter | T-07 prepares exact action, SDK/target and missing authorization; T-07-LIVE proves provider limits in P-03. |
| S-LIVE | Exercise one named external adapter against a safe test target and query its effect/status | Planned. T-13 prepares exact provider, SDK version, endpoint, account/workspace reference, minimum scopes, target, operation, expected cost and cleanup. T-15 verifies actual outcome; existing sign-in alone is insufficient. |

Do not store credential values in this packet. Fetch through existing product secure storage at dispatch time. Developer connector authentication and product provider authentication are distinct. Tool/install availability is not authority to act on an account.

## Human queue

Nothing is needed to finish this specification or to prepare local fixtures. The user authorized the first task group, rival review and confirmed fixes on 2026-09-09. When requested, P-01 can proceed without provider setup.

Before a live write or cost-incurring action in T-07-LIVE or T-15, prepare a concrete safe test and check existing authorization. Ask only for the missing target, access or action scope; explain why it is required. Prefer test-mode/private draft or a disposable target. A successful fake-provider test does not unlock a live-provider gate. Account creation, consent/MFA or billing changes are not authorized by this packet.

## Capability and ownership matrix

| Responsibility | Available route | Evidence / limitation |
| --- | --- | --- |
| Spec/integration lead | Main coding agent, build-specs skill | Used to author this packet and validate its graph; not a runtime engine |
| Persistence/runtime implementation | Main coding agent or bounded default subagent | Shell/read/edit tools callable; actual assignment recorded on implementation |
| Independent review | Separate default subagent | Callable in this task; review report records actual outcome |
| UI verification | CUA native app/browser tools; project test tools | Available; must freshly identify canonical packaged build and screen |
| External certification | Product provider bridge and provider status API/test target | Adapter-specific capability/access not yet certified; S-LIVE gates T-15 |

No permanent new agents, plugins or framework installations are required by this spec. Future task owners are responsibilities, not claims that a team is already running. One lead controls schema/integration conflicts and `plan.json` status changes. An independent reviewer must be a distinct agent/person from the implementation owner for an independent acceptance claim.
