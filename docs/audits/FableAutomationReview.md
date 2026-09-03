---
status: resolved
owner: fable
reviewed: 2026-09-02 (round 1 on uncommitted tree; round 2 on commit 24b6af713)
target: spec 33 implementation
spec: ../creator-command-center/33-automations-input-aware-setup-spec.md
---

# Fable Automation Review — Input-Aware Setup (Spec 33)

# Round 2 — after commit `24b6af713` ("harden automations and creator operations")

**Verdict: close, not yet bulletproof. Three real defects remain, all new
code, all small.** Every round-1 blocking item was addressed and the fixes
are the right shape — the untrusted envelope is threaded end-to-end into the
workflow run, unauthenticated webhooks are refused as an input source at all
three doors, answer evidence is bound to the artist's *current* turn and is
single-use across orders, the RPC door runs the same shared validator as the
manager door, and every write now asserts the document before persisting.
The three remaining items are edge interactions the new supersede logic and
the new auto-bind heuristic did not anticipate.

| Check | Result |
| --- | --- |
| Typecheck (shared, server-core, session-tools-core, electron) | 0 errors in all four |
| Tests, broad set (scheduled-work, rpc, session-tools, automations, workflows, renderer) | 1045 pass / 7 fail |
| Of those 7 | 6 are **pre-existing cross-file mock pollution** in `handlers/rpc` (polluters: `hq-state`, `shared-intel`, `team-permission-helpers` tests — none touched by this commit; the suite passes 33/0 alone). 1 is an unrelated 5 s `artwork_compose` timeout. |
| New guards with tests | supersede, single-use message, current-turn evidence (7 cases), unauthenticated-webhook refusal at the doors, untrusted envelope at both ends |

Two reviewer claims were **rejected after verification** and are not below:
"custom schedule saves a malformed cron" — false, `validateAutomationsConfig`
runs croner on every SchedulerTick matcher (`validation.ts:258-266`) and I
confirmed by execution that `abc 9 * * 1-5` and a one-field cron are rejected
at the RPC door with an error the artist sees.

## Must fix

### R1. "Run test" destroys the real Needs-you order and creates one that can never be supplied
`packages/server-core/src/sessions/SessionManager.ts:3212-3219` (queueTrackedWorkAutomation)
`packages/server-core/src/handlers/rpc/automations.ts:352-358`
`packages/server-core/src/scheduled-work/AutomationWorkQueue.ts:229-235, :133-135`

The test-run path hardcodes `event: 'SchedulerTick'` and passes no
`configuredAction`, but the RPC hands it the **real** `automationId` as
`matcherId`. So the test fire's `configurationDigest` never matches a real
fire's, which is exactly the new supersede predicate — the outstanding
`needs-setup` order for that automation is **canceled**. The order the test
creates carries `automationRef.event = 'SchedulerTick'`, so
`assertAutomationWorkRequestIsCurrent` looks in the wrong event bucket for any
FileWatch/Webhook/Message automation and both list and tool supply fail with
"This automation is disabled or no longer exists." Reproduced by execution.

Fix: pass `event` and `configuredAction` through from the real matcher, or
give test fires a synthetic `matcherId` (`test:<id>`) so they can never
supersede real work.

### R2. Supersede is keyed on `matcherId` alone; a second `queue-work` action in the same matcher cancels the first
`packages/server-core/src/scheduled-work/AutomationWorkQueue.ts:229-235`
`packages/shared/src/automations/schemas.ts:285` (`actions: min(1)`, no max)

`QueueWorkHandler` emits one pending item per `queue-work` action, all with
the same `matcher.id`; their `configuredAction` digests differ. One fire of a
matcher with actions A and B leaves A **canceled** and only B outstanding.
Reproduced by execution. Fix: include event and action identity (or the
action's own digest) in the supersede predicate.

### R3. File trigger auto-binds the first required string input even when it is not a file
`apps/electron/src/renderer/components/automations/automation-work-setup.ts:53-55`

The `??` fallback ignores the file-like check and takes the first required
`ask` string in declaration order. Against the shipped library that means
Blog Post Writer's `topic`, Outreach's `from`, and every `campaign_brief` /
`release_brief` silently become `{ mode: 'trigger', from: 'file.path' }` under
*On file*. Section 3 renders below section 2, so the artist never scrolls
back, and the review sentence names only `ask`/`fixed` bindings. Every drop
runs with `topic = "/Users/…/cover.png"`. The existing test uses
`design_file`, which satisfies the first arm, so it cannot catch this.
Related: the file-like regex is an unanchored substring over
name + description, so a text field `audio_description` outranks a real
`source_path` declared after it.

Fix: delete the fallback arm and match on name tokens only (`file|path|asset`).
If nothing matches, leave inputs as `ask` — an honest Needs you row beats a
silent wrong path.

## Should fix

- **Boolean asks are still word-matched.** `ScheduledWorkInputAnswerEvidence.ts:105-111` — "no worries, go ahead" in the current turn satisfies *both* polarities of any boolean input. Everything else about the evidence gate is now sound; this is the one residual a prompt-injected manager could use. Route boolean (and ideally number) asks to the Needs you form only.
- **`file.name` is exempt from the envelope and the 4 KB cap** (`AutomationWorkQueue.ts:730`). A watched folder can be shared or synced (spec 06 Team Mode), and a filename is ~255 bytes of attacker-chosen prose landing verbatim in the prompt. Envelope `file.name`; keep only `file.path` exempt.
- **Runtime unauthenticated-webhook refusal only logs.** `queue-work-handler.ts:42-46` → `SessionManager.ts:2622` never writes an automation-history entry, unlike the failure path forty lines above. A legacy config that predates the door-side check stops running with no artist-visible signal. Also: this runtime refusal has no test.
- **Coalescing early-return skips calendar reconciliation.** `AutomationWorkQueue.ts:259-312` returns before `reconcileCanceledCalendarProjections` (:365), orphaning superseded calendar rows; when `alreadyRepresented` is true nothing is written at all, silently discarding the supersede.
- **REPLACE / TOGGLE cancel all live work for the matcher before the config write** (`automations.ts:234-240`), so a failed write leaves the work canceled anyway. Cancel after a successful write.
- **`QueueWorkAction.title` has no `.trim()`** (`schemas.ts:151`) — residual of B5. A whitespace title passes config validation, fails `isScheduledWorkOrder`, and every fire throws "Scheduled Work item 1 is invalid" with no field or order id.
- **Observability still absent.** No logger in `AutomationWorkQueue` or `ScheduledWorkInputSupply`; the supply transition is the security-relevant event and leaves only the persisted receipt.
- **Pre-existing test pollution in `handlers/rpc`** — not this commit, but worth a separate fix: three test files' `mock.module` calls leak into `scheduled-work.test.ts`, so "0 fail" only reproduces with a narrower file set.
- **Polling cost:** `useGlobalRunningWork` issues 3N+1 IPC calls every 5 s for N workspaces. Fine at 3 workspaces; worth a single batched RPC before a manager with many artists hits it.

## Decision to confirm, not a defect

`supply_work_input` remains `safeMode: 'allow'` while its siblings are
`'block'`. I concur with keeping it — four host-enforced facts bound it
(HNIC-only; order must already be `needs-setup` for an artist-approved
workflow; evidence must be the current host-stamped human turn; values must
appear as whole tokens), and it matches the product rule that the artist's
answer *is* the approval. The boolean item above is the only residual.

## Confirmed fixed since round 1

B1 order (what → starts → needs) with reconcile re-offering over `fixed` and
applied on workflow change · B2 envelope + 4 KB cap + `"null"` refusal, `| escape`
correctly ignored inside the envelope, `untrustedInputNames` persisted in the
run snapshot and cloned on rerun · B4 current-turn evidence, single-use,
whole-token, simple-"yes" allowed only against the immediately preceding
visible assistant proposal · B5 write-side asserts at every `upsertContextDoc`
plus trimmed matcher name · B6 shared `assertWorkflowInputBindings` at
CREATE_FROM_TEMPLATE and REPLACE with workflow load, activation, and digest ·
calendar and Release Kit show "Needs setup"/"Needs you" in amber · supply
retry is a true no-op · `'reply'` source removed · webhook-body empty →
undefined · orphan supersede exists (see R1/R2 for its two holes) · cross-door
placement unchanged and both doors still fail closed · dialog reset leak ·
optional inputs cannot be `ask` · review sentence no longer "X will run with X" ·
raw cron gone from copy; `CronBuilder` used · cadence derived from cron fields
not English copy, `*/15 * * * *` tested · "waiting over a week" counter ·
**campaign-origin chip** renders the campaign name or "HQ" on every row ·
**Needs you spans all local workspaces**, with per-workspace `allSettled` so
one bad workspace hides nothing, and supply addressed to `item.workspaceId`
without switching workspace.

---


## Verdict

**Do not commit as-is. Six blocking items, none large.** The state machine
underneath is genuinely good: coalescing, redelivery idempotency, the supply
transition, lane exclusion, placement locking, and the HNIC-only gates are all
correct and mutation-verified. What is weak is exactly the two things this
slice *adds*: the proof that the artist actually answered, and the new path
that lets external payloads become workflow inputs. Plus the dialog order in
the tree is still what → needs → when, not the what → starts → needs that was
agreed.

Every finding below was verified at source by me or by a reviewer whose claim
I re-checked. Reviewer claims I could not confirm are not included.

## Resolution — 2026-09-02

All confirmed execution defects in this review are resolved. The dialog now
uses what → starts → needs and follows newly arrived files; external trigger
values are bounded and data-wrapped; artist answers are host-derived, exact,
single-request evidence; every scheduled-work write is validated; and both
creation doors enforce the same workflow bindings.

The `supply_work_input` tool intentionally remains `safeMode: 'allow'`. It is
available only to Artist Manager, requires a current human-authored answer or
the explicit Needs you form, and revalidates the exact automation and workflow
before admission. Adding another approval after the artist supplied the value
would be a redundant prompt, not a stronger trust boundary.

The follow-up defects are also closed: Needs you has a distinct UI state;
supply retries are terminal-safe; edited automations cancel stale requests;
empty webhook values fail; the unverified reply source is gone; custom cron is
not exposed in summary copy; optional inputs cannot pause runs; dialog state
fully resets; and HQ includes cross-workspace running, failed, and Needs you
work with origin labels. Review and social scheduling remain available through
the campaign scheduling path rather than the simplified automation dialog.

Final hardening also added durable restart catch-up, delivery failure
propagation, one global background lane with stale cross-workspace session
release, exact filesystem event identity across retries, and retirement of the
legacy campaign execution path.

| Check | Result |
| --- | --- |
| Tests (automations, scheduled-work, rpc, session-tools, renderer) | 593 pass / 0 fail |
| Typecheck (shared, server-core, session-tools-core, electron) | 0 errors in all four |
| Mutation probes on the 4 key tests | 4 of 4 caught (tree restored, verified by md5 of `git status`) |
| Weakened or deleted tests | None; 3 removed cases replaced by stronger ones |
| Secrets in diff | None |

Note: the working tree also still contains the earlier **staggered placement +
single global lane** work (spec 13 §5A) uncommitted. A commit now bundles both.

## Blocking

### B1. Dialog is what → needs → when; a fixed path survives a later file trigger
`apps/electron/src/renderer/components/automations/AutomationWorkDialog.tsx:285, :291, :301`
`apps/electron/src/renderer/components/automations/automation-work-setup.ts:47-50`

The agreed order (what → starts → needs) is not in the tree. Because `when`
defaults to weekly, the inputs section renders only *Same every time* / *Ask
me each time* — the artist never sees *From the trigger*. The reconcile that
runs when the trigger changes to a file only re-offers over `ask` bindings.

Failure: artist picks Merch Run, sets `design_file` to *Same every time*
`/vault/merch/current.png`, then picks *On file* watching `/vault/merch`. Every
drop runs against the stale hardcoded path. No error, no Needs you row.

Fix: move *When* to section 2 and inputs to section 3; extend reconcile to
re-offer file.path over `fixed` bindings too. Also apply reconcile in
`chooseTarget` (:189-199) so switching workflows after picking a trigger keeps
the auto-bind.

### B2. Trigger payloads reach workflow prompts raw, unbounded, from unauthenticated sources
`packages/shared/src/automations/handlers/queue-work-handler.ts:85-93` →
`packages/server-core/src/scheduled-work/AutomationWorkQueue.ts` (resolver) →
`packages/shared/src/workflows/template.ts:91`

`webhook.body`, `message.text`, and `url.content` bind straight into
`triggerInputs`. `{{trigger.<name>}}` renders verbatim unless the workflow
author hand-wrote `| escape`, and even that only replaces `& < >` with no
`<untrusted-*>` envelope (the house pattern used elsewhere, e.g.
`mission-assets/manifest-context.ts:81-89`). No string length cap at bind time
(webhook transport cap is 1 MB; message.text has none). `allowUnauthenticated`
webhooks are a plain boolean.

This channel did not exist before this change — spec §"What is actually
missing" item 2 says so. The slice opens it without opening the envelope.

Fix: at bind time in `resolveWorkflowInputBindings`, cap trigger-derived
strings (~4096) and wrap them in `<untrusted-trigger-data name="…">` with
escaping; refuse `mode: 'trigger'` from an `allowUnauthenticated` webhook
unless explicitly opted in.

### B3. `supply_work_input` is `safeMode: 'allow'`; every sibling mutator is `'block'`
`packages/session-tools-core/src/tool-defs.ts:1888` (vs `:1887`, `:1889`)

This tool performs the needs-setup → scheduled transition that admits an order
to the lane and executes a workflow. In Safe mode it runs with no permission
gate. One-line fix: `safeMode: 'block'`.

### B4. Answer evidence proves a timestamp and a substring, not an answer to that request
`packages/server-core/src/scheduled-work/ScheduledWorkInputAnswerEvidence.ts:11-49`
`packages/server-core/src/scheduled-work/AutomationWorkQueue.ts:344-351`

What is host-verified and good: caller is HNIC only (double-gated), the model
cannot fabricate `sourceMessageId`/`sourceMessageAt` (host-stamped), cannot
cite its own message (`inputOrigin === 'human'` provenance is sound), cannot
smuggle extra keys. What is not:

- `inputRequest` is created with no `sessionId`/`messageId`, so the linkage
  guards in `ScheduledWorkInputSupply.ts` are dead code in V1. The artist need
  never have seen the ask.
- Strings: `evidence.includes(value)` — the model picks the value; the
  artist's text only has to contain it. Nothing marks a message consumed, so
  one message can arm N orders.
- Booleans: `false` is satisfied by the word "no", `true` by "on" — "see you
  on Friday, no worries" satisfies both polarities for any boolean input.

Combined with B3 and the fact that untrusted collector packets are piped into
HNIC context, a poisoned manager can arm several fed runs off one unrelated
artist sentence with no gate and no prompt.

Fix: have the host post the ask into the manager session and record its
message id on `inputRequest`; scan only messages after it; require whole-token
equality; route boolean and number asks to the list form only.

### B5. Unvalidated writes into an all-or-nothing document can wipe every order in a workspace
`packages/server-core/src/scheduled-work/AutomationWorkQueue.ts:127-135, :157-167`
`packages/shared/src/scheduled-work/index.ts:646-649, :1157-1166`
`packages/shared/src/automations/schemas.ts:277`

`AutomationWorkQueue` writes orders via `upsertContextDoc` without running
`isScheduledWorkOrder`. The reader rejects the whole document if one item is
invalid. The reviewer proved by execution that a matcher `name: "   "` passes
`validateAutomationsConfig` (schema is `z.string().optional()`, no trim), lands
in `automationRef.name`, fails `clean()`, and on the next read collapses a
two-item document to `items: []` — the healthy order is lost too, the scan
halts on one warn line, and supply/cancel/list RPCs throw.

Both current UI doors trim, so this is latent today, but `automationRef` is
new in this diff and the blast radius is total.

Fix: `clean()`-normalize `automationRef.name`; `.trim().min(1)` on the matcher
name schema; validate with `isScheduledWorkOrder` before every write in
`AutomationWorkQueue` and `ScheduledWorkRunner.writeWork`.

### B6. "Never schedule a lie" is enforced only at the manager door
`packages/server-core/src/handlers/rpc/automations.ts` (CREATE_FROM_TEMPLATE / replace)
vs `packages/server-core/src/scheduled-work/HnicScheduledWork.ts:584-618`

The RPC door validates with `validateAutomationsConfig` only, which has no
workflow access. It accepts an undeclared binding key, a required input with
no binding, and `trigger:file.path` under a SchedulerTick — all three of which
`schedule_work` rejects. The renderer's `validateWorkflowInputBindings` is
good but is not the trust boundary. A typo'd key `desing_file` saves clean;
every fire then throws in the resolver, which is caught into a history entry
(`SessionManager.ts:2596-2607`) — no order, no Needs you row. This is the
silent failure Core Law 2 exists to prevent, and it breaks Core Law 1.

Fix: hoist `validateWorkflowInputBindings` into `@craft-agent/shared/automations`
and call it from the RPC door before persist.

## Should fix before calling it done

- **needs-setup renders as red "failed" on the Campaign Calendar.**
  `CampaignCalendarPage.tsx:1309` maps it to `'failed'`. Pre-existing line
  (July), newly reachable. Also `'draft'` on the Release Kit page via
  `scheduled-work/index.ts:864`. Give it its own "Needs you" status.
- **Idempotent supply retry rewrites the calendar projection with no status
  guard.** `ScheduledWorkInputSupply.ts:50-61`. Canceled-after-supply →
  throws "Linked campaign calendar item was not found" (spec says no-op);
  otherwise force-writes the item back to `scheduled`. Reachable by a
  double-click on Supply. `ScheduledWorkInputSupply.test.ts:154-191` asserts
  the buggy behavior as intended and must be amended.
- **A title edit orphans an outstanding needs-setup order forever.**
  `AutomationWorkQueue.ts:244-248` hashes the whole action, so a benign edit
  stops coalescing; the old row becomes a permanent zombie. Supersede
  outstanding orders whose `matcherId` matches but digest does not.
- **Bodyless webhook feeds the literal string `"null"`** into `webhook.body`
  (`queue-work-handler.ts:85-87`) instead of failing loudly like the other
  three sources.
- **`'reply'` supply source accepted with zero verification**
  (`ScheduledWorkInputSupply.ts` `assertSupplyInput`). No caller today; remove
  from the union until spec 26 linkage exists.
- **Review sentence reads "Merch Run will run with Merch Run"**
  (`automation-work-setup.ts:145`) because name defaults to runner name; the
  unit test masks it by using different strings. Spec's sentence names the
  fixed values instead.
- **Raw cron shown to the artist** in the review sentence and toast for
  custom, and the occupancy-failure fallback drops a non-technical artist into
  a bare cron input. `CronBuilder.tsx` exists but is playground-only.
- **Review/social-publish automations and follow-up chaining were dropped
  from the dialog** (old `allowedTypes` had four; new `SetupTarget` is
  agent-or-workflow). Not in spec Non-Goals; `AutomationWorkQueue` still
  supports follow-ups. Decide whether this was intentional.
- **`AutomationsListPanel` is now dead outside the playground**, taking the
  only search box, kind filters, and batch enable/disable with it.
- **Observability section unimplemented.** No log on fed fire, none on supply
  (the security-relevant event), no "waiting over a week" counter.
- **Optional inputs can be marked `ask`** and then block every fire forever
  with nothing surfaced. Restrict to required or document.
- **Dialog reset leaks** watchPath/webhookSlug/secretEnv/pollUrl/etc. into
  the next automation created in the same session
  (`AutomationWorkDialog.tsx:122-147`).

## Product note: campaign-origin tag (owner's sidenote)

**Not implemented, and the data is already on the item.** `owner.scope` exists
on every order and `ownerScope` on every action, but nothing in
`features/active-work` reads either. `ActiveWorkItem` carries `workspaceId`
only. A rendering-only change: derive an origin chip — **HQ** or the campaign
workspace name — from `item.workspaceId` against the workspace list and show
it after the cadence tag.

Related and more important: **needs-setup orders from non-active workspaces
never surface.** `build-active-work-items.ts:173-176` admits foreign-workspace
orders only when `status === 'running'`. A campaign-scoped fed automation that
fires while the artist is in HQ is visible nowhere until they switch
workspaces — the opposite of the scope-of-work visibility being asked for.
`ActiveWorkPage.tsx:432-435` also looks up the order and workflow in the active
workspace only, so cross-workspace supply needs plumbing, not just a filter
change. Recommend treating "campaign runs appear in the HQ list, tagged" and
"Needs you spans all local workspaces" as one slice.

## Tests: what the 593 do and do not prove

Coverage against the spec's 11 acceptance bullets:

| Bullet | Status |
| --- | --- |
| Dialog and `schedule_work` produce identical actions | **No test.** Each door tested alone; Core Law 1 rests on both happening to call shared helpers. |
| Required input with no binding rejected at both doors, naming the input | Verified at manager door; dialog door safe by construction only (see B6 for the RPC gap). |
| Fed fire → one needs-setup, no running, lane free | Verified, mutation-caught. |
| Supply via manager and list → scheduled, startAt set | List path fully asserted; **tool path asserts only the receipt**, not status or startAt. |
| Two fires → count 2, redelivery doesn't increase | Verified, mutation-caught. Strongest test in the change. |
| FileWatch + trigger:file.path → bound, no ask | Verified, mutation-caught. |
| Manager cadence and dialog Weekly pick the same slot | **No cross-door test.** |
| Occupancy failure → no confident slot at either door | Manager door verified; dialog fallback exists but untested. |
| Ten needs-setup across three workspaces don't block | Single order, single workspace only. |
| Cadence tags for the four spec crons | **Stub-only.** Every cadence test injects `describeCron: (cron) => cron`; the "Custom schedule" branch is reachable only under that stub. With the real function `0 9 1,15 * *` → "Monthly" (test asserts Custom), `0 9 * * 0,6` → "Weekends at 09:00" (a time leaks into a cadence tag), and `*/15 * * * *` is never tested. Derivation is a regex over English output (`build-active-work-items.ts:106-107`), not cron field parsing, so tags silently track copy changes. |
| Running now spans all local workspaces | Verified. |

Zero render tests exist for `AutomationWorkDialog`; B1, the relabel, Once-hidden,
and the occupancy fallback are all untested at the component level.

## Verified correct (so nobody re-litigates it)

- Core Law 5 holds at every door: `shouldScanOrder` (:1249-1263) is a positive
  allowlist, `hasOccupiedBackgroundLane` counts only `running`,
  `isOldestDueBackgroundOrder` skips non-scheduled, `claimRunning` refuses
  non-scheduled. Restart reconciliation, missed-start-window, and
  continuation are all status-gated. `needs-setup` appears nowhere in the runner
  and cannot enter or block the lane.
- Coalescing and redelivery: three independent guards (`exactRoot`,
  `alreadyRepresented`, `previouslyRepresented`), each with its own failing
  assertion under mutation. Cross-automation merge impossible (matcherId in
  both digests); cross-workspace impossible (per-workspace document).
  `configuredAction` (unexpanded) is used for identity so `$VAR`-expanded titles
  do not fracture it — a good call, directly tested.
- Supply: all requested keys required at once; full schema validation via
  `normalizeWorkflowTriggerInputs`; workflow digest and activation rechecked;
  `startAt` = supply time; `expectedUpdatedAt` honored when present; same
  `requestId` retry is a no-op (modulo the projection bug above). Everything
  under one workspace mutex shared with the queue and the runner.
- Placement lock wraps occupancy-read and persist at both doors; both doors
  throw on occupancy-read failure rather than assert a slot. Timezone parity
  holds.
- Missing trigger payload fails loudly per item into history — it does not
  silently produce `undefined` or fall back to `ask`.
- `inputBindings` are excluded from `$CRAFT_*` env expansion, so a payload
  cannot rewrite a binding mode.
- Trigger-source vocabulary is identical across renderer, tool schema, and
  server (`file.path`, `file.name`, `webhook.body`, `message.text`,
  `url.content`), with the string-type gate matching on both sides.
- Defaults match spec: default → fixed; required no default → ask; optional no
  default → omitted. `false` and `0` survive both compaction and fixed-value
  paths.
- Honest labelling: *Once* hidden at three layers when fed; weekly/daily
  relabelled; no copy anywhere promises an agent will message the artist.
- Grouped list (Running now / Needs you / Up next / Paused) is implemented in
  `features/active-work/ActiveWorkPage.tsx`, with inline Supply, `×N` coalesced
  count, both page-level setup actions, and the manager opening question.
- Manager skill text contains the one-question rule, prefers `cadence` over
  `cron`, and explains fixed/ask/trigger. Skill `tools:` frontmatter grants
  nothing new.
- `scheduledWork.MUTATE` refuses any upsert touching `inputRequest` or
  `inputSupplyReceipt`; renderer cannot claim `source: 'tool'`; workspace
  scoping on the new RPC is correct.

## Spec slices

| Slice | Status |
| --- | --- |
| 1 Bindings model + trigger plumbing | Done |
| 2 Runner + supply transition | Done (lane test single-workspace only) |
| 3 Tool contract + skill text | Done (RPC-door parity missing — B6) |
| 4 The ask (in-app Needs you + manager supply) | Done, but evidence weak — B4 |
| 5 Dialog | Partial — order is what → needs → when (B1); custom cron builder not done |
| 6 List | Done except "waiting over a week" counter; cadence tag hidden below `md` |
| 7 Docs | Done |
| — Campaign-origin tag | Not done (owner's sidenote) |

## Suggested fix order

1. B3 (one line) and B1 (reorder + reconcile) — cheapest, highest user impact.
2. B2 and B4 together — they share the "untrusted text enters the system" theme.
3. B5 and B6 together — both are "the write path skips what the read path enforces"; the supply-retry projection bug belongs in the same pass.
4. Campaign-origin chip + cross-workspace Needs you as one slice.
5. Tests: cross-door parity, real `describeCron` in cadence tests, tool-path supply asserts status/startAt, one multi-workspace lane test, three dialog render tests.
