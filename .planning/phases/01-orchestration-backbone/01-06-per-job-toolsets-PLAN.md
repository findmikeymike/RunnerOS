---
phase: 01-orchestration-backbone
plan: 06
type: tdd
wave: 4
depends_on: []
files_modified:
  - packages/shared/src/workflows/trigger-inputs.ts
  - packages/shared/src/workflows/__tests__/trigger-inputs.test.ts
  - packages/shared/src/workflows/workflow-runner.ts
  - packages/shared/src/automations/handlers/prompt-handler.ts
autonomous: true
requirements: [R5]
must_haves:
  truths:
    - "trigger-inputs schema exposes enabled_source_slugs?: string[] and permission_mode?: 'default' | 'subconscious' | 'yolo'"
    - "Per-job enabled_source_slugs overrides per-platform 'cron' config"
    - "Per-platform 'cron' config overrides full default toolset"
    - "Workflow run with enabled_source_slugs: ['github'] rejects calls to other source slugs at runtime with a clean tool-denied error (not crash)"
    - "Absent override falls through to default toolset"
    - "Precedence chain documented in trigger-inputs.test.ts"
    - "Nonexistent toolset name → log warning, fall back to default (no crash) — matches Hermes graceful degradation"
    - "Backward compat: existing workflows without the new fields keep current behavior"
  artifacts:
    - path: "packages/shared/src/workflows/trigger-inputs.ts"
      provides: "Extended schema with enabled_source_slugs + permission_mode"
    - path: "packages/shared/src/workflows/__tests__/trigger-inputs.test.ts"
      provides: "Precedence chain coverage"
  key_links:
    - from: "packages/shared/src/workflows/workflow-runner.ts"
      to: "packages/shared/src/workflows/trigger-inputs.ts"
      via: "resolveEnabledToolsets(trigger, cfg) consumed at agent init"
      pattern: "resolveEnabledToolsets"
---

<objective>
Port Hermes (MIT) per-job toolset precedence pattern (`cron/scheduler.py:60-88`, `_resolve_cron_enabled_toolsets`) to RunnerOS. Extend `trigger-inputs.ts` with two optional fields; add a resolver that implements the three-tier precedence chain.

Purpose: Lets users gate individual cron/workflow runs to a narrow toolset (e.g., GitHub-only for a PR-summarizing job) without recreating every job, and without inheriting an over-permissive default.

License: Hermes MIT (credited).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/01-orchestration-backbone/01-SPEC.md
@.planning/research/03-hooks-prompt-cron.md
@packages/shared/src/workflows/trigger-inputs.ts
@packages/shared/src/workflows/workflow-runner.ts

<interfaces>
Per Hermes (research/03 §Upgrade 8):
Precedence:
1. Per-job enabled_source_slugs (highest)
2. Per-platform config (cfg.platforms.cron.enabled_toolsets or equivalent)
3. Full default toolset (lowest)

Graceful degradation: if any lookup throws → log warning, return null/undefined → caller loads full default toolset.

permission_mode: "default" | "subconscious" | "yolo"
  - default: existing behavior (allow/deny per permissions-config)
  - subconscious: pause on write attempts and escalate (full impl in plan 07)
  - yolo: skip approval checks entirely

For this plan: define + plumb permission_mode through trigger-inputs and into the agent run context. The "subconscious" mode runtime semantics ship in plan 07.

resolveEnabledToolsets signature:
```ts
function resolveEnabledToolsets(
  trigger: TriggerInputs,
  platformConfig: { cron?: { enabled_source_slugs?: string[] } } | undefined,
  fullDefault: string[]
): string[]
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — precedence chain tests</name>
  <files>packages/shared/src/workflows/__tests__/trigger-inputs.test.ts</files>
  <behavior>
    - trigger.enabled_source_slugs=["github"] + cron config=["slack","github"] + default=["fs","github","slack"] → returns ["github"]
    - trigger.enabled_source_slugs=undefined + cron config=["slack"] + default=["fs","github","slack"] → returns ["slack"]
    - trigger.enabled_source_slugs=undefined + cron config=undefined + default=["fs","github"] → returns ["fs","github"]
    - trigger.enabled_source_slugs=["nonexistent"] → returns ["nonexistent"] (resolver does NOT validate existence; runtime tool-denied error happens at call site — matches Hermes)
    - Bad cron config (lookup throws) → falls through to default; warning logged
    - Backward compat: trigger with no new fields → enabled_source_slugs and permission_mode undefined
    - permission_mode validation: "default" | "subconscious" | "yolo" accepted; "garbage" rejected by schema
    - Runtime tool gating: workflow with enabled_source_slugs=["github"] invoking a "slack" tool → returns a clean tool-denied result (not a crash)
  </behavior>
  <action>Create test file. Mock the workflow-runner's tool dispatch via dependency injection to assert the runtime gating behavior in unit test rather than booting a full agent. Run — must fail.</action>
  <verify>
    <automated>bun test packages/shared/src/workflows/__tests__/trigger-inputs.test.ts 2>&1 | grep -q "fail\|cannot find module\|not.*defined"</automated>
  </verify>
  <done>RED.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — extend schema + implement resolver</name>
  <files>packages/shared/src/workflows/trigger-inputs.ts</files>
  <action>
    1. Read existing `packages/shared/src/workflows/trigger-inputs.ts` schema (likely zod or io-ts — match the existing pattern).
    2. Add to schema (optional, backward-compatible):
       - `enabled_source_slugs?: string[]`
       - `permission_mode?: "default" | "subconscious" | "yolo"`
    3. Add resolver function:
       ```ts
       export function resolveEnabledToolsets(
         trigger: TriggerInputs,
         platformConfig?: { cron?: { enabled_source_slugs?: string[] } },
         fullDefault?: string[]
       ): string[] | undefined {
         try {
           if (trigger.enabled_source_slugs && trigger.enabled_source_slugs.length > 0) {
             return [...new Set(trigger.enabled_source_slugs.map(s => s.trim()).filter(Boolean))];
           }
           if (platformConfig?.cron?.enabled_source_slugs) {
             return [...new Set(platformConfig.cron.enabled_source_slugs)];
           }
           return fullDefault;
         } catch (e) {
           logger.warn({ err: e }, "resolveEnabledToolsets failed; falling back to default");
           return fullDefault;
         }
       }
       ```
    4. Add `resolvePermissionMode(trigger, platformConfig): "default" | "subconscious" | "yolo"` with same precedence pattern, defaulting to "default".
    5. Header comment: ported from Hermes (MIT).
    6. Run tests — pass.
  </action>
  <verify>
    <automated>bun test packages/shared/src/workflows/__tests__/trigger-inputs.test.ts && bun run typecheck:all</automated>
  </verify>
  <done>Schema extended, resolver covers all precedence cases.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Wire resolver into workflow-runner runtime gating</name>
  <files>packages/shared/src/workflows/workflow-runner.ts, packages/shared/src/automations/handlers/prompt-handler.ts</files>
  <behavior>
    - workflow-runner calls resolveEnabledToolsets at agent-init time and passes result to the agent
    - Tool calls outside the resolved toolset return a typed "tool not enabled" denial
    - prompt-handler (which fires workflows from automations) forwards trigger.enabled_source_slugs / permission_mode untouched
  </behavior>
  <action>
    1. In `workflow-runner.ts`: locate the spot where the agent is initialized with a toolset. Insert resolver call. Pass result to agent. On a tool call invocation, intercept and check against the resolved set; if not in set, return `{ error: "tool not enabled for this run", denied: true }` (not throw).
    2. In `prompt-handler.ts` (automations handler that fires workflows): make sure `enabled_source_slugs` and `permission_mode` from the automation config flow through into the trigger inputs untouched.
    3. Add an integration test asserting end-to-end: automation → workflow with override → blocked tool call.
    4. Validate.
  </action>
  <verify>
    <automated>bun test packages/shared/src/workflows/ packages/shared/src/automations/ && bun run typecheck:all && bun run lint</automated>
  </verify>
  <done>Per-job toolset enforcement live at runtime.</done>
</task>

</tasks>

<verification>
- Precedence chain exhaustive (per-job > platform > default)
- Graceful degradation on bad config
- Backward compat: old workflows unchanged
</verification>

<success_criteria>
A workflow created with `enabled_source_slugs: ["github"]` cannot invoke Slack tools even if Slack is in the global default. Permission mode "subconscious" plumbs through (semantics impl in plan 07).
</success_criteria>

<output>
After completion, create `.planning/phases/01-orchestration-backbone/01-06-SUMMARY.md`.
</output>
