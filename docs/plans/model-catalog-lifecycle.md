# Automatic model discovery and lifecycle

Status: proposed implementation plan; no application changes made.
Prepared: 2026-09-17.
Baseline: `cc0ed4d9e77dd74a694c2f6dc11e6786222b4df7` on canonical Artist OS main.
Worktree: `/Users/michaelb.williams/RunnerOS/.worktrees/active/model-catalog-lifecycle`.
Branch: `codex/model-catalog-lifecycle`.

## 1. Outcome and boundaries

Connected models stay current automatically. Artists see a short, understandable list, while older or specialized choices remain reachable. A background catalog refresh must never change how their existing agents, conversations, or workflows run.

User-approved direction:
- Keep existing Settings, providers, accounts, subscriptions, credentials, endpoints, and request routes.
- No new user account, proxy, gateway, setup page, or AI task for routine discovery.
- Models.dev supplies public metadata only. It receives no credentials, model selections, artist context, or conversations. Fetch the complete public feed, then match locally.
- Preserve explicit defaults, manually chosen model lists, custom endpoints, agent/session/workflow overrides, voice selections, and fallback chains.
- Automatically discover compatible models; move superseded choices out of the default view rather than accumulating an endless list.
- Automatic switching of defaults, including an opt-in “keep defaults current” mode, is OUT of this implementation.
- No image/video generation catalog changes, paid test generations, or automatic dependency installation.

## 2. Verified baseline and gaps

| Code | Current behavior / implication |
|---|---|
| `packages/server-core/src/model-fetchers/index.ts` | Central refresh service, per-connection in-flight deduplication, startup refresh, persisted fallback. Replaces `connection.models` and can replace missing `defaultModel` with provider default/first entry. Must stop silent default replacement. |
| `model-fetchers/anthropic.ts` | Hourly discovery through Anthropic driver. |
| `model-fetchers/pi.ts`, shared `agent/backend/internal/drivers/pi.ts` | Copilot live list with 10-minute refresh; OpenRouter live list but generic Pi timer is zero; most other Pi providers use bundled SDK lists. |
| `packages/shared/src/config/model-fetcher.ts` | Results contain models and optional default, but no completeness, freshness, evidence, or failure outcome. |
| `packages/shared/src/config/llm-connections.ts` | Existing automaticallySyncedFromProvider vs userDefined3Tier ownership. Custom endpoint capabilities are explicitly configured. Preserve both contracts. |
| `packages/shared/src/config/openrouter-models.ts` | Public list; text filtering; sorts by price, not independently demonstrated quality. Missing price currently defaults to zero. Do not infer “best” or “free” from these values. |
| `packages/server-core/src/handlers/rpc/llm-connections.ts` | Refresh can report success even when the service swallowed a provider failure and kept cache. Report truthful refresh outcomes. |
| `packages/shared/src/config/models.ts` | Bundled registry and ModelDefinition remain useful offline/runtime inputs. Metadata discovery is not a substitute for SDK compatibility. |

### Critical cross-system findings

- `packages/server-core/src/workflows/durable-read-runner.ts:112-120` includes the entire connection model list in `bindingDigest`. Later resume/replay checks compare that binding. Adding an unrelated model must not invalidate a paused workflow. Decouple discovery-only changes from runtime authorization while preserving selected model, protocol, source/account identity and credential-binding checks. Version the binding format; do not silently accept old digests using a weaker comparison. For pre-upgrade frozen runs, retain their existing binding inputs and connection model-list representation: catalog refresh writes only the new sidecar and must not mutate that bound list. New runs may use a versioned selected-model binding. Do not reconstruct an old authorization from current state or translate a stored digest by assertion. If a needed runtime-registration change cannot preserve the legacy binding, defer that change until those runs complete; do not silently weaken verification.
- `packages/shared/src/agent/backend/factory.ts:764-790` treats connection models as an allowlist and can fall back when a pinned ID disappears. `packages/shared/src/config/storage.ts:1962-1972` can reset a missing default during startup. `packages/server-core/src/sessions/SessionManager.ts:12886-12903` can clear an incompatible requested model. Preservation must cover all three, not just the refresher.
- `packages/pi-agent-server/src/model-resolution.ts:19-71` requires a matching registered provider model. In `index.ts:648-679`, unresolved non-durable selection can leave the SDK to choose a default; `index.ts:1557-1580` can ignore an unsupported mid-session switch. Require explicit resolution success or actionable failure; the UI must not claim a switch succeeded when the runtime ignored it.
- `packages/shared/src/config/llm-connections.ts:450-490` stores per-model image overrides in the model list. Preserve those overrides. Its `309-344` utility-model selection also depends on ordering: sorting the picker must not silently change the summarizer/mini model.

### Consumer map

- `apps/electron/src/renderer/App.tsx`: existing connection-change event reload and AppShell state.
- `components/app-shell/input/FreeFormInput.tsx`: chat selection, image/thinking controls and context limit display.
- `pages/settings/AiSettingsPage.tsx`: app/workspace defaults and fallback chains.
- `components/app-shell/AgentsLaunchpad.tsx`, `AgentEditDialog.tsx`: currently fetch once on opening; open dialogs need shared catalog updates too.
- `pages/settings/ConversationSettingsPage.tsx`, `lib/voice-model-options.ts`: voice-specific eligibility.
- `pages/WorkflowEditPage.tsx`, shared automation validation, server frozen execution plans: role choices and persisted run bindings.

Renderer paths above are relative to `apps/electron/src/renderer/`. Line numbers identify the inspected baseline, not a permanent contract.

This is an inspection of committed code, not live provider certification. Recheck paths against main before implementation; concurrent work was deliberately excluded from this worktree.

## 3. Architecture: three separate decisions

1. **Provider discovery:** What does this provider/auth surface currently list?
2. **Runtime compatibility:** Can this installed Artist OS adapter actually run that model, with the capabilities required by the selected task?
3. **Presentation:** Which compatible choices belong in Recommended, All models, or Older models?

Do not encode all three as removal from `connection.models`.

Proposed implementation modules (names are proposals):
- `packages/shared/src/config/model-catalog.ts`: typed identity, facts, refresh results, presentation view.
- `packages/server-core/src/model-fetchers/models-dev.ts`: fixed-host public feed loader and strict parser.
- `packages/server-core/src/model-fetchers/catalog-cache.ts`: versioned cache and conditional fetch state.
- `packages/shared/src/config/model-catalog-policy.ts`: deterministic compatibility/lifecycle/grouping rules; reviewed recommendation policy.
- Extend existing refresh service/driver dispatch and RPC; keep networking in server code.
- Share one derived catalog view across picker consumers, rather than duplicating filtering rules in each component.

### Identity and data ownership

Use `(connection slug, provider/auth surface, exact model ID)` for runnable choices. Match metadata through explicit provider-ID mappings and documented aliases; never fuzzy-match names or strip snapshot dates to produce a runtime ID. Same-brand subscription access and API-key access are distinct.

Keep a versioned sidecar cache under the existing config root. Do not move credentials or rewrite connection IDs. Store:
- Public Models.dev snapshot, fetched/validated time, ETag/Last-Modified when supplied.
- Per-connection discovery snapshot, full-success time, last attempt/outcome, completeness and provenance.
- Model facts with provenance and unknown values preserved: input/output modalities, tools, reasoning options, context limits, prices, lifecycle hints.
- Runtime support result: supported / requires-app-update / unknown, with internal reason.
- Availability: listed / missing-unconfirmed / unavailable-confirmed / unknown.
- Presentation: recommended / current / older / preview. These are independent of availability.

Model pricing is nullable; missing does not mean free. Unknown images/tools/context does not mean supported. A model may be old and still available, or current but unavailable to this account.

`connection.models` remains a backward-compatible configured/runtime list during migration. Introduce a derived view instead of treating a shorter picker shortlist as the only executable models. Before adding dynamic models, prove the adapter's registration path accepts them safely. Static SDK-only providers remain limited to supported definitions until their adapter is upgraded.

### Precedence

- Existing connection/auth/provider settings control routing; downloaded catalog cannot change hosts, headers, adapters, or API types.
- Provider discovery determines listing for that surface; runtime support gates selectability.
- Provider-specific capability facts override generic model facts, subject to adapter restrictions.
- Explicit user custom-endpoint capability settings remain user-owned.
- Models.dev fills missing descriptive facts and supplies lifecycle hints; a public entry does not establish account entitlement.
- Reviewed Artist OS policy supplies recommendations and successor relationships; catalog release dates, names, price, or age alone cannot establish quality or retirement.
- Disagreement yields a conservative view. Never disable a working selected model solely because community metadata says deprecated.

## 4. Provider rollout matrix

| Connection surface | Plan |
|---|---|
| Direct Anthropic | Keep existing API/auth flow and hourly refresh. Add bounded pagination, structured outcomes, lifecycle facts, and safe default preservation. |
| Pi Copilot | Retain existing token exchange/listing and 10-minute cadence. Respect account policy; do not replace discovery with generic GitHub metadata. |
| Pi OpenRouter | Add regular refresh and preserve tool/capability/expiration fields. Use authenticated account-filtered list only through supported endpoint and existing credential path; public catalog fallback is labeled non-account-verified internally. |
| Pi OpenAI API key | Add documented models-list adapter; catalog adds capability detail that listing lacks. Exclude embeddings/audio-only/etc. from agent picker. Runtime registration is a required gate. |
| Pi Google Gemini API key | Add documented paginated models.list adapter; filter generation support and prove tools/images through runtime definitions. |
| Other Pi API-key providers | Enumerate provider/auth IDs already supported in repo during slice 1. Add only documented compatible read endpoints, one bounded provider adapter at a time. No speculative `/models` requests to arbitrary endpoints. |
| Subscription/OAuth surfaces without a supported listing endpoint | Use existing supported runtime discovery or SDK snapshot plus metadata enrichment. Do not use API-key model catalogs as proof of subscription access, request new scopes, or reverse-engineer private endpoints for this feature. |
| pi_compat / local / custom hosts | Preserve user-owned setup and model list. Existing explicit OmniRoute discovery remains explicit. No automatic endpoint or capability rewrites. |

Completion requires a recorded result for every current provider/auth ID: live discovery, SDK-only fallback, or user-managed. “Every new model appears instantly on every provider” is not a valid promise.

## 5. Refresh behavior

- Public metadata: once per 24 hours, startup if stale, cached immediately while refresh runs.
- Provider discovery: startup if stale and then daily by default. Preserve existing faster Copilot/Anthropic cadence. Manual Refresh bypasses freshness delay but shares in-flight request.
- Newly connected/authenticated provider: refresh that connection; no extra setup screen.
- Resume from sleep: one stale check, not a burst of missed timers. Limit concurrent provider refreshes to two.
- Defaults: 15-second bounded request, complete pagination with total deadline/page and payload limits. Large public feed limit chosen from measured feed size with headroom, tested and documented.
- Retry transient failures with capped backoff/jitter; no aggressive retries on bad credentials or permission failures.
- Keep last valid cache on timeout, invalid JSON, partial pages, rate limit, empty/suspicious list, or offline state.
- Empty/error/partial results never retire models or wipe lists.
- Use atomic cache writes, a schema version, and retain last known good data. Corrupt cache falls back to configured/bundled definitions.
- On completion, re-read connection state. Discard response if connection was deleted, auth/endpoint changed, or ownership changed while request ran. Merge without overwriting concurrent user selections.
- Timer shutdown cancels pending work; connection deletion removes timers and prevents late re-creation.
- Push one catalog-change event only for material changes. All relevant windows and surfaces update without restart; an active selection stays stable.
- Refresh result distinguishes fresh, unchanged, cached/offline, unsupported-discovery, and failed. Existing callers remain backward compatible while richer consumers use the result.

## 6. Retirement and shortlist rules

Recommended is a maximum of three distinct validated options per connection, using existing Best/Balanced/Fast vocabulary where supported. Show the selected model alongside the shortlist even when it is not recommended. Do not invent latency rankings from price.

All models exposes other compatible current models. Older models is collapsed and searchable. Preview models stay outside recommendations. Search can find exact IDs and older choices without adding a new Settings page.

A model moves to Older when a reviewed successor rule supersedes it in the same provider surface/family/use case, or trustworthy lifecycle evidence marks it legacy. Preserve useful cheap/fast specializations. A newly discovered model can appear in All models immediately after compatibility checks; recommendation promotion requires reviewed policy evidence.

Availability rules:
- One missing entry from one refresh: missing-unconfirmed; do not delete or change selections.
- Missing from two complete successful account-scoped enumerations at least 24 hours apart: unavailable for that connection ONLY when the endpoint contract guarantees exhaustive runnable entitlement, including aliases. Otherwise remain missing-unconfirmed: catalogs may omit runnable aliases or grandfathered models. Absence from filtered/public lists never confirms unavailability.
- Explicit authoritative shutdown/revocation evidence may confirm unavailability earlier. Temporary network/auth-wide failure does not.
- Announced future shutdown: show warning only where the model is selected; do not disable before date. Null/unknown expiration is not retired.
- Unavailable selected model stays visible with “Choose a replacement”; no silent migration of any saved reference.
- Existing explicit fallback chains retain their execution semantics. This feature neither adds a fallback nor changes one.
- A user selecting a replacement uses the existing per-surface save action; never bulk-rewrite agents and workflows implicitly.

## 7. Compatibility and privacy

Consume a strict allowlist of facts from downloaded JSON. Never execute downloaded code, fetch remote logos/scripts, use downloaded provider URLs, or inject descriptions into agent instructions. Public catalog requests carry no provider Authorization header. Credential-bearing discovery stays on the configured/trusted provider surface, with existing endpoint policies and redirect controls.

Do not infer tool calling from text output. Test image support, context limits, reasoning controls and request shaping independently. Unknown dynamic Pi definitions must not silently fall back to a different model or a guessed context size. Unsupported new models are absent from the simple selectable list; advanced view can explain that an app update is required.

No paid inference in background discovery. Live generation checks are a separate authorized smoke step, with disposable prompts and bounded spend if needed. Listing is not reported as a successful generation test.

## 8. Implementation slices and gates

### Slice 1 — contracts and selection preservation
- Enumerate all provider/auth surfaces and all model consumers.
- Introduce typed refresh outcomes and catalog identity/facts without UI changes.
- Remove silent default replacement from refresh; preserve userDefined3Tier and manually configured entries.
- Establish additive sidecar storage and migration fixtures for current configurations.
- Separate catalog presentation from runtime allowlists, utility-model ordering, startup backfill and session model validation. Preserve per-model user capability overrides.
- Specify and test versioned durable binding compatibility before any refresh can affect model definitions; unrelated catalog updates must not invalidate frozen runs.
- Gate: unchanged credentials/endpoints/defaults/overrides before vs after refresh and restart; concurrent edits survive; suspended durable runs still verify, while actual credential/protocol/selected-runtime changes remain blocked.

### Slice 2 — Models.dev metadata cache
- Implement bounded fixed-host downloader, validation, conditional fetch, provider mapping, cache/fallback.
- Use stored fixture data, not live network, for automated tests.
- Gate: malformed/missing/oversized/unknown fields cannot wipe state, create endpoints, enable unsupported capabilities, or leak private inputs.

### Slice 3 — provider discovery and runtime registration
- Improve existing Anthropic/Copilot/OpenRouter paths first, then OpenAI/Gemini API-key surfaces.
- Implement remaining provider coverage only where documented and verified; publish the coverage matrix.
- Prove newly discovered IDs reach the existing runtime through explicit supported registration, not just picker display.
- Gate: exact IDs, complete pagination, correct auth scope, no accidental entitlement claims; an unseen compatible fixture model works through adapter tests.

### Slice 4 — lifecycle and recommendation policy
- Implement pure deterministic grouping and availability transitions.
- Seed reviewed current recommendation/successor rules; record evidence per rule. Do not derive “best” from output price.
- Gate: no age-only retirement, no disappearance on outages, pinned selections recoverable, models can return after renewed access.

### Slice 5 — seamless UI refresh
- Feed all picker/settings/voice/agent/workflow consumers from shared derived definitions, respecting each surface's capability filters.
- Add compact Recommended / All models / Older grouping inside existing UI.
- Publish catalog changes across windows; retain keyboard focus and selected value while open.
- Gate: new model appears without restart; old active model remains stable; custom three-tier settings remain identical; voice picker excludes unsupported models.

### Slice 6 — integration, rollback, and release
- Run focused tests per slice, then repository typechecks, lint, main/renderer builds, complete regular+isolated suite after rebase/merge with main.
- Verify isolated checkout dependencies and packaging; do not borrow undeclared dependencies from parent node_modules.
- Run disposable-profile end-to-end tests and authorized live listing smoke for available connected providers. List untested provider/auth combinations explicitly.
- Record observed results, provider coverage, and known limitations in a short audit; update regular-updates-check with the maintenance responsibility.
- Gate: all invariants pass; no saved user configuration drift; live-tested vs fixture-tested clearly separated.

## 9. Required regression matrix

| Scenario | Required result |
|---|---|
| New supported model | Appears without reconnect/restart; default unchanged. |
| New model unknown to SDK | Not silently selectable with guessed runtime; flagged for compatibility work. |
| Provider lists image/audio/embedding-only model | Correct task-specific filtering. |
| Catalog says tools/images; runtime disagrees | Runtime restriction wins. |
| OpenRouter alias vs direct provider ID | Exact connection-specific identity preserved. |
| Subscription vs API access | No cross-surface entitlement assumption. |
| One missing model / partial pagination / empty body | Existing lists and defaults remain intact. |
| Repeated complete absence or confirmed shutdown | Selected model remains visible with replacement action; no global rewrite. |
| Omitted-but-runnable pinned alias | Retained; ordinary listing absence cannot declare it retired. |
| Pre-upgrade frozen-run fixture | Resumes after refresh with its original binding inputs; no reapproval or recomputed authorization. |
| Catalog missing or future deprecation date | No premature disabling. |
| Deprecated model still offered and functioning | Metadata alone does not disable it. |
| Rate limit / offline / corrupt cache | Last known good list; truthful refresh result. |
| Concurrent windows/manual refresh/timer | One in-flight request; consistent view; no selection churn. |
| Connection deleted/edited during fetch | Old result discarded, no recreation or credential reset. |
| userDefined3Tier, custom host, local model | Existing list and capabilities preserved. |
| Agent, conversation, workflow, voice, fallback references | Exact stored choices unchanged by discovery/retirement/grouping. |
| Metadata malicious or unexpected endpoint fields | Ignored; no credentials sent to catalog or new host. |
| Missing price | Unknown, never “free”. |
| Refresh during frozen workflow | Unrelated additions/metadata changes do not invalidate its binding; security-relevant changes still do. |
| Unknown Pi selection or mid-session switch | Explicit error/acknowledgement; no silent SDK default or ignored switch. |
| User image overrides / utility models | Overrides and actual mini/summarization selection survive list regrouping. |
| Undo rollout / old cache schema | Original configured models still usable; new cache can be ignored. |

## 10. Rollout and ownership

Use one internal feature gate for the derived catalog view; disabled means existing configured lists and registry. New cache is additive and disposable. Keep refreshed model data separate from user-owned configuration so rollback does not need to restore credentials or rewrite profiles.

The update agent may review catalog/runtime mismatches, deprecations and recommendation policy during existing maintenance. It may propose tested SDK/adapter upgrades. It does not browse for every user refresh, spend tokens generating recommendations at runtime, modify provider setup, or install dependencies automatically.

No new scheduled agent/workflow is created by this plan.

## 11. Landing and verification discipline

This worktree starts from committed main only. Do not import another worktree wholesale or include uncommitted main work. No app restart, private profile migration, commit, push, or implementation has been authorized by this planning request.

When implementation and landing are authorized: inspect latest main and dirty ownership, fetch remote, incorporate current main in this isolated branch, resolve here, rerun checks, and land only the reviewed feature changes into canonical main. Stage explicit paths. Never stash/reset/clean shared work. Keep the feature in bounded commits and report drift at repository thresholds.

## 12. Research references

Primary references inspected September 17, 2026; recheck endpoint contracts while implementing:
- Models.dev public API, provider/model metadata and lifecycle schema: https://github.com/anomalyco/models.dev/blob/dev/README.md
- OpenRouter model metadata: https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties
- OpenRouter account-filtered catalog: https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails
- Anthropic listing: https://platform.claude.com/docs/en/api/models/list
- OpenAI listing: https://developers.openai.com/api/reference/resources/models/methods/list
- Gemini listing and supported generation methods: https://ai.google.dev/api/models

Models.dev is a community-maintained metadata source. No universal catalog certifies Artist OS runtime compatibility, account access, real-world speed, or artistic task quality. The plan intentionally keeps those decisions separate.
