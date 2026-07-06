# App Action Layer Build

Status: initial implementation
Last verified: 2026-07-06
Branch: `codex/app-action-layer`

## What Landed

RunnerOS now has a registry-driven App Action Layer so agents can ask the app to mutate app surfaces through one controlled path instead of inventing files or one-off tools.

Model-facing tools:

- `list_app_actions`
- `preview_app_action`
- `execute_app_action`
- `get_app_action_receipt`

Implemented actions:

- `outputs.create`
- `approvals.request`
- `workflows.start`
- `vault.add_file`
- `vault.add_from_output`
- `kanban.create_card`
- `campaigns.create`
- `campaigns.add_milestone`
- `network.upsert_person`
- `fans.upsert_fan`

Known-but-unavailable registry entries:

- `calendar.create_event` - blocked until a calendar write adapter is wired.
- `outputs.update_approval` - blocked until Output approval update support is wired.

## Key Files

- `packages/session-tools-core/src/app-actions/types.ts` - shared action contracts, risks, receipts, runtime context, Vault input types.
- `packages/session-tools-core/src/app-actions/registry.ts` - action registry, validation, previews, grants, known unavailable actions.
- `packages/session-tools-core/src/app-actions/service.ts` - list/preview/execute/receipt logic, permission checks, approval state, idempotency.
- `packages/session-tools-core/src/app-actions/storage.ts` - receipt storage, idempotency pointers, internal durable surface records.
- `packages/session-tools-core/src/handlers/app-actions.ts` - session tool handlers.
- `packages/session-tools-core/src/tool-defs.ts` - tool schemas, tool descriptions, registry entries.
- `packages/session-tools-core/src/context.ts` - `workspaceId`, active agent, Vault callbacks, agent `actionGrants`.
- `packages/shared/src/agent/session-scoped-tool-callback-registry.ts` - lazy callback contract for active agent and Vault adapters.
- `packages/shared/src/agent/session-self-management-bindings.ts` - lazy bindings for active agent and Vault action adapters.
- `packages/server-core/src/sessions/SessionManager.ts` - real adapters for Outputs, Workflows, Vault imports, active-agent grant context.
- `packages/shared/src/agent-definitions/types.ts` - `AgentMetadata.actionGrants`.
- `packages/shared/src/agent-definitions/storage.ts` - parse/serialize/migrate action grants.
- `packages/shared/src/agent-definitions/starter-templates.ts` - HNIC, Orchestrator, and Art Director starter grants.
- `packages/server-core/src/sessions/agent-search.ts` - search includes action grants.

## Storage

Receipts live under:

```text
<workspace>/.runneros/app-actions/receipts/YYYY/MM/<receiptId>.json
<workspace>/.runneros/app-actions/receipt-index/<receiptId>.json
<workspace>/.runneros/app-actions/idempotency/<hash>.json
```

Internal V1 surface records live under:

```text
<workspace>/.runneros/app-actions/surfaces/<surface>/<recordType>.json
```

These internal records are a safe first surface adapter, not the final Kanban/Network/Fans UI store. When native stores land, keep the same action IDs and swap adapters.

## Grants

Agents can receive `actionGrants` in `AGENT.md` frontmatter.

Examples:

```yaml
actionGrants:
  - outputs.create
  - vault.*
  - kanban.create_card
```

Supported grant forms:

- `*`
- `*:read`
- `<surface>.*`
- exact action ID

`create_agent` validates grants before writing. Startup migration appends required grants for HNIC, Orchestrator, and Art Director without changing prompt bodies.

## Safety Rules

- User/HNIC context can discover actions directly.
- Active agents are checked against their `actionGrants`.
- Invalid or explicitly empty `actionGrants` fail closed. Legacy agents with no `actionGrants` field can still use internal actions only.
- `safe` or missing permission mode blocks internal writes. Internal writes require a bound `ask` or `allow-all` session.
- External, destructive, credential, publish, purchase actions fail closed unless a real adapter and approval path exist.
- Duplicate `execute_app_action` calls with the same request/input/actor return the prior receipt.
- Failed action attempts do not poison idempotency; retrying the same `requestId` can succeed after the adapter/session problem is fixed.
- Bad approval tokens do not burn the pending approval idempotency record.
- Approval-required actions cannot execute from the returned token alone; a server-side approval verifier must confirm user approval.
- Vault imports are serialized with a workspace mutex and refresh the Artist Vault context doc after import.
- Vault `kindHint` is an enum, not arbitrary model text.
- Network/Fans V1 `upsert` actions update by stable identity fields instead of blindly appending duplicates.

## Verification

Passed:

```bash
/Users/michaelb.williams/.bun/bin/bun test packages/session-tools-core/src/handlers/app-actions.test.ts packages/session-tools-core/src/handlers/create-agent.test.ts packages/shared/src/agent-definitions/storage.test.ts packages/shared/src/agent/__tests__/session-self-management-bindings.test.ts
/Users/michaelb.williams/.bun/bin/bun run --cwd packages/session-tools-core typecheck
npm run docs:system-map
```

Note: direct shared/server-core `tsc -p` in this nested worktree resolved `@craft-agent/session-tools-core` to the main checkout instead of this worktree and also hit pre-existing missing Pi SDK type packages. Use the focused tests above plus package-local typecheck as the current reliable verification for this slice.

## Next Work

1. Add native adapters for Calendar and Output approval updates.
2. Replace internal JSON surface records with real Kanban/Network/Fans/Campaign stores when those UI stores are ready.
3. Add renderer UI event consumers for app-action receipts if a visible activity/audit panel is desired.
4. Add a user-facing approval UI plus `verifyAppActionApproval` adapter that can approve `approvalToken` execution.
