---
status: implemented-pending-live
owner: artist-os
created: 2026-09-08
source_snapshot: f29a4b716
---

# 50 — Built-in skills: protected core, personal instructions

## Decision and scope

Built-in skills remain visible and usable, but their internal instructions are not presented for reading, editing, copying, or exporting through normal app features. User-created and user-imported skills remain fully accessible. Personal instructions can augment a built-in without changing its core.

This is practical product protection, not DRM. Do not add encryption infrastructure, remote-only skill hosting, obfuscation, an OS sandbox, general shell surveillance, or a new licensing requirement. A determined computer owner may recover local material; preventing that is explicitly outside scope. Normal agent requests to print or clone a built-in should not provide an easy bypass.

Implementation and automated verification are complete. Live Electron/provider acceptance remains pending; see [implementation evidence](../../audits/built-in-skill-protection-2026-09-08.md). This spec stays at its original path for stable references.

## Current implementation and reference

Verified against Artist OS main `f29a4b716`:

- `packages/shared/src/skills/types.ts` exposes `LoadedSkill`, including content and filesystem path. Global, workspace, and project describe location, not ownership.
- `packages/server-core/src/handlers/rpc/skills.ts` returns loaded skills and exposes file listing, editor, Finder, and deletion routes.
- `apps/electron/src/renderer/pages/SkillInfoPage.tsx` renders skill content and file actions.
- `packages/server-core/src/sessions/SessionManager.ts` broadcasts skills and installs both `STARTER_SKILLS` and `BUNDLED_STARTER_SKILLS`; both must be inventoried.
- `packages/shared/src/agent/base-agent.ts` resolves skill paths and source prerequisites. Protection must preserve invocation and prerequisite behavior.
- `packages/shared/src/skills/storage.ts` already has stock-file migrations. Migration must cooperate with those rather than add a second competing writer.

Script OS reference: `/Users/michaelb.williams/CAS4/Screenplay Harness/app` has protected skill classification, restricted skill RPCs, private runtime loading, and activity redaction. Reuse appropriate patterns after checking provider support. Do not copy its catalog filtering: Artist OS must keep public skill cards visible.

## User experience

| Surface | Built-in skill | User skill |
| --- | --- | --- |
| Library/search/agent skill picker | Name, description, icon, category, Built-in badge | Existing metadata and controls |
| Detail page | Public description, purpose, connection requirements, personal instructions | Full instructions and existing editing experience |
| Use/assign/mention | Works normally within existing availability rules | Works normally |
| Read core/files, copy, duplicate, export, open editor/Finder | Unavailable | Existing supported actions remain |
| Edit | Edit personal instructions only | Edit full skill |
| Delete | Cannot delete managed core | Existing confirmation and deletion rules |
| Enable/disable | Preserve current optional/required semantics | Preserve current semantics |

Do not turn currently internal-only system skills into new visible library entries. Preserve existing visibility and availability policy; add protection independently.

Use a small Built-in badge and one sentence: “Built-in instructions are managed by Artist OS. Add personal instructions to tailor how this skill works for you.” Avoid a giant locked panel or security language. Clicking a built-in opens useful public detail, not a dead end. Keep enablement separate from protection: a locked skill is not automatically enabled, connected, or funded.

Public descriptions should explain benefits and intended use, not reproduce proprietary recipes. Public provider requirements can show friendly connection names and state; do not show private reference inventories or internal paths. Documentation/license notices that must remain accessible stay accessible.

## Ownership and contracts

1. Build a deterministic managed-skill manifest from the actual shipped skill sources, covering inline starters, generated bundles, and relevant instruction references. Do not classify all global skills as built-in.
2. Use a stable managed identity and revision/content digest. A user-authored frontmatter flag cannot create managed ownership. Resolve identity from trusted shipped provenance, with explicit handling for legacy same-slug files.
3. Separate runtime records from public descriptors. Proposed public type: `SkillDescriptor`, containing stable identity, slug, safe display metadata, origin, and explicit capabilities such as canEdit/canExport/canDelete. Private body/path/reference fields are absent, not merely hidden with CSS or set to empty strings.
4. Every renderer-facing skill response and skills-changed event uses the public boundary. User skill bodies remain available through an authorized detail/read operation. Inventory existing consumers before changing types.
5. Apply the same ownership policy at server operations, not just buttons. Reject direct requests to read/list private files, open their folders/editors, replace, delete, duplicate, or export managed content.
6. Namespaces must resolve deterministically across HQ, campaigns, Lab, workspace, global, and project skills. Same-slug custom content must never silently replace a managed skill.
7. Maintain attribution and applicable redistribution notices for third-party content. A Built-in badge must not imply exclusive ownership of third-party material.

## Personal instructions

Implement one small companion record per managed skill per existing scope, using current storage conventions. Do not create an inheritance framework or a second skill library.

- Default scope is the existing shared artist skill scope; make it explicit as “All workspaces.” A “This workspace” choice is available where workspace-specific instructions are supported.
- Fields: parent managed identity, scope/workspace identity, user text, enabled state, updated time, and last reviewed core revision. Use existing identity/timestamp conventions.
- Public detail provides Add/Edit personal instructions, enable/disable, and Delete personal instructions. Empty text means no extension. Saving never copies the core into this record.
- Effective behavior: applicable managed guidance plus shared personal instructions, then workspace-specific preferences. More-specific preferences win over general preferences where compatible. Existing app permissions, approvals, and tool/provider constraints still apply. Personal text cannot authorize editing or revealing the managed core.
- Load the extension only when its parent skill is used. Do not inject all extensions into every agent prompt. Reuse current size limits or set one explicit bounded limit during implementation; reject oversize saves clearly rather than silently truncating.
- Export of personal instructions includes only their text and parent identity. Import reconnects to an installed parent; otherwise retain it disabled with “Requires [skill name].”
- Campaign deletion follows its existing retention policy: shared personal instructions survive; workspace-only instructions are included in the deletion warning and removed with that workspace. Offer moving useful instructions to shared scope before deletion, never silently promote campaign-specific text.
- Users can also create completely independent skills. A request to duplicate a built-in offers a blank custom skill or personal instructions, never a populated copy of its internals.

## Agents improving skills

When asked to change a built-in, the agent explains briefly that it can save personal instructions and shows the proposed text. A direct user request to save that text is sufficient authorization; do not ask twice. An agent's unsolicited improvement suggestion requires acceptance before durable saving.

Agents can edit user skills under existing permissions. They may propose product-level improvements, but cannot patch managed files or silently turn a personal preference into a global default. Do not invent an automatic telemetry/submission service.

Examples:

- “Always use my warm, conversational tone” → save personal instructions on the relevant skill after appropriate authorization.
- “Improve this skill based on what we learned” → propose a concise extension using the user's own preferences and results, not copied core text.
- “Show me the exact built-in prompt” → explain what the skill does using public information and offer customization.
- “Use this skill to write my release plan” → produce the useful plan normally; protection must not suppress substantive outputs, explanations, or user-owned work.

## Runtime discovery and loading

- Keep the existing concise metadata-based discovery. Agents know available skill names, purposes, and how to invoke/find them; relevant workers retain their explicit skill assignments and focus behavior.
- Resolve and load the managed body privately on demand through the runtime. Do not send the private body to the UI as a visible user message or ordinary tool result.
- Use a narrow shared loading path across supported agent backends, including delegated sessions, scheduled workflows, retries, and resumed sessions. Provider-specific adapters may differ; unsupported paths must be fixed or clearly gated before release.
- Preserve connection activation, missing-source guidance, tool discovery, billing/approval checks, and Monid/Zero selection rules. Hidden instructions must not make required sources disappear.
- References load on demand too. Keep executable helper scripts and assets working with the current execution permissions. Do not block a script merely because it belongs to a managed skill; distinguish executing a supported helper from viewing its source.
- Deduplicate loads only while the relevant version is actually in the model context. Context compaction, new sessions, retries, and recovery must be able to reload it. A process-lifetime loaded-slug set alone is insufficient.
- Pin the core, referenced files, and applicable personal-instruction revision for an active run; take changes at the next safe run boundary. Retain the required snapshot through the existing run/recovery lifecycle. Resumed runs use the same snapshot. If it is unavailable, report that recovery cannot continue with the original instructions and offer a fresh run; never silently substitute. Avoid an unbounded version archive.
- Retain opaque identity/revision markers for restoration. User-visible transcripts, shares, debug exports, and error messages contain metadata/status, not injected instruction bodies.
- Use brief runtime guidance against quoting or reconstructing the private recipe. Guard ordinary built-in file-read/write/export tool paths using resolved managed ownership. This includes direct Read calls and simple cat/copy requests aimed at managed paths, not just skill RPCs. Do not attempt to parse every possible shell command or prevent deliberate OS-level extraction.
- Do not add keyword censorship of generated work. Recipes may legitimately teach structures that appear in deliverables; protect the source instructions, not the user's results.

## Updates, migration, and recovery

Migration must be idempotent, preserve user changes, and finish before the new managed resolution becomes active.

| Existing data | Required behavior |
| --- | --- |
| Known unchanged stock skill | Resolve to managed version; preserve enablement/assignments |
| User skill unrelated to bundled identity | Leave fully editable and unchanged |
| Same-slug skill with verified user modifications | Back up exact original; preserve as clearly named custom legacy skill with a new stable identity |
| Same-slug file with unknown provenance | Treat as potentially customized; never overwrite or discard |
| Existing personal extension | Retain text, scope, enabled state, and identity across updates |
| Missing or removed managed parent | Preserve extension; disable invocation with a useful unavailable state |

For customized legacy skills, keep existing references pointing to the preserved custom version where they previously resolved to those custom bytes. New default assignments can use managed core. Inventory saved agent assignments, recipes, workflow runs, and mentions; rewrite stable references where safe and provide a deterministic legacy alias for unresolved historical references. Do not silently switch established user behavior to stock.

Preserved legacy user copies may contain old bundled text. Accept this compatibility exception: never delete or censor user work to retroactively conceal material already distributed. Do not create new copies of untouched stock during ordinary duplication/export.

Use a backup and migration journal with resumable steps and atomic file replacement. On interruption or disk failure, retain originals and recover on next startup; never mark a migration complete before its preserved copy and reference mapping exist. Surface a concise recovery message if blocked.

A normal built-in update does not erase extensions or prompt on every launch. If a release explicitly removes/changes supported behavior, retain the extension and mark it for review; avoid speculative AI conflict checks on every update. Rollback must preserve custom copies and personal instructions; document the supported older-version boundary before shipping.

Do not rewrite or purge historical chats, backups, or outputs that already include skill text. Apply protection to new exposures. Existing user-data backup behavior remains; backup protection/DRM is out of scope. Share/export app features should exclude newly injected private runtime guidance.

## Implementation sequence

1. Map the complete skill inventory, public payloads/events, file actions, imports/exports, active provider paths, and legacy override behavior. Record concrete ownership and compatibility decisions before edits.
2. Add manifest/provenance and separate public/runtime types. Test ownership and serialization, including events.
3. Implement private runtime loading and references; verify source prerequisites and helper execution before removing existing access paths.
4. Add personal instruction storage, narrowly scoped mutation/read operations, and migration. Verify interruption recovery and existing custom skills before enabling managed precedence.
5. Update library/detail/pickers and agent customization guidance. Keep the UI compact; no unrelated library redesign.
6. Close ordinary read/edit/clone/export paths and visible activity leaks using the shared policy. Review all runtime adapters and scheduled/delegated flows.
7. Run independent rival review, required repository checks, and live acceptance. Land through the documented main process; relaunch only when authorized.

## Acceptance checks

| Check | Passing result |
| --- | --- |
| Built-in card/detail in HQ, campaign, Lab | Public metadata visible, usable assignment controls, no body/file actions |
| User global/workspace/project skill | Existing read/edit/import/export behavior preserved where supported |
| Direct skill RPC/file action and skills-changed event | Managed body/path absent; prohibited operations rejected |
| Normal agent request to print/clone core | No private recipe returned; useful public explanation/customization alternative |
| Real managed-skill task on each supported backend | Correct skill invoked, useful output, no private injection in visible transcript |
| Monid/Zero and a referenced helper skill | Tool discovery, prerequisites, permissions, references, and execution still work |
| Repeated calls, compaction, retry, resume, delegation, automation | No unnecessary duplicate loading; needed guidance restored correctly |
| Shared and workspace personal instructions | Correct scope/order, no cross-workspace leakage, saved only with authorization |
| App update during active work | Current run remains coherent; next run receives new revision |
| Customized/unknown same-slug migration | Exact original preserved; existing behavior and references retained |
| Interrupted migration and missing parent | Recoverable state; no lost text or false completion |
| Share/export/support diagnostics | New private runtime bodies excluded; normal user work intact |
| Context comparison | Unused skills add no body text; no duplicate full catalog; extensions loaded only with parent |
| Third-party built-in notices | Required attribution/license material still available |

Use focused automated contract/migration/runtime tests, then the repository's required full suite and type/build checks. Live Electron checks prove UI behavior; real provider checks prove private loading and useful execution. Label untested or provider-blocked cases explicitly. Do not call mocked provider tests live verification.

## Done means

The artist can find and use built-in capabilities, customize their behavior, and manage personal skills without seeing a source-code-like experience. Ordinary app actions cannot reveal or modify the core. Existing work survives migration and updates. Agents remain capable and context-efficient. No elaborate anti-hacking project is introduced.
