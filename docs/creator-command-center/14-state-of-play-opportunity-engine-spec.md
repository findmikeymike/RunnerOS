---
status: approved-for-implementation
owner: agent
last_verified: 2026-07-10
source_of_truth: true
depends_on:
  - docs/creator-command-center/09-hq-state-of-play-proactive-routing.md
  - docs/creator-command-center/10-work-products-output-architecture-spec.md
  - docs/creator-command-center/13-scheduled-work-composer-execution-spec.md
---

# State Of Play Opportunity Engine

## Purpose

State of Play should become the operating intelligence layer for Artist HQ. It should continuously answer:

```text
What deserves attention now?
What valuable work can safely be prepared or run next?
What is already happening, blocked, duplicated, stale, or awaiting a decision?
Did the last recommendation create a useful result?
```

This specification evolves the deterministic V1 brief into a durable opportunity and obligation engine. V1 remains the shipped contract until each phase here is implemented and verified.

## Product Outcome

The finished system should:

- identify obligations, risks, opportunities, and missing foundations
- rank several candidate moves instead of following one fixed ladder
- understand current work before proposing more work
- connect recommendations to evidence and expected outcomes
- safely prepare or execute bounded internal work
- preserve approval boundaries for external or consequential actions
- track whether recommendations were useful
- improve ranking from explicit outcomes without becoming opaque
- remain inexpensive enough to refresh frequently

State of Play is not a general autonomous agent. It is a deterministic control plane that may use models for bounded interpretation and explanation.

## Non-Goals

Do not:

- give an LLM sole authority over priority, safety, spending, publishing, messaging, deletion, or account changes
- scan every full output, transcript, conversation, or asset on every refresh
- launch duplicate work when equivalent work is active or recently completed
- treat a recommendation as permission for an external action
- silently learn behavioral preferences from private content
- optimize for activity volume instead of useful outcomes
- require a model call for routine refreshes

## Core Principles

1. **Deterministic control, optional model assistance.** Collection, eligibility, scoring, safety, lifecycle, and execution authority remain code-owned. Model output must pass schema validation and deterministic gates.
2. **Operational truth before new ideas.** Pending approvals, failed work, deadline risks, and in-flight dependencies normally outrank speculative work.
3. **Recommendations are durable records.** Each recommendation needs an ID, evidence, score, lifecycle, execution link, and outcome.
4. **Explain every decision.** Show why a move ranked highly, what supports it, what blocks it, and why alternatives ranked lower.
5. **Prepare more freely than execute.** Internal drafts, plans, and research may be prepared under policy. External writes retain exact approval requirements.
6. **Learn slowly and reversibly.** Improve from explicit accepts, dismissals, snoozes, completions, and usefulness feedback. Never mutate safety policy.

## Architecture

```text
Source adapters
  -> normalized signal snapshot
  -> candidate generators
  -> eligibility and duplicate gates
  -> deterministic scorer
  -> policy and execution gates
  -> ranked recommendation set
  -> UI / HNIC / scheduled evaluation
  -> execution link
  -> outcome evaluation
  -> bounded preference updates
```

These stages must remain separate modules. Do not rebuild the system as one large composer function.

## Sources And Compact Indexes

Consume compact indexes or summaries, not full records on every refresh.

| Family | Required evidence |
| --- | --- |
| Artist context | profile completeness, goals, release phase, constraints |
| Calendar | upcoming dates, deadlines, release days, conflicts |
| Campaigns | active phase, goals, missing dependencies, next milestone |
| Vault / Finals | required asset availability, version, readiness |
| Outputs | recent work, approval status, failures, promoted finals |
| Scheduled Work | queued, waiting, running, failed, approval-blocked, completed |
| Automations | enabled state, recent failures, next run, hidden-calendar jobs |
| Workflows | active runs, failed steps, dependencies, produced outputs |
| Agent sessions | route launch, completion state, linked artifact |
| Shared Intel | relevant findings, confidence, destination, age |
| Analytics | snapshot age, deltas, anomalies, meaningful trends |
| Network / community | pending replies, staleness, authorized outreach |
| Team Mode | owner, collaborator activity, conflicting work |

```ts
interface StateSignal {
  id: string
  kind: string
  scope: { type: 'hq' | 'campaign'; campaignId?: string }
  title: string
  observedAt: string
  effectiveAt?: string
  expiresAt?: string
  severity?: 'info' | 'low' | 'medium' | 'high' | 'critical'
  confidence: number
  entityRefs: EntityRef[]
  sourceRefs: SourceRef[]
  facts: Record<string, unknown>
}
```

Signal IDs must be stable for the same underlying fact so the engine can detect changes and duplicates.

## Freshness

Every adapter defines a freshness timestamp, stale threshold, unavailable state, degraded state, and confidence effect. Do not treat `present` as fresh. Expired evidence can remain visible but must lower confidence or generate a refresh candidate.

Thresholds are source-specific and configurable. Store source health in every snapshot.

## Candidate Move Contract

The durable unit of reasoning is a candidate move.

```ts
interface CandidateMove {
  id: string
  fingerprint: string
  type: 'obligation' | 'risk' | 'opportunity' | 'foundation' | 'recovery'
  scope: { type: 'hq' | 'campaign'; campaignId?: string }
  title: string
  reason: string
  desiredOutcome: string
  completionCriteria: CompletionCriterion[]
  evidence: EvidenceRef[]
  generatedBy: GeneratorRef
  owner: OwnerRef
  route?: RouteProposal
  dimensions: ScoreDimensions
  score: ScoreResult
  policy: PolicyDecision
  lifecycle: RecommendationLifecycle
  createdAt: string
  updatedAt: string
  expiresAt?: string
}
```

The fingerprint represents equivalent intent, for example:

```text
campaign:blue-moon + produce:cover-art + final-ready
```

Equivalent active work suppresses or annotates the candidate instead of creating another job.

## Candidate Generators

Initial generators:

- deadline and release readiness
- pending approval and decision
- failed or stalled work recovery
- missing dependency unblock
- campaign next milestone
- goal progression
- fresh intelligence response
- analytics anomaly or opportunity
- relationship and community follow-up
- context freshness and foundation repair
- weekly operating review

Each generator declares required signals, candidate type, owner capability, completion criteria, expiry behavior, duplicate fingerprint rules, and applicable scope/phase.

Do not hardcode agent slugs in generators. Route through a capability registry, then resolve eligible active workers.

## Scoring

Generate multiple candidates, then score normalized dimensions from `0` to `1`:

| Dimension | Meaning |
| --- | --- |
| urgency | Deadline proximity, severity, or decay if delayed |
| impact | Expected value to the artist or campaign |
| goalAlignment | Connection to an explicit active goal |
| unblockValue | Importance of downstream dependencies released |
| evidenceConfidence | Evidence completeness, freshness, and reliability |
| readiness | Availability of context, worker, tools, and dependencies |
| effort | Estimated time, token, browser, and human-review cost |
| risk | Consequence, ambiguity, reversibility, and failure cost |
| duplicatePenalty | Equivalent active or recently completed work |
| fatiguePenalty | Repeatedly dismissed, snoozed, or over-shown category |

Example initial formula:

```text
priority =
  0.22 urgency
  + 0.20 impact
  + 0.16 goalAlignment
  + 0.15 unblockValue
  + 0.11 evidenceConfidence
  + 0.10 readiness
  - 0.03 effort
  - 0.03 risk
  - duplicatePenalty
  - fatiguePenalty
```

Weights are versioned configuration, not hidden prompt text. Obligations and critical risks may receive deterministic boosts.

```ts
interface ScoreResult {
  modelVersion: string
  total: number
  dimensions: ScoreDimensions
  boosts: ScoreAdjustment[]
  penalties: ScoreAdjustment[]
  explanation: string[]
}
```

The initial weights are hypotheses. Measure outcomes before tuning them.

## Eligibility And Hard Gates

Scoring never overrides hard gates. A candidate may be visible but not executable when:

- evidence is missing or too stale
- no eligible worker capability exists
- equivalent work is queued, running, waiting, or awaiting approval
- a prerequisite is incomplete
- a required source or credential is unavailable
- the user or team disabled the category
- budget, frequency, or concurrency limits are exceeded
- exact authorization is absent for an external action
- the candidate is expired, dismissed, completed, or superseded

Hard gates return stable codes and user-readable explanations.

## Recommendation Snapshot

Persist a ranked set, not only one next move.

```ts
interface StateOfPlaySnapshotV2 {
  version: 2
  id: string
  workspaceId: string
  scope: { type: 'hq' | 'campaign'; campaignId?: string }
  generatedAt: string
  reason: RefreshReason
  sourceHealth: SourceHealth[]
  primaryRecommendationId?: string
  candidateIds: string[]
  attention: AttentionItem[]
  momentum: MomentumFinding[]
  activeWork: ActiveWorkSummary[]
  decisionsWaiting: DecisionSummary[]
}
```

Persist top candidates and their evidence. Do not retain every discarded low-value idea indefinitely.

## Lifecycle And Idempotency

Recommendation states:

```text
proposed -> viewed -> accepted -> launched -> in_progress
in_progress -> awaiting_approval -> completed
proposed/viewed -> dismissed | snoozed | expired | superseded
launched/in_progress -> failed
```

Every transition records actor, timestamp, reason, and linked entities.

Launching must atomically:

1. revalidate candidate and route
2. verify no equivalent work appeared
3. create or link the session, work order, workflow run, or scheduled item
4. transition to `launched`
5. save the execution reference

Retries use an idempotency key derived from recommendation ID and execution intent.

## Completion And Outcomes

Starting an agent is not success. Each move defines objective completion criteria, such as:

- required Output exists and reaches the expected state
- Final pointer exists for a required asset
- scheduled item completes with a receipt
- workflow completes required steps
- user decision is recorded
- source freshness is restored
- dependency is no longer blocked

```ts
interface RecommendationOutcome {
  recommendationId: string
  status: 'successful' | 'partial' | 'unsuccessful' | 'unknown'
  evaluatedAt: string
  evidence: EvidenceRef[]
  completionCriteria: CriterionResult[]
  userUsefulness?: 'useful' | 'neutral' | 'not_useful'
  notes?: string
}
```

Evaluate objective criteria automatically. Keep user feedback optional and one-click.

## Proactive Modes

Replace the ambiguous boolean toggle with an explicit workspace policy.

### Observe

- refresh and rank recommendations
- notify according to user settings
- never create work

### Prepare

- may launch approved internal, reversible work
- examples: research, briefs, plans, drafts, organization, analysis
- must produce an Output or decision packet
- obeys budgets, concurrency, quiet hours, and category controls
- cannot publish, message, spend, delete, or alter external accounts

### Execute Safe

- may run explicitly allowlisted actions with clear completion criteria
- requires workspace policy and per-category enablement
- external writes remain approval-gated unless an exact scheduled mandate already grants permission

Mode is workspace-owned and team-visible. Device-local preferences may control notifications, not execution authority.

```ts
interface ProactivePolicy {
  mode: 'observe' | 'prepare' | 'execute_safe'
  enabledCategories: string[]
  disabledCategories: string[]
  maxConcurrentRuns: number
  dailyTokenBudget?: number
  dailyCostBudgetUsd?: number
  browserMinutesPerDay?: number
  quietHours?: QuietHours
  allowedWorkerCapabilities: string[]
  requireApprovalFor: ActionClass[]
}
```

Budget exhaustion creates an attention item and fails closed.

## Capability-Based Routing

Workers advertise capabilities and constraints:

```ts
interface WorkerCapability {
  capability: string
  workerSlug: string
  scopes: Array<'hq' | 'campaign'>
  actionClasses: ActionClass[]
  requiredSources: string[]
  produces: string[]
  supportsProactiveModes: Array<'prepare' | 'execute_safe'>
  estimatedCostClass: 'low' | 'medium' | 'high'
}
```

Routing records why the selected worker won. A missing worker preserves the recommendation but blocks its route with a clear missing-capability reason.

## Momentum And Readiness

Momentum requires comparison, not absolute counts. Each finding includes baseline, current value, direction, window, confidence, freshness, and relevance to an active goal.

Missing context must depend on current phase and intended work. Readiness templates are typed and versioned by scenario. An early identity phase, release campaign, evergreen growth campaign, and outreach mission should not receive the same checklist.

## User Experience

Keep the main card concise:

- top recommendation
- why now
- expected result
- equivalent or dependent work status
- policy-appropriate action
- snooze and dismiss
- `Why this?` disclosure
- alternatives count

Expanded details show evidence freshness, plain-language score reasons, blockers, alternatives, history, and linked runs/outputs/approvals. Do not expose raw scores as false precision by default.

## HNIC Contract

HNIC may request, explain, accept, dismiss, snooze, or launch eligible recommendations. It may create a candidate from an explicit user request.

HNIC may not bypass gates, alter outcome history, claim completion without evidence, or convert a manual route into an executable route merely because a worker exists.

## Refresh Architecture

Use event-driven dirty marking plus debounced recomposition. Refresh after:

- context, campaign, calendar, Vault, or Final changes
- Output or approval changes
- Scheduled Work or workflow transitions
- automation run or configuration changes
- route launch or agent completion
- Shared Intel routing
- analytics updates
- team ownership/activity changes
- explicit refresh
- periodic stale-source checks

Do not recompute synchronously inside every mutation. Mark relevant HQ/campaign scopes dirty and coalesce rapid events. Store refresh reason and source versions so decisions can be reproduced.

## Learning

V2 learning is bounded preference adjustment, not self-modifying policy.

Allowed inputs: accepted/dismissed categories, snooze duration, completed/abandoned work, explicit usefulness, preferred eligible workers, and preferred timing.

Allowed effects: small capped rank adjustments, fatigue suppression, notification timing, and tie-breaking worker preference.

Disallowed: weakening safety, hiding obligations, learning from sensitive content without an explicit event, changing budgets/mode, or allowing a model to rewrite weights.

Every learned preference is visible, resettable, scoped, and versioned.

## Model Use

The engine must work without a model for operational signals. Appropriate model uses include structured extraction from Shared Intel, goal-to-capability mapping, concise explanations, candidate deduplication hints, and rubric-based qualitative evaluation.

Requirements:

- strict schemas and bounded compact inputs
- recorded model/prompt version
- timeout and inexpensive fallback
- cache by input fingerprint
- no model call on every render
- deterministic policy revalidation after model output

## Storage

Keep separate stores for the latest snapshot, durable candidates, append-only lifecycle events, outcomes, workspace policy, and bounded preferences.

The generated `hq-state-of-play` context doc remains a compact compatibility and agent-awareness projection. It is not the authoritative lifecycle database.

Team Mode requires shared recommendation state and atomic transitions. Contracts must remain transport-neutral.

## Observability

Measure candidates generated/gated/displayed, lifecycle conversion, time to useful outcome, duplicates prevented, stale recommendations, model cost/latency/fallback, proactive work by mode/category, approvals, and usefulness feedback.

Do not optimize only for acceptance. Completion and usefulness are stronger signals.

## Failure And Security

- Adapter failure preserves the last snapshot, marks it stale, and retries.
- Scoring failure falls back to deterministic obligation-first ordering.
- Model failure omits enhancement and continues.
- Launch races reject duplicates and link existing work.
- Worker failure may generate one recovery candidate.
- Unknown outcome never becomes success without evidence.
- Secrets never enter snapshots, prompts, evidence, or recommendation records.
- Use entity references instead of copying sensitive message bodies.
- Enforce workspace/campaign access on every read and transition.
- Team history records who accepted, launched, dismissed, or approved work.

## Migration From V1

- Keep parsing `HqStateOfPlay version: 1` during migration.
- Introduce V2 contracts additively.
- Project the V2 primary recommendation into the existing panel until V2 UI lands.
- Preserve the `hq-state-of-play` context slug.
- Do not infer completed lifecycle records from old launches.
- Replace the local proactive boolean only after workspace policy migration exists.
- Remove the UI manual-to-agent conversion; policy owns route authority.

## Implementation Phases

### Phase 1: Operational awareness

Implementation status: foundational slice implemented 2026-07-10.

Implemented in the foundational slice:

- compact operational snapshot for Outputs, Scheduled Work, workflow runs, and automation failures
- approvals and failures prioritized ahead of speculative context recommendations
- active-work duplicate suppression across existing V1 next moves
- recomposition after Output, Scheduled Work, workflow, and automation execution changes
- adapter, collision, priority, and regression coverage
- typed HQ/campaign scope on every operational item
- source-health reporting for fresh, degraded, and unavailable adapters
- versioned intent fingerprints with migration fallback matching
- configured automation names and malformed-history detection
- explicit HQ/campaign snapshot filtering
- source-health projection into the generated brief and Artist HQ card
- automation schema and semantic configuration validation, including before first run
- source-specific stale-evidence windows for Outputs, Scheduled Work, workflow runs, and automation history
- producer semantic intent IDs from Output tags, Scheduled Work producers, workflow trigger inputs, and automation IDs
- Scheduled Work `intentId` separated from execution idempotency and populated by HNIC, automation, and calendar-composer producers
- canonical semantic intent generation shared by recommendation candidates and Scheduled Work producers for exact V2 duplicate matching

Still required before declaring Phase 1 complete:

- campaign-scoped source-health presentation when Campaign State of Play gets its own rendered surface
- producer migration coverage for legacy Scheduled Work and older Output/workflow producers before token-overlap fallback can be removed

Rival hardening completed 2026-07-10:

- split release deliverable fingerprints so cover, master, press photo, and EPK work do not suppress each other
- expire automation failures after 14 days and workflow failures after 30 days unless newer state resolves them first
- filter primary approvals, failures, and duplicate checks to the current HQ/campaign scope
- recover campaign scope for Scheduled Work-linked workflow runs
- preserve exact Output, Scheduled Work, workflow-run, or automation entity references in the generated next move
- route referenced Outputs and workflow runs directly, Scheduled Work to Calendar, and automation failures to Automations
- removed manual-to-agent route promotion in the UI
- debounce Output, workflow, and automation refresh storms while keeping direct user mutations immediate

- define signals, entity references, source health, and compact indexes
- add Outputs, Scheduled Work, workflow, automation, and approval adapters
- add active-work and decision-waiting summaries
- refresh after operational changes
- suppress exact duplicate work

Exit gate: State of Play avoids equivalent active jobs and reliably surfaces pending approvals and failures.

### Phase 2: Durable candidates

Implementation status: foundational lifecycle slice implemented 2026-07-10.

Implemented:

- atomic workspace-local recommendation store under `.state-of-play/recommendations.json`
- append-only lifecycle events under `.state-of-play/events.jsonl`
- deterministic recommendation IDs reused across refreshes
- lifecycle state preserved while display evidence refreshes
- validated lifecycle transitions, snooze deadlines, and execution-reference deduplication
- automatic snooze revival with an explicit system event
- recommendation ID/status projection into the generated context document
- backend-owned list/transition RPC handlers
- persistent seven-day snooze and dismiss controls in the State of Play card
- exact session linkage after a successful route launch
- deterministic ranked set containing current-scope approvals, failures, and the best contextual opportunity
- stable lifecycle persistence for primary and alternative recommendations
- compact `Also Consider` alternatives in the State of Play card
- Output-backed reconciliation from launched/in-progress to awaiting approval, completed, or failed
- backend-owned agent launch with route/status revalidation and server-created session linkage
- dispatch rollback that marks the recommendation failed and removes the orphan session
- persisted Output completion contracts with exact recommendation tag and expected-agent matching
- linked Output projection so completed recommendations open their concrete work product
- lifecycle-aware card actions for active, approval-waiting, completed, and retryable work
- last-known-good storage backup with fail-closed corruption handling and diagnostic preservation
- age-aware approval ranking so older unresolved decisions are not starved by newer ones
- objective outcome ledger under `.state-of-play/outcomes.json`
- direct completion reconciliation for linked Outputs, Scheduled Work, workflow runs, and automation runs
- resolved observed obligations retire as superseded without falsely claiming State of Play launched them
- compact lifecycle history disclosure in Artist HQ
- explicit useful/not-useful feedback persisted independently from lifecycle status
- recent resolved-outcome projection keeps feedback reachable after the next recommendation is promoted
- terminal-outcome self-repair after an interrupted lifecycle/outcome write
- stale/mismatched outcome correction after a later successful retry
- strict outcome-store validation with last-known-good recovery and fail-closed diagnostics
- fail-soft automation outcome reads that preserve the rest of reconciliation
- lifecycle detail refresh while the same recommendation remains visible

Still required before declaring Phase 2 complete:

- richer partial-outcome criteria beyond terminal entity status
- Team Mode transport/locking beyond workspace-local atomic files

- add candidate, fingerprint, lifecycle event, and outcome storage
- persist ranked candidates
- atomically link launches to executions
- add snooze, dismiss, and history
- evaluate objective completion criteria

Exit gate: every displayed recommendation traces from evidence through execution to outcome.

### Phase 3: Ranked opportunity engine

- split V1 composer into adapters and generators
- introduce versioned scoring and breakdowns
- add phase-aware readiness templates
- show alternatives and ranking reasons
- resolve workers by capability

Exit gate: collision scenarios rank correctly and fixtures reproduce scoring changes.

### Phase 4: Prepare mode

- add workspace policy and budgets
- allowlist reversible internal work
- enforce concurrency, quiet hours, and costs
- require Outputs and completion criteria
- add notifications and audit history

Exit gate: unattended preparation creates useful internal artifacts without external side effects or duplicates.

### Phase 5: Bounded adaptation

- collect usefulness and lifecycle outcomes
- add capped preference adjustments and fatigue suppression
- expose reset controls
- add offline evaluation fixtures

Exit gate: usefulness improves without changing safety or hiding obligations.

### Phase 6: Execute Safe

- define narrow action allowlists
- integrate scheduled mandates and approval contracts
- add recovery, receipts, and team ownership
- require release-grade security and live smoke verification

Exit gate: every execution is bounded, attributable, idempotent, budgeted, and evidenced.

## Required Tests

Unit coverage must include adapter freshness, candidate generation, scoring/ties, fingerprints, capability resolution, gates, lifecycle transitions, completion evaluation, and preference caps.

Integration and safety fixtures must include:

- release in ten days, cover missing, art job already running
- social post awaiting approval tomorrow
- vague active goal competing with urgent fan replies
- ninety-day-old analytics snapshot
- repeatedly dismissed outreach
- failed automation without an Output
- campaign Output ready but not promoted to Final
- early-stage artist with no active release
- collaborator launching from another device
- agent session ending without a valid Output
- launch race creating only one execution
- Prepare mode attempting an external write
- model proposal attempting to bypass a gate

## Success Metrics

Track fewer duplicate jobs, lower pending-approval/failure age, more recommendations producing valid Outputs or decisions, fewer repeated dismissals, lower cost per useful outcome, zero unauthorized external actions, and complete explanations for displayed recommendations.

## First Implementation Slice

Start with Phase 1 only: connect existing operational indexes and add duplicate suppression. Do not add automatic execution, model-based ranking, or learned preferences yet.

This factual foundation immediately prevents the most damaging behavior: recommending more work while important work is already running, failed, or waiting for approval.
