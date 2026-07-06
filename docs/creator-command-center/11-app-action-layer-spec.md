# App Action Layer Spec

Status: initial implementation landed
Last verified: 2026-07-06
Branch: codex/app-action-layer
Owner: RunnerOS system layer

Implementation map: [12-app-action-layer-build.md](./12-app-action-layer-build.md)

## Purpose

RunnerOS needs one reliable way for agents, HNIC, workflows, and future automations to operate the app:

- add an event to Calendar
- add or move a Kanban card
- add a person to Network
- add a fan or segment
- save a file to Vault
- create or update a Work Product
- request approval
- draft or send a message
- start a workflow

The right architecture is not "give every agent a giant pile of custom tools." The right architecture is a central App Action Layer: a small, stable tool surface backed by a typed action registry, policy checks, approvals, idempotency, receipts, and UI events.

In plain terms: agents ask the app to do a named action. The app decides whether the agent is allowed, whether the user must approve it, how to validate it, how to avoid duplicates, how to run it, and how to leave proof.

## Core Decision

Build a registry-driven App Action Layer.

Do not build one-off direct agent tools for every UI surface in V1.

V1 model-facing tools:

- `list_app_actions`
- `preview_app_action`
- `execute_app_action`
- `get_app_action_receipt`

V1 app-facing registry entries:

- `calendar.create_event`
- `kanban.create_card`
- `network.upsert_person`
- `fans.upsert_fan`
- `vault.add_file`
- `vault.add_from_output`
- `outputs.create`
- `outputs.update_approval`
- `campaigns.create`
- `campaigns.add_milestone`
- `approvals.request`
- `workflows.start`

Later, if model selection needs help, high-volume actions can get generated thin aliases. The registry still remains the source of truth.

## Why This Is Worth It

This is not fluff. It strengthens the release path because it gives RunnerOS:

- one permission model instead of scattered tool logic
- one approval gate for risky mutations
- one receipt trail for "what happened and why"
- one schema system for validation
- one idempotency system for retries and duplicate prevention
- one UI event path after mutations
- one way to add future surfaces without retraining every agent
- one way for HNIC to operate broadly while specialists stay narrow

Without this layer, agent-powered UI mutation will become brittle fast.

## Non Goals

- Do not let LLMs write directly to renderer state.
- Do not let agents bypass existing backend/storage validation.
- Do not duplicate Vault, Outputs, Work Products, Kanban, or Calendar stores.
- Do not save every chat artifact into Vault automatically.
- Do not default agents into external send, publish, spend, delete, refund, or credential actions.
- Do not overload `tags` as a permission system.
- Do not create a massive prompt/tool list for every agent.
- Do not make background agents more privileged than the parent session that launched them.

## Research Anchors

This design follows current official platform guidance:

- MCP tools are model-controlled and should expose clear metadata, input schemas, output schemas, and tool annotations. Tool names must be stable and disambiguated. Tool annotations are hints, not trusted authorization.
- MCP tool errors that the model can act on should return structured tool results with `isError`, not protocol-level failures.
- JSON Schema object validation should reject unknown fields where appropriate. `unevaluatedProperties` is the right pattern when schemas are composed.
- Idempotent request IDs are the standard way to dedupe retries and safely return prior results.
- Electron IPC must validate the sender for every privileged message.
- Calendar integrations must handle OAuth scopes, write access, event IDs, timed versus all-day events, recurrence, time zones, attendees, notifications, and Drive attachments.
- Messaging integrations need backoff and per-channel throttling. Slack's public guidance is to design around roughly one write per second per API/channel and to honor `Retry-After`.

Source links are listed at the end of this spec.

## Current RunnerOS Fit

RunnerOS already has the right foundation:

- standalone and skill-backed agents
- `message_agent`
- `create_agent`
- `create_output`
- source/tool registration
- permission modes
- approvals
- receipts
- Work Products
- Vault architecture
- workflows and automations
- Electron + server-core + session-tools split

The App Action Layer should reuse these instead of becoming a parallel system.

Important existing contracts:

- `AgentMetadata.permissionMode`
- `AgentMetadata.skills`
- `AgentMetadata.sources`
- `AgentMetadata.optionalSources`
- `AgentMetadata.trustedWorkerTools`
- `AgentCapabilityProfile.inputs`
- `AgentCapabilityProfile.outputs`
- `AgentCapabilityProfile.tags`
- `message_agent` permission and background execution model
- `create_output` manifest/context/approval behavior
- Work Products built on Outputs
- Vault as curated source of truth, not automatic dump storage

## Architecture

```text
Agent / HNIC / Workflow / Automation
  -> session tool: list_app_actions / preview_app_action / execute_app_action
  -> AppActionService
  -> ActionRegistry
  -> CapabilityResolver
  -> PolicyEngine
  -> SchemaValidator
  -> IdempotencyStore
  -> ApprovalService
  -> SurfaceAdapter
  -> App storage or external API
  -> ReceiptStore
  -> UI event bus
  -> Work Product / Output receipt where relevant
```

The App Action Layer owns:

- discovery
- validation
- authorization
- approval routing
- dry-run previews
- idempotency
- execution
- receipts
- audit redaction
- UI invalidation events
- safe error shape

Individual surfaces own:

- business rules
- persistence
- domain-specific validation
- UI rendering
- adapter execution

## Model-Facing Tool Contract

### `list_app_actions`

Read-only. Returns actions available in the current workspace/session for the current agent.

Input:

```ts
type ListAppActionsInput = {
  surface?: AppActionSurface;
  includeUnavailable?: boolean;
};
```

Output:

```ts
type ListAppActionsOutput = {
  actions: Array<{
    id: AppActionId;
    title: string;
    description: string;
    surface: AppActionSurface;
    kind: AppActionKind;
    risk: AppActionRisk;
    inputSchema: JsonSchema;
    outputSchema?: JsonSchema;
    approval: ApprovalRequirementSummary;
    availability: {
      available: boolean;
      reason?: string;
      repairHint?: string;
    };
  }>;
};
```

Rules:

- Must filter by workspace, agent grants, permission mode, and source auth status.
- Must explain unavailable actions when requested.
- Must not reveal secrets.
- Must not mutate state.

### `preview_app_action`

Validates input, resolves policy, predicts what will change, and returns whether approval is needed.

Input:

```ts
type PreviewAppActionInput = {
  actionId: AppActionId;
  input: unknown;
  requestId?: string;
  intendedSurface?: string;
};
```

Output:

```ts
type PreviewAppActionOutput = {
  ok: boolean;
  actionId: AppActionId;
  normalizedInput?: unknown;
  risk?: AppActionRisk;
  approvalRequired?: boolean;
  approvalReason?: string;
  idempotencyKey?: string;
  duplicateOfReceiptId?: string;
  expectedChange?: AppActionExpectedChange;
  warnings?: string[];
  errors?: AppActionError[];
};
```

Rules:

- Must not execute external side effects.
- May check duplicates.
- May check source availability.
- Must return structured validation errors.
- Must produce the same approval summary that the user will see.

### `execute_app_action`

Runs one action or returns `approval_required`.

Input:

```ts
type ExecuteAppActionInput = {
  actionId: AppActionId;
  input: unknown;
  requestId: string;
  intendedSurface?: string;
  approvalToken?: string;
  dryRun?: boolean;
};
```

Output:

```ts
type ExecuteAppActionOutput = {
  status:
    | "succeeded"
    | "approval_required"
    | "queued"
    | "duplicate"
    | "failed";
  receipt?: AppActionReceipt;
  approval?: {
    approvalId: string;
    summary: ApprovalSummary;
    requiredBy: string;
  };
  duplicateOfReceiptId?: string;
  errors?: AppActionError[];
};
```

Rules:

- `requestId` is required.
- Duplicate request IDs return the prior result.
- Approval-required actions must not execute before approval.
- All successful, queued, failed, and duplicate outcomes write or reference a receipt.
- Model-correctable failures return structured tool results, not protocol crashes.

### `get_app_action_receipt`

Fetches one receipt by ID.

Input:

```ts
type GetAppActionReceiptInput = {
  receiptId: string;
};
```

Output:

```ts
type GetAppActionReceiptOutput = {
  receipt?: AppActionReceipt;
};
```

Rules:

- Must enforce workspace/session visibility.
- Must return redacted data only.

## Core Types

```ts
type AppActionId = `${AppActionSurface}.${string}`;

type AppActionSurface =
  | "calendar"
  | "kanban"
  | "network"
  | "fans"
  | "vault"
  | "outputs"
  | "work_products"
  | "campaigns"
  | "approvals"
  | "workflows"
  | "messages"
  | "publishing"
  | "settings";

type AppActionKind =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "external_send"
  | "publish"
  | "purchase"
  | "credential";

type AppActionRisk =
  | "read"
  | "internal_safe"
  | "internal_write"
  | "external_write"
  | "destructive"
  | "credential";
```

```ts
type AppActionDefinition<TInput, TOutput> = {
  id: AppActionId;
  version: number;
  title: string;
  description: string;
  surface: AppActionSurface;
  kind: AppActionKind;
  risk: AppActionRisk;

  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;

  idempotency: {
    required: boolean;
    keyFields: string[];
    duplicateWindowSeconds: number;
    duplicateBehavior: "return_prior" | "merge" | "reject";
  };

  approvalPolicy: {
    mode: "never" | "risk_based" | "always";
    reason?: string;
    summaryFields: string[];
    snapshotFields: string[];
  };

  capability: {
    defaultGrant: "none" | "hnic" | "specialist" | "all";
    minPermissionMode?: string;
    requiredActionGrants?: string[];
    requiredSourceSlugs?: string[];
    requiredOAuthScopes?: string[];
    allowedBackground?: boolean;
    requiresExplicitUserIntent?: boolean;
  };

  audit: {
    redactInputFields: string[];
    redactOutputFields: string[];
    piiFields: string[];
  };

  uiEvents: Array<{
    type: string;
    target?: string;
  }>;

  preview: (ctx: AppActionContext, input: TInput) => Promise<AppActionPreview>;
  execute: (ctx: AppActionContext, input: TInput) => Promise<TOutput>;
};
```

```ts
type AppActionContext = {
  workspaceId: string;
  sessionId: string;
  actor: {
    type: "user" | "agent" | "workflow" | "automation";
    userId?: string;
    agentSlug?: string;
    parentAgentSlug?: string;
    permissionMode?: string;
  };
  requestId: string;
  approvalToken?: string;
  source: {
    toolCallId?: string;
    threadId?: string;
    messageId?: string;
    workflowRunId?: string;
    automationRunId?: string;
  };
};
```

## Receipt Contract

Every attempted action that reaches policy evaluation gets a receipt or links to a prior receipt.

```ts
type AppActionReceipt = {
  schemaVersion: 1;
  id: string;
  actionId: AppActionId;
  actionVersion: number;
  requestId: string;
  idempotencyKey: string;

  workspaceId: string;
  sessionId: string;

  actor: {
    type: "user" | "agent" | "workflow" | "automation";
    userId?: string;
    agentSlug?: string;
    parentAgentSlug?: string;
    permissionMode?: string;
  };

  status:
    | "succeeded"
    | "approval_required"
    | "queued"
    | "duplicate"
    | "failed";

  risk: AppActionRisk;
  approvalId?: string;
  approvalSnapshotHash?: string;

  target?: {
    surface: AppActionSurface;
    entityType?: string;
    entityId?: string;
    externalProvider?: string;
    externalId?: string;
    url?: string;
  };

  redactedInput: unknown;
  redactedOutput?: unknown;
  error?: AppActionError;

  outputId?: string;
  workProductId?: string;

  uiEvents: Array<{
    type: string;
    payload: unknown;
  }>;

  createdAt: string;
  completedAt?: string;
};
```

Storage V1:

```text
<workspace>/.runneros/app-actions/receipts/<yyyy>/<mm>/<receipt-id>.json
<workspace>/.runneros/app-actions/idempotency/<hash>.json
```

If there is already a durable receipt/event store in the target branch at implementation time, use it instead of creating a second store.

## Permission Model

Add structured action grants to agent metadata. Do not use free-form `tags` as permissions.

```ts
type AgentMetadata = {
  // existing fields
  actionGrants?: string[];
};
```

Grant patterns:

```text
calendar.read
calendar.create_event
kanban.*
vault.add_from_output
outputs.*
approvals.request
workflows.start
*:read
```

Rules:

- HNIC can see broad app actions but still must pass risk policy.
- Specialist agents get narrow grants tied to their job.
- Background agents inherit the stricter of their own grants and parent-session grants.
- Newly created agents may request action grants, but the creator tool must validate them against known actions.
- External write, publish, purchase, destructive, delete, credential, and customer-facing message actions are never default-granted.
- User can grant or revoke actions from an agent settings surface later.

## Action Availability Resolution

An action is available only if all checks pass:

1. Action exists in registry.
2. Workspace has the surface enabled.
3. Agent/user has the action grant.
4. Permission mode allows the risk.
5. Required source/tool is configured.
6. Required OAuth scope or API token is present.
7. Action does not require foreground/user intent when running in background.
8. Policy engine does not deny it.

Unavailable actions should include one repair hint, for example:

```text
Connect Google Calendar to create events.
Agent needs action grant calendar.create_event.
This action requires user approval because it invites attendees.
```

## Risk And Approval Policy

| Risk | Examples | Default |
|---|---|---|
| `read` | list actions, inspect receipt | allow if granted |
| `internal_safe` | create draft, add internal note | allow if granted |
| `internal_write` | add Kanban card, save Vault file, update campaign | allow HNIC, specialist if granted |
| `external_write` | invite attendee, send Slack/email, post to social | approval required |
| `destructive` | delete, archive, irreversible merge | approval required |
| `credential` | connect account, change token, read secret | user-driven only |

Approval snapshot must include:

- action ID and version
- normalized input hash
- target entity ID/version if updating
- human-readable summary
- risk reason
- actor
- created timestamp
- expiration timestamp

If the target entity changes before approval, require a fresh preview.

## Idempotency

Every execute call requires `requestId`.

Idempotency key should include:

```text
workspaceId + actionId + normalizedInputHash + actorStableId + requestId
```

For user-intent duplicates, action definitions can add natural keys:

- calendar: event ID or title + start + end + calendar ID
- kanban: board ID + title + source output/session
- network: email/social handle + workspace
- vault: file digest + target folder
- outputs: source session + title + artifact type

Duplicate behavior:

- exact same request ID: return prior receipt
- same natural key inside window: return duplicate with prior receipt if safe
- conflicting natural key: ask for explicit update/merge action

## Error Shape

Errors must be structured and useful to the model:

```ts
type AppActionError = {
  code:
    | "ACTION_NOT_FOUND"
    | "ACTION_UNAVAILABLE"
    | "VALIDATION_FAILED"
    | "PERMISSION_DENIED"
    | "APPROVAL_REQUIRED"
    | "APPROVAL_STALE"
    | "DUPLICATE"
    | "CONFLICT"
    | "SOURCE_AUTH_REQUIRED"
    | "RATE_LIMITED"
    | "EXTERNAL_API_FAILED"
    | "INTERNAL_ERROR";
  message: string;
  fieldPath?: string;
  repairHint?: string;
  retryAfterSeconds?: number;
};
```

Do not throw raw provider errors into the model or audit log.

## UI Requirements

Add an Action Inspector surface before or during first broad integration.

Minimum UI:

- action receipt drawer
- pending approvals list
- "why this happened" explanation
- actor, action, target, status, time
- source session/message/workflow link
- retry from failed receipt where safe
- undo/compensating action only when explicitly supported

UI events:

- `app-actions:receipt-created`
- `app-actions:receipt-updated`
- `<surface>:updated`
- `approvals:updated`
- `outputs:updated`
- `vault:updated`
- `kanban:updated`
- `calendar:updated`

The UI must not optimistically show external-send success until provider confirmation.

## Surface Action Specs

### Calendar

V1 actions:

- `calendar.create_event`
- `calendar.update_event`
- `calendar.attach_file`

Inputs for create:

```ts
type CalendarCreateEventInput = {
  calendarId: string;
  title: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{ email: string; displayName?: string }>;
  recurrence?: string[];
  location?: string;
  attachments?: Array<{ fileId: string; provider: "drive" | "vault" }>;
  sendUpdates?: "all" | "externalOnly" | "none";
};
```

Rules:

- Timed events must use `dateTime`; all-day events must use `date`.
- Start and end must both be timed or both all-day.
- Recurring events require a single IANA time zone.
- Invite notifications count as external write.
- Drive attachments require the right provider support and scopes.
- Use explicit event IDs or request IDs to prevent duplicate creates.
- Missing OAuth/write access makes the action unavailable.

Approval:

- Internal calendar event with no attendees: usually no approval for HNIC if granted.
- Any attendee notification: approval required.
- Any external guest: approval required.

### Kanban

V1 actions:

- `kanban.create_card`
- `kanban.move_card`
- `kanban.update_card`

Inputs:

```ts
type KanbanCreateCardInput = {
  boardId: string;
  columnId: string;
  title: string;
  description?: string;
  dueAt?: string;
  assigneeAgentSlug?: string;
  assigneeUserId?: string;
  links?: Array<{
    type: "session" | "output" | "work_product" | "campaign" | "vault_file";
    id: string;
  }>;
  labels?: string[];
};
```

Rules:

- Internal write.
- Dedupe by board + title + source link inside a configurable window.
- If card links to output/work product, receipt should include the linked ID.
- Moving across done/approved/released columns may require approval if the board policy says so.

### Network

V1 actions:

- `network.upsert_person`
- `network.add_note`
- `network.link_artifact`
- `network.merge_people`

Rules:

- Treat email, phone, social handles, and addresses as PII.
- Dedupe by email first, then normalized social handle, then name + org with low confidence.
- Low-confidence duplicate should create a merge suggestion, not auto-merge.
- External enrichment requires source policy and should record provider.
- Adding a person is internal write.
- Contacting a person is external write and must go through messages/approval.

### Fans

V1 actions:

- `fans.upsert_fan`
- `fans.add_tag`
- `fans.record_interaction`
- `fans.enqueue_message_draft`

Rules:

- Fan identity is PII.
- Segment/tag writes are internal write.
- Actual outbound fan message is external write and approval required.
- Do not let agents infer sensitive categories without an explicit source and policy.

### Vault

V1 actions:

- `vault.add_file`
- `vault.add_from_output`
- `vault.tag_file`
- `vault.link_to_campaign`

Rules:

- Vault remains curated source of truth.
- Do not automatically save all outputs.
- File paths must be normalized and blocked from traversal.
- Prefer content digest for duplicate detection.
- Store whether file is copied, linked, imported from provider, or generated.
- Rights/licensing fields should be present for media assets.
- Secrets and credentials should never be saved as normal Vault files.

### Outputs And Work Products

V1 actions:

- `outputs.create`
- `outputs.update_approval`
- `work_products.pin`
- `work_products.link_source`

Rules:

- Existing `create_output` remains a specialized tool while V1 app actions come online.
- Implement `outputs.create` by routing through the same OutputService path as `create_output`.
- Work Products continue to build on Outputs, not a parallel store.
- Approval status changes should write receipts and emit `outputs:updated`.

### Campaigns

V1 actions:

- `campaigns.create`
- `campaigns.add_milestone`
- `campaigns.link_work_product`
- `campaigns.update_state`

Rules:

- Internal write.
- HNIC gets broad campaign write if granted.
- Specialist agents get campaign write only when tied to assigned campaign context.
- Release-state transitions can require approval by campaign policy.

### Approvals

V1 actions:

- `approvals.request`
- `approvals.resolve`

Rules:

- Agents may request approval.
- Agents should not approve their own external-write/destructive/credential actions.
- Approval must snapshot action/input/resource version.
- Stale approval must fail closed.

### Workflows And Automations

V1 actions:

- `workflows.start`
- `workflows.cancel`
- `automations.create_draft`
- `automations.enable`
- `automations.disable`

Rules:

- Starting a workflow is internal write unless it includes external side effects.
- Enabling an automation that can externally send/publish/spend/delete requires approval.
- Workflow child agents inherit stricter action grants.
- Each step writes its own receipt or links to a parent workflow receipt.

### Messages And Publishing

V1 actions:

- `messages.create_draft`
- `messages.request_send`
- `publishing.create_draft`
- `publishing.request_publish`

Rules:

- Drafting is internal write.
- Sending/publishing is external write.
- Default path is draft -> approval -> execute.
- Provider rate limits must be respected.
- Do not send if approval snapshot is stale.
- Store provider message IDs and URLs in receipts.

### Settings And Credentials

V1 actions:

- `settings.read_status`
- `settings.request_connection`

Rules:

- Agents can read connection status if granted.
- Agents cannot read raw secrets.
- Credential connection is user-driven.
- Credential changes must happen in trusted UI, not an agent tool call.

## Agent Creation Integration

Update `create_agent` to understand action grants.

Input addition:

```ts
type CreateAgentInput = {
  // existing fields
  metadata?: {
    // existing fields
    actionGrants?: string[];
  };
};
```

Validation:

- Grant must match a known action ID or supported wildcard.
- Grant must be compatible with permission mode.
- External-write/destructive/credential grants require explicit user confirmation or settings approval.
- Unknown grants fail validation.

Agent templates:

```text
HNIC
  calendar.*
  kanban.*
  network.*
  fans.*
  vault.*
  outputs.*
  work_products.*
  campaigns.*
  approvals.request
  workflows.start
  messages.create_draft
  publishing.create_draft

Branding Agent
  outputs.create
  outputs.update_approval
  vault.add_from_output
  campaigns.link_work_product
  kanban.create_card

Research Agent
  outputs.create
  vault.add_from_output
  kanban.create_card

Ops Agent
  calendar.create_event
  kanban.*
  workflows.start
  approvals.request

Community Agent
  fans.upsert_fan
  fans.add_tag
  fans.record_interaction
  messages.create_draft
```

HNIC should be broadly capable but not free to bypass approvals.

## Prompt And Context Economy

Do not dump every action schema into every prompt.

Rules:

- Agents call `list_app_actions` only when they need to operate the app.
- Return filtered, relevant actions only.
- For broad HNIC sessions, group actions by surface and include short descriptions.
- For specialist agents, return narrow grants.
- Tool descriptions must be short.
- Action descriptions must be operational, not marketing copy.
- Full JSON schemas should be fetched only when action details are needed.

This keeps context cost controlled while preserving capability.

## Security Requirements

### Electron And IPC

- Renderer must never directly execute privileged mutations.
- Main/server handlers must validate IPC sender origin.
- Use allowlisted app origins.
- Reject unexpected frames.
- Do not trust renderer-provided actor identity.
- Prefer backend/session context as actor source of truth.

### Prompt Injection

- Action registry metadata is trusted code, but user/source content is not.
- Tool/action descriptions must not include source-provided text.
- External content can suggest actions but cannot grant permissions.
- Agent-provided input is always schema-validated and policy-checked.

### Data Protection

- Redact secrets and PII in receipts.
- Store raw provider errors only in developer logs if needed, not model-visible receipts.
- Do not send Vault files to external providers unless the action definition requires it and policy allows it.
- Require explicit file attachment lists. No broad folder attachment by model inference.

### Background Agents

- Background agents cannot perform foreground-required actions.
- Background agents cannot external-send/publish/spend/delete without approval.
- Background agents inherit stricter permissions from parent session.
- Background action receipts must identify parent session and parent agent.

## Concurrency And Consistency

Use optimistic concurrency for updates when surfaces support versions.

Patterns:

- Include `entityVersion` or `updatedAt` in update inputs.
- If stale, return `CONFLICT` with repair hint.
- Approval snapshots include resource version.
- Duplicate creates return prior receipt.
- Composite actions write child receipts.
- Partial failure must be visible and must not be reported as success.

## External Adapter Rules

Every external adapter must support:

- auth status check
- scope check
- dry-run preview where possible
- provider request ID or local idempotency fallback
- structured errors
- rate-limit handling
- retry policy
- receipt provider IDs
- safe redaction

External adapters should never be called directly from agent tool handlers. They run through AppActionService.

## Implementation Plan

### Phase 1: Core Internal Layer

Files to add:

```text
packages/shared/src/app-actions/types.ts
packages/shared/src/app-actions/registry.ts
packages/shared/src/app-actions/schemas.ts
packages/server-core/src/app-actions/AppActionService.ts
packages/server-core/src/app-actions/ActionPolicyEngine.ts
packages/server-core/src/app-actions/IdempotencyStore.ts
packages/server-core/src/app-actions/ReceiptStore.ts
packages/session-tools-core/src/handlers/app-actions.ts
```

Files to update:

```text
packages/session-tools-core/src/tool-defs.ts
packages/session-tools-core/src/context.ts
packages/shared/src/agent-definitions/types.ts
packages/shared/src/agent-definitions/storage.ts
packages/session-tools-core/src/handlers/create-agent.ts
apps/electron/src/shared/routes.ts
packages/server-core/src/handlers/rpc/*
```

Initial actions:

```text
outputs.create
outputs.update_approval
vault.add_from_output
kanban.create_card
campaigns.add_milestone
approvals.request
workflows.start
```

Use existing internal services wherever possible.

### Phase 2: UI Receipts And Approval Surface

Add:

- Action Inspector drawer/page
- pending approval cards
- receipt detail view
- action source links
- failed action retry where safe

### Phase 3: Agent Grants

Add:

- `actionGrants` to agent metadata
- validation in `create_agent`
- `list_agents` context output
- default grant templates
- settings UI control for grants

### Phase 4: Calendar Adapter

Add:

- Google Calendar auth availability check
- `calendar.create_event`
- attendee approval policy
- recurrence/timezone validation
- duplicate event prevention
- provider receipt IDs

Calendar is the first serious external adapter because it exercises OAuth, time zones, recurrence, notifications, attachments, and idempotency.

### Phase 5: Broader External Writes

Add:

- Slack/message draft and request-send
- publishing draft and request-publish
- fan/community outbound draft and request-send

Keep outbound execution approval-gated.

## Test Plan

Unit tests:

- registry duplicate action ID rejection
- action ID naming validation
- schema validation rejects unknown fields
- capability resolver allows/denies correctly
- permission mode risk matrix
- approval required behavior
- stale approval rejection
- duplicate request ID returns prior receipt
- natural-key duplicate detection
- receipt redaction
- unavailable action repair hints

Integration tests:

- `execute_app_action(outputs.create)` routes through OutputService
- `execute_app_action(vault.add_from_output)` links existing output to Vault
- `execute_app_action(kanban.create_card)` writes card and emits UI event
- `execute_app_action(approvals.request)` creates approval and receipt
- background agent denied foreground-required action
- child agent cannot exceed parent grants

External adapter tests:

- calendar timed event
- calendar all-day event
- calendar recurrence with time zone
- calendar attendee notification requires approval
- calendar duplicate event returns prior receipt
- calendar missing OAuth returns unavailable
- provider rate limit returns `RATE_LIMITED` with retry time

Security tests:

- invalid IPC sender rejected
- path traversal blocked in Vault add
- secrets redacted from receipt
- source-provided prompt text cannot alter action grants
- unknown action grant rejected during agent creation

Smoke tests:

1. HNIC asks to create a campaign task.
2. Agent lists actions, picks `kanban.create_card`.
3. Preview shows internal write and target board.
4. Execute creates card.
5. UI updates.
6. Receipt shows actor, action, target, source session, and status.

Second smoke:

1. HNIC asks to add a meeting with attendee.
2. Agent previews `calendar.create_event`.
3. App returns approval required.
4. User approves.
5. Adapter creates calendar event.
6. Receipt includes provider event ID and notification policy.

## Release Gates

Do not call this release-ready until:

- all V1 tools are registered and typed
- at least three internal actions work end to end
- receipts are visible in UI
- approval-required path works
- duplicate request ID path is tested
- child/background permission inheritance is tested
- action grants are present in agent metadata and context
- missing source/auth produces clear unavailable action output
- no raw secrets/PII in receipts
- Electron IPC sender validation is confirmed for the action route
- one external adapter smoke passes or is explicitly deferred from release scope

## Open Implementation Questions

These should be answered while implementing, not ignored:

1. Is there already a durable receipt/event store that should own app-action receipts?
2. Which Kanban data model is canonical in the current branch?
3. Which approval service is canonical for Work Products and external sends?
4. Should `create_output` stay model-visible after `outputs.create`, or become an alias?
5. Should HNIC action grants be configured by default or workspace policy?
6. Which external provider is first: Google Calendar or Slack/messages?
7. What is the canonical workspace ID in local-only mode?

## Hard Rules For Implementation

- One registry.
- One execution service.
- One policy path.
- One receipt shape.
- One idempotency path.
- Existing surface services do the actual domain mutation.
- Agents get grants, not direct storage access.
- External writes need approval by default.
- Credential work stays user-driven.
- Prompt context stays filtered and small.
- Every meaningful action leaves proof.

## Source Links

- MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools
- MCP schema reference: https://modelcontextprotocol.io/specification/2025-06-18/schema
- JSON Schema object validation: https://json-schema.org/understanding-json-schema/reference/object
- Google API request ID and idempotency: https://google.aip.dev/155
- Electron security and IPC sender validation: https://www.electronjs.org/docs/latest/tutorial/security
- Google Calendar create events: https://developers.google.com/workspace/calendar/api/guides/create-events
- Google Calendar events and calendars: https://developers.google.com/workspace/calendar/api/concepts/events-calendars
- Slack Web API rate limits: https://docs.slack.dev/apis/web-api/rate-limits/
