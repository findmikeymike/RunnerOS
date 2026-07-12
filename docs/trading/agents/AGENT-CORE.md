---
status: draft
owner: human
last_verified: 2026-07-11
source_of_truth: true
---

# Trade God — Agent Core Blueprint

## Purpose

This document defines the universal anatomy of a high-quality Trade God agent.

It is deliberately domain-independent. The same core applies to an Order Flow Agent, Fundamental Agent, Wyckoff Agent, News Agent, Options Agent, Risk Agent, Journal Agent, or Head Trader. Their doctrine, data, tools, outputs, permissions, and evaluation differ; their architectural bones remain consistent.

This is both:

- A design template.
- A build checklist.
- A review standard.
- A definition-of-done gate.

An agent should not be admitted to the trading desk merely because it has a name and an impressive system prompt.

## The Anatomy Metaphor

Every complete agent needs:

| Anatomy | System Meaning |
|---|---|
| Heart | Mission, values, mandate, and decision standard |
| Brain | Model, reasoning policy, doctrine, and cognition loop |
| Skeleton | Contracts, state boundaries, lifecycle, and stable structure |
| Blood | Typed evidence, provenance, freshness, and causal flow |
| Senses | Data sources, tools, visual inputs, and environmental state |
| Hands | Bounded actions, scripts, artifacts, and side effects |
| Nervous system | Events, messages, workflows, schedules, and escalation |
| Memory | Context layers, reviewed lessons, and durable artifacts |
| Immune system | Permissions, validation, critics, risk checks, and failure handling |
| Voice | Human-facing explanation, uncertainty, and UX contract |
| Professional record | Receipts, evaluations, calibration, versions, and outcomes |

If one of these is missing, the agent is incomplete even if it can produce plausible prose.

## What an Agent Is

A Trade God agent is:

> A saved, versioned specialist definition that can be instantiated as an isolated, bounded reasoning session; receives a compiled context and explicit task; uses authorized deterministic capabilities; produces schema-valid artifacts; communicates through receipted messages; acts only within policy; and improves through reviewed evaluation rather than uncontrolled self-modification.

An agent is not:

- A permanently running language model.
- A long prompt.
- A folder of disconnected scripts.
- A chatbot with every tool.
- A human role name attached to generic behavior.
- A signal generator with no evidence contract.
- A direct pathway to broker authority.

## Universal Lifecycle

```text
Definition installed
→ activated in workspace
→ trigger creates task
→ policy validates invocation
→ context compiler builds bundle
→ isolated session launches
→ agent observes through tools
→ agent reasons under doctrine
→ optional bounded collaboration
→ schema validates output
→ artifact and receipt persist
→ allowed downstream actions occur
→ outcome is evaluated
→ reviewed memory/skill change proposed
→ new version passes regression gate
```

Each transition must be inspectable. No critical state should exist only inside a model’s hidden chain of thought or an ephemeral chat transcript.

## Agent Classes

All agents share the same core but may belong to different operational classes.

### Analyst

Measures and interprets a domain. Produces analysis, scenarios, confirmations, and annotations.

Examples: Order Flow, Volume Profile, Fundamental, Options, Sentiment.

### Coordinator

Decomposes decisions, routes tasks, synthesizes conflicts, and owns the final combined artifact.

Examples: Head Trader, Research Lead.

### Monitor

Usually deterministic. Watches events and wakes reasoning agents only when thresholds or state transitions occur.

Examples: Data Quality Monitor, Profile Event Monitor, Risk Limit Monitor.

### Operator

Performs bounded external actions through explicit approval and receipts.

Examples: Alert Operator, Data Download Operator. Execution remains a particularly restricted operator.

### Guardian

Independently validates policy, evidence, risk, security, or completion.

Examples: Risk Agent, Truth/Critic Agent, Compliance Agent.

### Evaluator

Scores artifacts and outcomes under replayable rubrics.

Examples: Backtest Agent, Journal Agent, Calibration Agent.

An agent may combine adjacent classes only when permissions and ownership remain clear. The Head Trader should not also be the independent Risk Guardian.

## Universal Package Layout

```text
agents/<agent-slug>/
├── AGENT.md
└── CHANGELOG.md                    # once versioned behavior changes

skills/<primary-domain-skill>/
├── SKILL.md
├── references/
│   ├── doctrine.md
│   ├── terminology.md
│   ├── decision-framework.md
│   ├── setup-or-case-cards.yaml
│   ├── failure-modes.md
│   └── examples.md
├── schemas/
│   └── primary-output.v1.json
└── tests/                          # skill/evaluation fixtures where appropriate

sources/<source-slug>/
├── config.json
└── guide.md

services/<deterministic-capability>/
├── contracts/
├── adapters/
├── src/
├── tests/
└── README.md

workflows/<workflow-slug>/
└── WORKFLOW.md

context/<context-slug>/
└── CONTEXT.md

evaluations/<agent-slug>/
├── rubric.yaml
├── golden-cases/
├── adversarial-cases/
├── regression-cases/
└── accepted-baseline.json
```

Not every agent needs custom services or multiple skills. Reuse shared capabilities. Avoid creating a new tool or skill when an existing one has the same responsibility.

## Universal Agent Manifest

```yaml
---
name: Human-readable specialist name
description: One sentence explaining the bounded job
avatar: optional-symbol

llmConnection: workspace-or-agent-connection
model: configured-model
permissionMode: safe
thinkingLevel: high

skills:
  - primary-domain-skill
  - market-evidence-standard

sources:
  - authoritative-data-source
  - deterministic-analysis-source
  - artifact-ledger

visualAgent: false

inputs: Exact task envelope and evidence the agent expects
outputs: Exact primary artifacts and decisions the agent promises

tags:
  - domain
  - capability
  - role-class
---
```

The body contains the behavioral contract:

```text
Identity
Mission
Decision ownership
Required workflow
Evidence rules
Tool rules
Communication rules
Action permissions
Forbidden actions
Output rules
Uncertainty and refusal rules
Memory rules
Completion criteria
```

The system prompt should remain operational. Long doctrine, examples, and changing reference knowledge belong in skills and context documents.

# Part I — The Heart

## 1. Identity

The identity answers:

- Who is this specialist?
- What professional lens does it use?
- What does it care about?
- What does it refuse to pretend to know?

Good identity:

> You are the Options Volatility Agent. You analyze option-chain structure, implied volatility, skew, term structure, and exposure. You support trade research; you do not determine portfolio risk or place orders.

Weak identity:

> You are an elite world-class trader who always finds profitable opportunities.

Identity is a responsibility boundary, not role-play hype.

## 2. Mission

The mission should be one testable sentence containing:

- Domain.
- Decision supported.
- Evidence standard.
- Primary output.
- Boundary.

Template:

> Determine **[domain question]** using **[authoritative evidence]**, produce **[typed artifact]** for **[downstream owner]**, and stop before **[forbidden authority]**.

## 3. Mandate

The mandate defines what decisions the agent owns.

Checklist:

- [ ] Primary questions are explicit.
- [ ] Secondary questions are explicit.
- [ ] Out-of-scope questions are explicit.
- [ ] Upstream dependencies are named.
- [ ] Downstream consumers are named.
- [ ] Final decision owner is named.
- [ ] The agent knows when to refuse, escalate, or return unavailable.

## 4. Values and Decision Standard

Every Trade God agent should share these values:

- Truth over confidence.
- Fresh evidence over memory.
- Conditional scenarios over unconditional prediction.
- Reproducibility over persuasive prose.
- Explicit disagreement over false consensus.
- No-trade over forced action.
- Independent risk authority.
- Visible uncertainty.
- Receipts over invisible side effects.

# Part II — The Brain

## 5. Model Configuration

Model choice is part of the agent’s versioned behavior.

Define:

- Provider and connection.
- Model ID.
- Reasoning/thinking level.
- Context-window assumptions.
- Multimodal requirements.
- Structured-output support.
- Latency and cost budget.
- Fallback model policy.
- Whether model switching is allowed mid-run.

Do not silently change a production agent’s model. Model changes can alter tool choice, confidence, refusal behavior, schema compliance, and interpretation.

## 6. Primary Skill

Every specialist should normally have one strong primary domain skill.

The skill contains:

- When to invoke it.
- Domain doctrine.
- Terminology.
- Analytical sequence.
- Required evidence.
- Interpretation patterns.
- Alternative hypotheses.
- Failure modes.
- Refusal conditions.
- Output schema.
- Representative examples.

Add secondary skills only when their jobs are genuinely distinct, such as a shared evidence standard or chart-annotation contract.

## 7. Cognition Loop

Every reasoning agent should implement a domain-specific form of this loop:

```text
1. Frame the decision
2. Validate mandate and permissions
3. Validate data capability and freshness
4. Retrieve authoritative measurements
5. Establish relevant context
6. Generate multiple hypotheses
7. Seek disconfirming evidence
8. Request narrow specialist evidence if material
9. Build conditional scenarios
10. Emit schema-valid artifact
11. Take only allowed downstream actions
12. Register evaluation point
```

The loop should be stated in the skill and tested through evaluation cases.

## 8. Uncertainty Policy

Agents need a common uncertainty vocabulary:

```text
measured       — directly returned by an authoritative deterministic source
derived        — deterministically calculated from identified inputs
observed       — grounded description of data or visual state
inferred       — interpretation supported by evidence
hypothesized   — plausible explanation requiring confirmation
estimated      — approximation due to limited data
unavailable    — feed/tool cannot support the claim
conflicted     — credible evidence materially disagrees
invalid        — data or contract failed validation
```

Confidence must name its basis. A numeric probability is prohibited unless calibration data justifies it.

## 9. Completion Contract

The agent is not done merely because it returned text.

Possible requirements:

- Non-empty output.
- Valid JSON schema.
- Required tool use.
- Freshness inside policy.
- At least one evidence citation.
- At least one alternative hypothesis.
- Explicit invalidation.
- Explicit no-action condition.
- Artifact successfully persisted.
- Required receipt created.

# Part III — The Skeleton

## 10. Stable Inputs

Every invocation uses a typed task envelope.

```json
{
  "schemaVersion": 1,
  "taskId": "task-uuid",
  "agentSlug": "specialist-agent",
  "caller": "head-trader",
  "objective": "Decision to support",
  "decisionQuestion": "Specific bounded question",
  "asOf": "ISO-8601",
  "instrumentIds": [],
  "session": "optional-session",
  "contextArtifactIds": [],
  "allowedSourceSlugs": [],
  "allowedSkillSlugs": [],
  "permissionMode": "safe",
  "priority": "normal",
  "timeoutSeconds": 180,
  "maxTurns": 8,
  "maxDepth": 2,
  "outputSchema": "artifact-type.v1",
  "expiresAt": "ISO-8601"
}
```

## 11. Stable Outputs

Each agent declares:

- Primary artifact type.
- Optional confirmation response.
- Optional chart annotation.
- Optional alert proposal.
- Optional escalation.
- Error/unavailable result.

Downstream systems should never scrape prose to discover whether an agent recommends action.

## 12. State Ownership

Document which component owns each state.

Example:

| State | Owner |
|---|---|
| Current price and market events | Market Data Gateway |
| Derived features | Deterministic feature service |
| Agent definition | Agent library |
| Doctrine | Skill package |
| Workspace preferences | Context documents |
| Agent lessons | Agent memory |
| Analysis | Artifact ledger |
| Portfolio and positions | Trading kernel/broker reconciliation |
| Risk limits | Risk policy store |
| Order authority | Execution enclave |

Duplicated state must be explicitly cached and invalidatable, never quietly treated as a second source of truth.

## 13. Versioning

Version at minimum:

- Agent definition.
- System prompt.
- Skill.
- Output schema.
- Deterministic engines.
- Market contracts.
- Model.
- Evaluation baseline.

Every artifact records the versions that produced it.

## 14. Lifecycle States

Suggested agent-definition states:

```text
draft
evaluation
shadow
accepted-read-only
accepted-paper
accepted-bounded-action
paused
deprecated
archived
```

Promotion requires evidence. An agent may be rolled back independently of the rest of the product.

# Part IV — The Blood

## 15. Evidence Envelope

Evidence flowing through the system needs:

- ID.
- Type and schema version.
- Instrument/entity scope.
- Event, exchange, receive, and creation timestamps as appropriate.
- `asOf` time.
- Provider and venue.
- Freshness.
- Entitlement/capability metadata.
- Input IDs and hashes.
- Engine/tool version.
- Quality flags.
- Expiry and invalidation.

## 16. Provenance

Every consequential claim should answer:

- Which source supplied the data?
- Which tool queried it?
- Which calculation transformed it?
- Which agent interpreted it?
- What context and upstream artifacts were present?
- What time did the claim describe?
- What limitations applied?

## 17. Temporal Integrity

All agents must obey strict as-of semantics.

- No artifact may depend on information newer than its as-of time.
- Replay tools must enforce a simulated clock.
- News publication time and later corrections are distinct events.
- Revised fundamentals and economic releases preserve vintages.
- Historical chart rendering stops at the replay cursor.
- Memory retrieval must not leak future outcomes into an earlier replay.

Temporal leakage is a critical failure, not a minor evaluation issue.

## 18. Freshness and Expiry

Each data or analysis type has a freshness policy.

Examples:

- Market snapshot: milliseconds or seconds.
- Short-horizon order-flow analysis: minutes.
- Pre-market brief: session-scoped.
- Fundamental thesis: days or until a material event.
- Risk decision: tied to exact portfolio and price snapshot.
- Order intent: seconds or explicitly defined.

Downstream systems reject expired artifacts automatically.

# Part V — The Senses

## 19. Sources

A source is a configured connection to an external or local capability.

Each source documents:

- Type: MCP, API, or local.
- Authentication.
- Data/capability offered.
- Entitlements and cost.
- Rate limits.
- Latency expectations.
- Health check.
- Freshness guarantees.
- Failure modes.
- Read/write classification.
- Safe-mode behavior.
- Credential boundary.

An agent declares only the sources it needs.

## 20. Tools

A good tool:

- Performs one bounded verb.
- Has typed inputs and outputs.
- Validates arguments.
- Names side effects.
- Supports dry-run where meaningful.
- Is idempotent where possible.
- Returns source, timestamp, and quality metadata.
- Emits stable errors.
- Is independently testable.
- Produces a receipt for consequential actions.

Tool names should describe capability:

```text
market.get_snapshot
profile.build
chart.add_annotations
artifact.publish
alert.create
```

Avoid vague tools such as `analyze_everything`, `trade`, or `do_research`.

## 21. Deterministic Services and Scripts

Numerical, sequence-sensitive, high-frequency, or authoritative logic belongs outside the language model.

Use a script or service for:

- Market normalization.
- Indicator and feature calculation.
- Portfolio accounting.
- Greeks.
- Risk checks.
- Backtests.
- Statistical tests.
- Data-quality validation.
- Replay clocks.
- Order construction and routing.

The agent decides which calculation to request, interprets the result, identifies missing evidence, and communicates implications.

Random one-off scripts should mature into a versioned CLI or service once another agent or workflow depends on them.

## 22. Visual Perception

Visual agents need two channels:

1. Structured scene state for exact values.
2. Rendered image for layout, shape, salience, and spatial relationships.

Rules:

- Never infer exact numbers solely from pixels.
- Record chart symbol, timeframe, session, as-of time, visible range, and layer state.
- Detect image/data mismatch.
- Emit drawings through structured annotation tools.
- Link every drawing to an artifact and agent version.
- Support expiration, invalidation, hide/show, and replay.

## 23. Data Quality Sense

Every agent either receives data-quality metadata or queries it before interpretation.

Possible states:

```text
valid
degraded
stale
incomplete
out-of-sequence
unsupported
conflicted
invalid
```

The agent’s skill defines what states permit analysis.

# Part VI — The Hands

## 24. Action Inventory

Every agent has a documented action matrix.

### Read

- Query sources.
- Read artifacts.
- Inspect charts.
- Retrieve routed context and memory.

### Analyze

- Invoke deterministic services.
- Compare scenarios.
- Run replay or backtest jobs.

### Communicate

- Send bounded agent messages.
- Notify the user.
- Request approval or clarification.

### Produce

- Publish artifacts.
- Create chart annotations.
- Create reports.
- Propose alerts.

### Mutate

- Activate alerts.
- Change configuration.
- Route orders.
- Modify external systems.

Mutation permissions are always explicit and narrow.

## 25. Permission Levels

Suggested universal modes:

```text
observe        — read and analyze only
safe-write     — write internal artifacts and own annotations
ask            — request approval for external or consequential actions
policy         — act within a signed, scoped, expiring policy envelope
forbidden      — action unavailable regardless of model request
```

A child agent cannot escalate beyond its caller’s permission.

## 26. Dry Run and Preview

Consequential actions should support:

- Proposed payload.
- Target.
- Cost or exposure.
- Policy evaluation.
- Expected side effect.
- Idempotency key.
- Expiry.
- Exact approval request.

The execution result receives a separate receipt.

## 27. Idempotency

Agents and workflows can retry. Every consequential mutation needs a stable idempotency key or equivalent duplicate protection.

Never assume “the model will remember it already clicked or submitted.”

# Part VII — The Nervous System

## 28. Triggers

An agent may be awakened by:

- User request.
- Coordinator delegation.
- Another specialist’s confirmation request.
- Manual workflow.
- Scheduled workflow.
- Deterministic event monitor.
- Webhook or external event.
- State transition.
- Evaluation harness.

Every trigger contains origin, causal ID, as-of time, deduplication key, priority, expiry, and expected output.

## 29. Messages

Agent messages are tasks, not casual chatter.

Required fields:

- Target.
- Bounded task.
- Decision question.
- Context/artifact references.
- Expected output.
- Output schema.
- Allowed sources and skills.
- Permission.
- Priority.
- Timeout.
- Turn and depth limits.
- Expiry.

Results include status, output, tools used, duration, and receipt.

## 30. Communication Rules

- The caller owns synthesis.
- The target returns only the requested result.
- Progress updates are reserved for material blockers or long tasks.
- A specialist may disagree explicitly.
- Messages carry artifact references, not complete transcripts.
- Cycles are limited by depth and causal graph checks.
- Expired messages are rejected.
- Broadcast is exceptional.

## 31. Workflows

Use workflows for repeatable multi-step execution.

Each step names:

- Agent.
- Input template.
- Output schema.
- Completion requirements.
- Timeout.
- Retries.
- Failure policy.
- Human checkpoint where necessary.

Workflow runs freeze a definition snapshot so later edits do not rewrite history.

## 32. Schedules and Monitors

Language-model agents should not poll high-frequency state.

- Deterministic monitors watch streams.
- Schedules wake workflows at meaningful times.
- Cooldown and deduplication prevent noise.
- Health failures suppress unsafe triggers.
- Agent artifacts may create temporary conditional monitors.

# Part VIII — Memory

## 33. Context Layers

Context should be compiled in this order:

1. Core safety and platform policy.
2. Agent identity and mandate.
3. Primary skill and selected references.
4. Routed workspace context.
5. User preferences relevant to the task.
6. Agent-specific reviewed memory.
7. Task envelope.
8. Upstream artifacts.
9. Live tool evidence as queried.

Each injected item appears in a launch receipt.

## 34. Context-Budget Policy

The compiler should prioritize:

- Required policy.
- Exact task.
- Current authoritative evidence.
- Relevant upstream artifacts.
- Domain doctrine needed for this case.
- Small reviewed memory set.

It should omit:

- Unrelated workspace documents.
- Entire historical conversations.
- Raw high-volume streams.
- Duplicate summaries.
- Low-confidence memories.
- Reference material the agent can retrieve on demand.

## 35. Memory Classes

### User Memory

Stable preferences, goals, terminology, and working style useful across agents.

### Agent Memory

Reviewed lessons and domain-specific calibration useful primarily to one specialist.

### Workspace Context

Explicit operating documents, policies, universe definitions, and shared conventions.

### Artifact History

Immutable prior analyses and outcomes, searchable but not automatically believed.

### Not Memory

- Current market data.
- Current portfolio state.
- Current order state.
- Secrets.
- Unreviewed model speculation.

## 36. Memory Write Policy

Memory changes should be proposals containing:

- Candidate lesson.
- Evidence and linked outcomes.
- Scope.
- Confidence.
- Expiry/review date.
- Potential conflict with existing memory.
- Reviewer or policy decision.

The agent should not directly rewrite its own professional doctrine after one result.

# Part IX — The Immune System

## 37. Guardrails

Every agent documents:

- Allowed tools.
- Forbidden tools.
- Permission ceiling.
- Data freshness requirements.
- Required approvals.
- External side-effect policy.
- Secret-access policy.
- Network boundaries.
- Maximum delegation depth.
- Cost/time budget.
- Kill or pause behavior.

## 38. Independent Validation

Consequential outputs may require:

- Schema validator.
- Data-quality validator.
- Temporal-integrity validator.
- Risk policy engine.
- Independent Guardian agent.
- Human approval.

The producer cannot self-certify every property of its own work.

## 39. Failure Taxonomy

Standardize failure codes:

```text
invalid-task
out-of-mandate
missing-source
unsupported-capability
authentication-required
stale-data
incomplete-data
sequence-gap
schema-invalid
tool-failed
timeout
budget-exceeded
permission-denied
approval-required
conflicting-evidence
expired
cancelled
downstream-unavailable
```

Failures are outputs with receipts, not swallowed exceptions.

## 40. Safe Degradation

Define what happens when:

- Preferred model is unavailable.
- A source fails.
- A deterministic engine fails.
- Context is too large.
- Another agent times out.
- Visual rendering fails.
- Data becomes stale mid-run.
- Artifact persistence fails.

Fallbacks must not silently lower the evidence standard. Returning unavailable is often the correct behavior.

# Part X — Voice and Human Experience

## 41. Explanation Contract

Human-facing outputs should lead with:

1. Conclusion or status.
2. Strongest evidence.
3. What would confirm or invalidate it.
4. Material uncertainty.
5. Next useful action.

Avoid:

- Fake certainty.
- Unexplained jargon.
- Long narratives hiding the decision.
- Repeating raw tool output.
- Trading theatrics.

## 42. Visual Presence

An agent should have visible product surfaces appropriate to its role:

- Status and health.
- Current assignment.
- Recent artifacts.
- Chart layers.
- Pending requests.
- Confidence and expiry.
- Performance/evaluation history.
- Tools and data sources.
- Permission mode.

The user should not need to open a chat to understand what the agent is doing.

## 43. User Control

The user can:

- Invoke or pause the agent.
- Inspect its definition.
- See its skills and tools.
- View its context receipt.
- Hide its chart layers.
- Reject or correct an analysis.
- Review memory proposals.
- Compare versions.
- Change permission mode within policy.
- Disable schedules or triggers.

# Part XI — Professional Record

## 44. Receipts

Every run receipt records:

- Origin.
- Agent and version.
- Model and connection.
- Permission mode.
- Skills.
- Sources.
- Context documents.
- Memory entries.
- Parent workflow/message.
- Start/end time.
- Tools used.
- Output artifact.
- Status and failure.

Every consequential action receives an additional action receipt with intended and observed result.

## 45. Evaluation Rubric

Every agent has a domain-specific rubric built on universal dimensions:

- Correctness.
- Evidence grounding.
- Temporal integrity.
- Data-quality discipline.
- Scope discipline.
- Alternative hypotheses.
- Invalidation quality.
- Confidence calibration.
- No-action judgment.
- Tool selection.
- Communication efficiency.
- Schema compliance.
- Cost and latency.
- Safety and permissions.

## 46. Evaluation Case Types

- Golden normal cases.
- Boundary cases.
- Missing-data cases.
- Stale-data cases.
- Conflicting-evidence cases.
- Tool-failure cases.
- Adversarial prompt cases.
- Replay cases.
- Shadow/live-observation cases.
- Regression cases from past failures.

## 47. Calibration

Confidence should be compared with outcomes across similar cases.

Track:

- Frequency of high/medium/low confidence.
- Resolution rate.
- False-positive and false-negative patterns.
- No-action frequency and quality.
- Performance by regime and data quality.
- Value added by specialist confirmations.
- Drift after model, skill, or tool changes.

## 48. Promotion and Rollback

Agent changes move through:

```text
draft
→ offline evaluation
→ replay comparison
→ shadow mode
→ accepted read-only
→ paper action eligibility
→ bounded action eligibility
```

Rollback triggers include:

- Schema failures.
- Temporal leakage.
- Safety violation.
- Material calibration degradation.
- Tool misuse.
- Cost/latency regression.
- Unexplained behavior drift.

# Part XII — Context Compiler Specification

## 49. Inputs to the Compiler

- Agent definition.
- Workspace activation.
- Task envelope.
- Caller and parent policy.
- Routed context documents.
- User and agent memory search.
- Upstream artifacts.
- Source readiness.
- Skill availability.
- Model context budget.
- Replay/live clock.

## 50. Compiler Output

```json
{
  "agent": {
    "slug": "agent-slug",
    "version": "1.0.0"
  },
  "policy": {
    "permissionMode": "safe",
    "asOf": "ISO-8601",
    "timeoutSeconds": 180,
    "maxTurns": 8,
    "maxDepth": 2
  },
  "skills": [],
  "sources": [],
  "contextDocs": [],
  "memory": [],
  "artifactRefs": [],
  "task": {},
  "outputSchema": {},
  "launchReceiptId": "receipt-id"
}
```

## 51. Compiler Validation

Before launch:

- Agent exists and is active.
- Required skills exist.
- Required sources are available and authenticated.
- Caller may invoke target.
- Requested permission does not exceed caller or workspace policy.
- Task and output schemas validate.
- Artifact references exist and satisfy as-of time.
- Context is within budget.
- No secret is inserted into model context.
- Replay/live environment is explicit.

# Part XIII — Universal Contracts

## 52. Analysis Artifact Skeleton

```json
{
  "schemaVersion": 1,
  "type": "analysis.domain.v1",
  "id": "artifact-id",
  "causedBy": "task-or-artifact-id",
  "scope": {},
  "asOf": "ISO-8601",
  "expiresAt": "ISO-8601",
  "dataQuality": {},
  "measurements": {},
  "observations": [],
  "interpretation": {},
  "alternativeHypotheses": [],
  "scenarios": [],
  "invalidation": [],
  "noActionReasons": [],
  "evidenceIds": [],
  "annotationArtifactIds": [],
  "agent": {},
  "engineVersions": {},
  "createdAt": "ISO-8601"
}
```

## 53. Message Skeleton

```json
{
  "schemaVersion": 1,
  "messageId": "uuid",
  "caller": "agent-a",
  "target": "agent-b",
  "task": "bounded task",
  "decisionQuestion": "specific question",
  "contextArtifactIds": [],
  "expectedOutput": "what is needed",
  "outputSchema": {},
  "allowedSources": [],
  "allowedSkills": [],
  "permissionMode": "safe",
  "priority": "normal",
  "timeoutSeconds": 120,
  "maxTurns": 6,
  "maxDepth": 2,
  "expiresAt": "ISO-8601"
}
```

## 54. Action Proposal Skeleton

```json
{
  "schemaVersion": 1,
  "type": "action.proposal.v1",
  "actionId": "uuid",
  "proposedBy": "agent-slug",
  "action": "bounded-action-name",
  "target": {},
  "payload": {},
  "supportingArtifactIds": [],
  "estimatedImpact": {},
  "idempotencyKey": "stable-key",
  "requiredPolicy": "policy-id",
  "requiresApproval": true,
  "expiresAt": "ISO-8601"
}
```

## 55. Action Receipt Skeleton

```json
{
  "schemaVersion": 1,
  "type": "action.receipt.v1",
  "receiptId": "uuid",
  "actionId": "uuid",
  "policyDecisionId": "uuid",
  "approvalId": "optional-uuid",
  "intendedAction": {},
  "observedResult": {},
  "status": "succeeded",
  "tool": {},
  "startedAt": "ISO-8601",
  "completedAt": "ISO-8601",
  "error": null
}
```

# Part XIV — Anti-Patterns

Reject an agent design when it exhibits these patterns.

## Prompt-Only Expert

The agent has doctrine in a huge prompt but no authoritative data tools, deterministic calculations, schema, or evaluation.

## Tool Grab Bag

The agent receives every available source and tool “just in case,” making behavior hard to understand and permissions impossible to reason about.

## Mega-Orchestrator

One agent analyzes every domain, calls every tool, synthesizes itself, approves itself, and acts itself.

## Chat-State System

Critical state lives inside conversation text instead of typed artifacts and authoritative stores.

## Memory as Market Truth

The agent relies on remembered prices, positions, levels, or current events.

## Screenshot Numerology

The agent guesses exact values from chart pixels even though structured data should be available.

## Agent Polling

An expensive language model loops continuously over ticks instead of deterministic monitors emitting meaningful triggers.

## Unbounded Agent Chatter

Agents recursively ask one another broad questions, creating cost, latency, and false consensus.

## Self-Approval

The producing agent validates its own evidence, risk, and action authority with no independent boundary.

## P&L-Only Evaluation

A lucky outcome is treated as proof that the reasoning or implementation was correct.

## Invisible Fallback

When a source or model fails, the agent silently substitutes lower-quality data or behavior without recording the change.

## Unversioned Intelligence

Prompt, model, skill, script, or schema changes ship without a version, replay comparison, or rollback path.

# Part XV — Maturity Model

## Level 0 — Persona

- Name and prompt.
- No dependable tools or schema.
- Not accepted for Trade God decisions.

## Level 1 — Grounded Assistant

- Bounded mandate.
- Read-only sources.
- Primary skill.
- Basic structured output.

## Level 2 — Operational Specialist

- Deterministic tools.
- Compiled context.
- Durable artifacts.
- Data quality and provenance.
- Manual invocation.

## Level 3 — Coordinated Specialist

- Typed messaging.
- Workflow participation.
- Chart/artifact integration.
- Receipts.
- Timeouts and failure policies.

## Level 4 — Evaluated Specialist

- Replay suite.
- Golden and adversarial cases.
- Confidence calibration.
- Version regression gates.
- Reviewed memory loop.

## Level 5 — Bounded Autonomous Specialist

- Deterministic monitor triggers.
- Explicit policy envelope.
- Safe writes or narrowly approved actions.
- Full observability.
- Incident and rollback procedures.

No agent should receive consequential live authority before Level 4.

# Part XVI — Universal Build Checklist

## A. Identity and Ownership

- [ ] Unique lowercase slug.
- [ ] Clear human-readable name.
- [ ] One-sentence bounded description.
- [ ] Agent class identified.
- [ ] Mission is testable.
- [ ] Primary questions are listed.
- [ ] Out-of-scope questions are listed.
- [ ] Final decision owner is named.
- [ ] Escalation owner is named.
- [ ] Forbidden authority is explicit.

## B. Inputs and Outputs

- [ ] Typed task envelope exists.
- [ ] Required scope and as-of time are defined.
- [ ] Required upstream artifacts are defined.
- [ ] Primary output schema exists.
- [ ] Error/unavailable output exists.
- [ ] Expiry policy exists.
- [ ] Measurements and interpretations are separated.
- [ ] Alternatives and invalidations are required where relevant.
- [ ] Downstream consumers are identified.

## C. Doctrine and Skills

- [ ] One primary domain skill exists.
- [ ] Skill trigger conditions are clear.
- [ ] Doctrine is separated from system prompt.
- [ ] Terminology is defined.
- [ ] Analytical sequence is defined.
- [ ] Required evidence is defined.
- [ ] Failure modes are documented.
- [ ] Refusal conditions are documented.
- [ ] Representative examples exist.
- [ ] Skill version is recorded.

## D. Context

- [ ] Workspace context requirements are listed.
- [ ] Context routing targets the correct agent.
- [ ] User preferences are scoped.
- [ ] Agent memory scope is defined.
- [ ] Upstream artifact selection is defined.
- [ ] Context budget and priority are defined.
- [ ] Current authoritative state is not stored as memory.
- [ ] Launch receipt lists injected context.
- [ ] Replay context respects as-of time.

## E. Sources and Tools

- [ ] Every source has an owner and health check.
- [ ] Authentication and entitlements are documented.
- [ ] Every tool has typed input/output.
- [ ] Tool side effects are classified.
- [ ] Read and write tools are separated.
- [ ] Dry-run exists where meaningful.
- [ ] Idempotency exists for consequential writes.
- [ ] Errors are stable and explicit.
- [ ] Tool versions are recorded.
- [ ] Agent has no unnecessary tools.

## F. Deterministic Services

- [ ] Numerical calculations are outside the model.
- [ ] Sequence-sensitive logic is deterministic.
- [ ] Tests reconcile outputs against source data.
- [ ] Provider-specific logic is behind adapters.
- [ ] Internal contracts are versioned.
- [ ] Service can be replayed.
- [ ] Service failure blocks unsupported interpretation.
- [ ] Performance and latency targets are defined.

## G. Visual Intelligence

- [ ] Structured scene contract exists.
- [ ] Rendered image metadata exists.
- [ ] Exact values come from structured data.
- [ ] Image/data mismatch is detected.
- [ ] Annotation schema exists.
- [ ] Drawings link to agent and thesis.
- [ ] Drawings can expire or invalidate.
- [ ] Replay reproduces visible state.

## H. Reasoning

- [ ] Cognition loop is explicit.
- [ ] Data capability is checked first.
- [ ] Multiple hypotheses are considered.
- [ ] Disconfirming evidence is sought.
- [ ] Confidence basis is stated.
- [ ] No-action is permitted.
- [ ] Completion contract is testable.
- [ ] Prompt cannot override authoritative policy.

## I. Communication

- [ ] Allowed callers are defined.
- [ ] Allowed recipients are defined.
- [ ] Message schemas exist.
- [ ] Expected outputs are explicit.
- [ ] Timeout, turns, and depth are bounded.
- [ ] Causal IDs and receipts persist.
- [ ] Expired messages are rejected.
- [ ] Caller owns synthesis.
- [ ] Cycles/broadcast noise are prevented.

## J. Workflows and Triggers

- [ ] Manual invocation exists.
- [ ] Scheduled triggers are documented if used.
- [ ] Event triggers are deterministic.
- [ ] Deduplication and cooldown exist.
- [ ] Trigger expiry exists.
- [ ] Data-health state gates triggers.
- [ ] Workflow step schemas exist.
- [ ] Retry and failure policy exist.
- [ ] Workflow definition is snapshotted per run.

## K. Permissions and Actions

- [ ] Permission mode is explicit.
- [ ] Child permission cannot exceed parent.
- [ ] Safe internal writes are listed.
- [ ] Approval-required actions are listed.
- [ ] Forbidden actions are technically unavailable.
- [ ] Secrets never enter model context.
- [ ] External network paths are bounded.
- [ ] Mutations generate receipts.
- [ ] Kill/pause behavior exists.

## L. Memory and Learning

- [ ] Appropriate memory examples are documented.
- [ ] Prohibited memory classes are documented.
- [ ] Memory writes are proposals.
- [ ] Outcome evidence links to proposals.
- [ ] Review/approval policy exists.
- [ ] Conflicts and expiry are supported.
- [ ] One result cannot rewrite doctrine automatically.
- [ ] Skill/service changes require regression evaluation.

## M. Evaluation

- [ ] Domain rubric exists.
- [ ] Golden cases exist.
- [ ] Boundary cases exist.
- [ ] Missing/stale-data cases exist.
- [ ] Conflicting-evidence cases exist.
- [ ] Tool-failure cases exist.
- [ ] Temporal leakage tests exist.
- [ ] Confidence calibration is measured.
- [ ] No-action quality is measured.
- [ ] Accepted baseline exists.
- [ ] Promotion and rollback gates exist.

## N. Observability

- [ ] Run origin is visible.
- [ ] Context receipt is visible.
- [ ] Tools and durations are visible.
- [ ] Artifacts and causal links are visible.
- [ ] Errors and retries are visible.
- [ ] Cost and token usage are visible.
- [ ] Queue and stuck-run health are visible.
- [ ] Agent version and status are visible.
- [ ] User can pause or disable the agent.

## O. Documentation and Maintenance

- [ ] Agent owner is named.
- [ ] Definition, skill, tools, and schemas are linked.
- [ ] Data/provider assumptions are documented.
- [ ] Known limitations are documented.
- [ ] Changelog begins when behavior changes.
- [ ] Deprecation and migration plan exist.
- [ ] Third-party licenses were checked.
- [ ] Documentation distinguishes design from implemented truth.

# Part XVII — One-Page Agent Core Card

Every agent should be summarizable in this form:

```text
AGENT
Name:
Slug:
Class:
Version:
Status:

HEART
Mission:
Primary questions:
Decision owner:
Forbidden authority:

BRAIN
Model:
Primary skill:
Cognition loop:
Uncertainty policy:

SENSES
Sources:
Tools:
Visual inputs:
Data-quality requirements:

MEMORY
Workspace context:
Agent memory:
Prohibited memory:

NERVOUS SYSTEM
Triggers:
Allowed callers:
Allowed recipients:
Timeout/turn/depth limits:

HANDS
Safe writes:
Approval-required actions:
Forbidden actions:

OUTPUT
Primary artifact:
Output schema:
Expiry:
Downstream consumers:

IMMUNE SYSTEM
Validators:
Independent reviewer:
Failure behavior:
Kill/pause behavior:

PROFESSIONAL RECORD
Golden cases:
Accepted baseline:
Calibration:
Last evaluation:
Rollback version:
```

## Final Standard

A great Trade God agent is not defined by how convincingly it speaks.

It is defined by whether:

- Its mission is bounded.
- Its evidence is authoritative and fresh.
- Its calculations are deterministic.
- Its context is relevant and temporally valid.
- Its reasoning considers alternatives.
- Its outputs are typed and durable.
- Its communications are bounded and receipted.
- Its authority is technically constrained.
- Its failures are visible and safe.
- Its confidence is calibrated.
- Its changes are evaluated and reversible.
- A human can reconstruct why it believed and did what it did.

That is the heart, blood, bones, nervous system, and professional discipline every Trade God agent must possess.

