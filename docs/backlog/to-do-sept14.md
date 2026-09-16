---
status: active-planning
owner: unassigned
created: 2026-09-14
last_verified: 2026-09-14
baseline_commit: 3e137b57c
---

# TO DO — SEPTEMBER 14

Final product work, agent-role decisions, and acceptance tracking for Artist OS. Michael's original request is preserved verbatim below. This document records requested work; it does not authorize implementation of every proposal, external publishing, or a public release.

Use this as the working checklist for this finishing pass. The [main backlog](./TO-DO.md) remains the broader queue; existing linked specs retain their authority. Assign an owner when starting a slice. Mark completion only with the implementation commit and relevant live evidence. Update the existing item rather than creating competing checklists.

## Baseline: what is already on main

Canonical checkout: `.worktrees/main/artist-os`, branch `main`. At creation, main is clean and synchronized with origin at `3e137b57c`.

- Integrated: HQ Assistant domain skills, General mode, foundational worker placement, model/service/social connection fixes, social receipt handling, scheduled-work reliability, release/updater code, campaign onboarding fixes, Canvas fixes, Vault usability and internal agent access, lyrics runtime/progress, Vault deletion, and explicit queue/Edit/Remove/Steer controls.
- Live evidence exists for the recent user-tested HQ Assistant paths, connection setup, a controlled Instagram/Spotify persistence restart, campaign onboarding, Canvas, Vault/lyrics/deletion, and chat queue/steering. This does not certify every provider, recovery path, or feature.
- Breakthrough guidance is already broader than voice: shared Artist OS mission and Manager guidance (`c5774390c`), then tailored Ads Strategist, Ad Runner, Content Genius, and Scriptwriter guidance (`b8ec7f588`). Broader behavioral acceptance and additional role coverage remain below.
- Old social/scheduling/steering/Vault worktrees retain source changes after selective integration. Do not merge those trees wholesale again. A different commit hash alone does not prove work is missing.

## Working order (recommendation, not a locked schedule)

1. Audit Outputs, agent boundaries, and current breakthrough behavior before changing roles or adding skills.
2. Resolve ownership between Manager, HQ Assistant, Campaign Assistant, and a proposed builder agent; then implement small slices.
3. Complete the identified live acceptance gaps alongside those slices.
4. Finish packaging and public release proof after product changes stabilize. Keep the named V2 work parked.

## 1. Breakthrough mentality and companion skill

- [ ] **NOW — Verify the existing guidance in fresh chats.** Check Manager text/voice, Ads Strategist, Ad Runner, Content Genius, and Scriptwriter. Use artist-specific prompts plus ordinary execution requests. Confirm imaginative judgment without abandoning established channels, reopening approved work, or manufacturing novelty.
- [ ] **NEXT — Audit additional strategic/creative agents.** Especially World Builder and Ad Creative: decide where a short role-specific emphasis improves the shared mission. Check actual slugs, composed prompts, scope, and existing skills before adding anything.
- [ ] **NEXT — Define an optional “Break Artist” Manager focus/skill.** The shared mentality remains present in General and ordinary work. Invoking the focus should support deeper opportunity discussion using artist truth, interests, communities, relationships, distribution, technology, and the team's capabilities. It must not force a fixed idea count, a mandatory experiment, or the same deliverable every time.
- [ ] **WAITING FOR INPUT — Capture Michael's additional companion skill.** Preserve the intent now: agents should recognize their ability to research, build, coordinate, and execute across tools as an advantage in a changing music landscape. Obtain the actual skill/material before inventing its detailed method. Then compare it with the existing mission, creative-attention skills, research, and proposed Break Artist focus; reuse or combine where appropriate.
- [ ] **NEXT — Keep context lean.** Small shared mission, narrow role emphasis, deeper domain material loaded on demand. Separate sourced current observations from hypotheses. Freshness and source dates matter; do not replace evidence with claims of being “cutting edge.”

Acceptance: ideas connect specifically to the artist and feasible team capabilities; routine work still gets done; existing budgets, permissions, and approval boundaries remain intact. Record prompt-injection evidence separately from whether the resulting conversation is actually useful.

Current implementation: [team guidance](../../packages/shared/src/agent-prompt/artist-team-guidance.ts), [prompt composition](../../packages/shared/src/agent-prompt/compose.ts), [Manager voice prompt](../../apps/electron/src/renderer/lib/artist-manager-voice-focus-prompt.ts).

## 2. Outputs: clarify what happens next

**September 15 agreed contract:** An Output is a usable result worth reviewing, reusing, or handing off, including complete drafts and developed options. Scratch work, fragments, test renders, logs, and throwaway variations do not qualify. Final means the artist chose the exact version as finished and ready for use; it sets no timing and grants no distribution permission. Final media should make Schedule the clear next available action, with explicit destination/content/timing and existing approval checks.

**User observation:** opening an Output exposes too many controls and makes the next action unclear. Entry points, agent routing, and the role of “Make final” are questions to investigate, not confirmed architectural defects.

- [ ] **NOW — Map the actual Output lifecycle.** Identify every entry/view path: top-bar Outputs, originating chat, Canvas, campaign surfaces, and any other existing routes. Trace creation, review, revision, final promotion, downstream consumption, and receipts.
- [ ] **NOW — Establish current handoff behavior.** Do agents already discover/reference Outputs? When are Outputs routed automatically, delegated explicitly, or merely saved? Does “Make final” affect visibility, approval, eligibility for use, or only organization? Answer from code and live examples.
- [ ] **NEXT — Simplify the detail view around user intent.** Propose a clear primary action appropriate to the Output's state; put secondary controls behind progressive disclosure. Make the creator, purpose, status, and next destination understandable without implementation jargon.
- [ ] **NEXT — Make handoffs and use visible.** Where supported, show who is using an Output, what it feeds, and what requires the artist's input. If a real gap exists, design a bounded routing change rather than broadcasting every Output to every agent.
- [ ] **NEXT — Smoke representative Output types.** A strategy document, script, generated asset, and workflow result should have understandable next steps and preserve versions/provenance. Final promotion must not imply permission to publish externally.

Acceptance: an artist can open an Output, understand why it exists, choose a sensible next action, and see what happened afterward without navigating a wall of buttons.

## 3. Command agents and division of responsibility

- [ ] **LATER — Shared work across HQ/Campaign entry points (parked September 15).** Starting Website, X Editorial, Social Publisher, Ads, or another shared worker from either space must preserve context and coordinate work targeting the same site/account/resource. This is a cross-domain follow-up, not part of the current Outputs or roster fixes. [Backlog scope and acceptance](../creator-command-center/todo/45-hq-campaign-scope-clarity-spec.md#september-15--parked-extension-shared-destinations-and-concurrent-workers).

- [x] **Ownership audit completed September 15.** Manager retains strategy, delegation and everyday scheduling; Assistant retains setup; Builder owns reusable agent/workflow/automation construction and maintenance. Existing tool gaps and startup reattachment are documented in the [audit](../audits/builder-agent-2026-09-15.md). Audit completion does not imply implementation.
- [x] **Builder specified September 15; implemented and development-tested September 16.** [Spec 52 — Builder Agent](../creator-command-center/todo/52-builder-agent-spec.md) defines Agents/Workflows/Automations focuses, tool ownership, safe automation maintenance, evidence-led reuse, and a minimal development-profile transition. No production-version migration framework.
- [x] **Builder implementation and bounded live acceptance complete.** `5a98c0a58` + `3d8cdc250`: real agent/workflow creation and revision, timed and file-triggered execution, same-ID automation maintenance, Manager scheduling/input supply, Campaign handoff, restored approvals, correct links and automatically refreshed Active work. Full suite: 60/60 processes; canonical build passed. Existing profile/connections preserved. [Evidence and limits](../audits/builder-agent-2026-09-15.md#final-loaded-build-verification). Physical voice and external trigger-provider certification remain untested; no packaged-release claim.
- [x] **Builder uses evidence and existing capabilities first.** Its role and on-demand creator recipes require catalog inspection, reuse/customization and dated evidence for capability gaps. Live fixture creation inspected the catalog first. Imported material grants no authority; automatic opportunity scanning remains outside this slice.
- [x] **Builder location and handoff defined and implemented.** Foundational HQ/Campaign worker with optional Agents/Workflows/Automations focuses; Manager/Assistant route construction there and General retains discovery/delegation. Campaign creator shortcut verified as a scoped, unsent Builder draft; voice routing covered automatically, not through a physical mic session.

Acceptance: “help me build a capability for this opportunity” reaches the right worker, checks what exists, produces a reviewable result, and explains how to use it. Naming and tool boundaries are specified in Spec 52; automatic suggestion cadence is outside this slice.

## 4. Artist Manager: fewer, clearer focuses

- [ ] **NOW — Inventory current cards, skills, and routing.** Distinguish visible focus choices from the larger skill inventory; fewer cards must not remove useful on-demand capabilities.
- [ ] **NEXT — Consolidate overlapping cards into meaningful umbrellas.** Consider replacing task-specific helper cards such as “make content” with a clearer “Find the right worker” focus. Final labels and grouping require review of the current roster.
- [ ] **NEXT — Add the optional Break Artist focus from item 1.** Make strategic opportunity development a first-class conversation while keeping the mission present in normal Manager chat.
- [ ] **NEXT — Preserve natural coordination.** General can still discover and involve specialists without requiring a focus click. Reduce repeated context requests and make handoff outcomes visible.

Acceptance: fewer understandable options, clear Manager ownership, and no regression in natural delegation or established release work.

## 5. Branding and World Builder: audit scope and context

**User observations to reproduce:** overlapping world-building work; unclear career branding versus campaign-specific branding; and overly prescriptive rules for typography, colors, or video execution that may unnecessarily narrow other specialists.

- [ ] **NOW — Audit both agents' prompts, focus cards, skills, and saved context.** Identify exact overlaps and where directives are produced or injected downstream. Separate artist-approved canon from agent suggestions and accidental hard rules.
- [ ] **NOW — Clarify HQ versus Campaign ownership.** Compare: HQ-only Branding with campaign application; distinct scoped variants of one agent; or combining Branding and World Builder. Do not decide to merge or remove either before mapping their real responsibilities.
- [ ] **NEXT — Center Branding on identity and meaningful signals.** Focus on core artist truth, perspective, positioning, associations, recognizable character, and useful canon. Leave detailed visual execution to the appropriate specialist unless the artist specifically requests or approves it.
- [ ] **NEXT — Prevent suggestions becoming universal restrictions.** A recommended color, type treatment, or video approach should not silently become binding canon. Preserve explicitly approved brand decisions and their scope; distinguish lasting identity from campaign exploration.
- [ ] **NEXT — Check downstream effects.** Brand guidance should help Content, Scriptwriter, Ads, and visual agents make distinctive work, rather than force identical aesthetics or repeated world-building interviews.

Acceptance: users understand which worker owns which decision, HQ truth is not overwritten by a campaign experiment, and creative specialists retain room to do their jobs. A combined agent remains an option, not an approved implementation choice.

## 6. Campaign Assistant

- [ ] **NEXT — Define the campaign-scoped counterpart to the HQ Assistant.** Help bring in Release Kit assets, understand/fill Essentials, and turn approved planning into Calendar work.
- [ ] **NEXT — Ground it in saved campaign state and real tools.** Reuse existing setup/assistant infrastructure where appropriate, but use campaign-specific context, cards, and write targets. Do not imply capabilities that are not wired.
- [ ] **NEXT — Keep ownership clear.** The Campaign Assistant helps operate the app and assemble the campaign; Manager retains strategic judgment and specialist coordination. Avoid repeatedly collecting HQ facts.
- [ ] **NEXT — Smoke the full path.** Starting with an incomplete campaign, guide the user through missing materials, reflect changes in Release Kit/Essentials, and create only the intended Calendar work. Test unavailable tools and a changed campaign selection.

Status: planned work, not a completed commit awaiting integration.

## 7. HQ Assistant: voice setup

- [ ] **NEXT — Audit and add voice-setup guidance/tools as needed.** Walk users through Inworld account creation, locating/creating an API key, saving it through the app's credential flow, choosing a voice ID, personality, and suitable model.
- [ ] **NEXT — Verify current provider requirements when implementing.** Pricing, account steps, voice availability, and model recommendations can change. Do not freeze assumptions into the prompt.
- [ ] **NEXT — Keep secrets out of chat and prove settings synchronization.** Use existing secure entry surfaces. The assistant should distinguish configuring a value from verifying that voice playback/conversation actually works.
- [ ] **NEXT — Smoke new and existing connections.** Confirm selected voice/personality/model persist and match the actual conversational agent. Keep text/creative model preferences distinct from low-latency voice choices.

## 8. Live acceptance and reliability finishing pass

These are checks of integrated capabilities unless a test identifies a missing implementation. Use disposable fixtures for destructive tests and explicit authorization for actual publishing or paid actions.

- [ ] **NEXT — Calendar/Scheduled Work:** HQ and Campaign creation, agent/workflow execution, timing, restart recovery, retry, cancellation, and approval/Needs You handling; no duplicate work after recovery. Keep broader recurring-job expansion deferred.
- [ ] **NEXT — Social publishing:** TryPost/Postiz and browser routes, correct account/media, receipt identity, ambiguous outcomes, and failed receipt storage. Verify uncertain publication is not blindly retried. Login verification alone is not publish acceptance.
- [ ] **NEXT — Campaign cleanup:** disposable campaign only; verify intended campaign data removal and preservation of global context and retained assets.
- [ ] **NEXT — Broader Assistant workflows:** model/tool/social/Spotify setup, People/Network and Community imports, Brain/profile, Vault/face-reference guidance, plus workflows, Outputs, Calendar, recovery, and unavailable capabilities. Record which paths already passed rather than rerunning everything indiscriminately.
- [ ] **NEXT — Connection persistence:** extend the successful controlled restart to the exact surfaces that previously failed, including distinct Spotify surfaces and account switching. Preserve saved logins and settings; do not “fix” this by cloning/replacing profiles each launch.
- [ ] **NEXT — Chat transcript ordering:** inspect the remaining observation that a dequeued user message can appear before the preceding assistant answer, despite correct next-turn execution. Verify visually and after reload before classifying or changing it.
- [ ] **NEXT — Finish related acceptance gaps deliberately:** Branding focus behavior, managed skills in real provider sessions, and any relevant Signals/Spotify intelligence or board/PDF routes not covered by the recent smoke. Consult the broader backlog rather than calling the whole app certified.
  - **September 15 — Spotify Pulse:** native three-page refresh, core/enrichment publication, automatic widget updates, and saved-profile restart/repeat verified live (13.8s / 12.1s); five songs/cities/countries retained. Full regression suite passed. Weekly tick remains unexercised. [Evidence](../audits/spotify-pulse-2026-09-15.md).
- [ ] **NEXT — Reconcile stale tracking notes.** Update old “pending smoke/integration” claims with exact completed evidence; distinguish committed code, loaded build, live acceptance, and release certification. Preserve V2 boundaries.

References: [social outcomes](../audits/social-outcomes-main-integration-2026-09-13.md), [scheduling/steering](../audits/scheduling-steering-main-integration-2026-09-13.md), [HQ Assistant/persistence](../audits/hq-setup-assistant-2026-09-13.md), [explicit steering](../audits/explicit-chat-steering-2026-09-14.md), [external integration proof](./external-integration-live-verification.md).

## 9. Public release setup

- [ ] **NEXT — Configure public HTTPS update distribution.** Select the feed, set `ARTIST_OS_UPDATE_URL`, and verify anonymous manifest/artifact access. Release/updater code is already on main.
- [ ] **LATER — Complete signed/notarized packaging and clean-machine proof.** Verify intended build provenance, both supported Mac architectures, production licensing/entitlement readiness, and existing release gates.
- [ ] **LATER — Test real upgrades preserving user data.** HQ/campaign content, model/tool credentials, voice settings, and browser sessions must survive. Exercise interrupted/failed updates and recovery before public distribution.

Follow the existing [distribution checklist](./artist-os-update-distribution.md) and [V1 release-readiness plan](./artist-os-v1-release-readiness.md); this tracker does not replace their detailed gates or approve publishing a release.

## 10. V2 — explicitly parked

- [ ] **DEFERRED — Profile enrichment hardening.** Keep the V2 UI/service/context behavior parked. Preserve the simple current mode and inert old research files. Do not disable legitimate Deep Research features elsewhere as a shortcut.
- [ ] **DEFERRED — Conversational background-work proposals.** Preserve their specs/worktrees without silently broadening V1 behavior.

## 11. Durable Workflows — finish remaining coverage

Reference commit supplied by Michael: `93cf5ddfa` — `Freeze certified skill instructions for durable read workflows`. Its presence on main was verified when adding this item. This is the cited checkpoint, not a claim that no later workflow commits exist.

Reported checkpoint: two certified Branding skills preserve instructions, references, and personal preferences across workflow restarts, covering compatible read-only workers. Broader Branding modes and connected-account actions remain. The original checkpoint preserved unrelated Settings edits and did not restart the app.

- [ ] **NEXT — Reconcile the checkpoint with current code and tests.** Identify the two certified skills and exact supported worker/runtime boundaries. Record what was proven versus what still needs live acceptance.
- [ ] **NEXT — Extend certification to broader Branding modes.** Preserve the selected skill instructions, reference material, and personal preferences across suspend/resume, restart, and retry. Coordinate with the Branding scope audit above rather than freezing obsolete instructions into new runs.
- [ ] **NEXT — Complete connected-account workflow actions.** Verify correct account binding, credentials at execution time, approval handling, durable receipts, and safe recovery from interrupted or uncertain external actions. A read-only restart pass does not certify side effects or exactly-once execution.
- [ ] **NEXT — Smoke the supported paths in the current app.** Record the loaded build, restart behavior, recovered context, and any unsupported workers. Preserve unrelated changes and saved user data.

## 12. Git privacy — safe migration to a private repository

Michael wants a new private repository and eventual closure of the current public one. This is a migration planning item, not authorization to delete or change repository visibility now. Privacy reduces future exposure; it cannot retract copies or forks that already exist.

- [ ] **NOW — Inventory everything that must survive.** Canonical main, branches/tags, unfinished worktrees, uncommitted work, Git LFS objects, release assets, workflow configuration, issues/PRs where needed, and integrations tied to the current repository. Separate repository content from local HQ/campaign data, credentials, and browser sessions; never upload those private runtime stores as part of a Git migration.
- [ ] **NEXT — Create an independently recoverable backup and the new private repository.** Confirm ownership, visibility, access, and recovery before changing the working checkout's origin. Copy and verify the required history and artifacts without deleting the public source.
- [ ] **NEXT — Prove completeness from a fresh clone.** Compare refs/commit IDs, retrieve required LFS objects and artifacts, install/build the intended current Artist OS revision, and launch/smoke that exact version. Confirm the existing user profile, model connections, and browser sessions remain intact through the chosen launch path.
- [ ] **NEXT — Repoint and verify dependent systems.** Check CI, release/signing workflows, collaborators, documentation, licensing/deployment dependencies, and updater references. Keep the public update distribution path accessible to users even if source code becomes private. Preserve rollback to the current repository until migration evidence is complete.
- [ ] **BLOCKED ON VERIFIED MIGRATION + EXPLICIT APPROVAL — Retire the public repository.** Decide whether “close” means make private, archive, or delete; archiving alone does not hide source. Do not remove or disable the old repository until the new one is proven complete, the current app launches successfully, recovery is demonstrated, and Michael approves the exact final action.

Acceptance: a fresh private clone contains all intended work and produces the current working app; repository-dependent services still function; backup/rollback is available; no unfinished branch or local user data is lost.

## 13. iOS, Apple signing, and licensing — finish existing work

- [ ] **NOW — Locate and reconcile what is already started.** Record the actual iOS scope, repos/branches, Apple application/team identifiers, signing setup, and licensing implementation. Do not assume iOS support or a finished iOS app from this request.
- [ ] **NEXT — Finish the agreed iOS work and its device/distribution acceptance.** Define the remaining slice from existing plans, including relevant authentication, entitlement, and update behavior.
- [ ] **NEXT — Complete Apple signing/distribution setup.** Track iOS provisioning/distribution separately from macOS signing/notarization. Reuse the existing release checklist; prove the intended app identities and artifacts before distribution.
- [ ] **NEXT — Finish licensing readiness.** Reconcile existing purchase, activation, seat management, refund/revocation, production configuration, and upgrade behavior. Separate already-proven test-mode flows from production acceptance and platform-specific decisions.

References: [V1 release readiness](./artist-os-v1-release-readiness.md), [licensing plan](../licensing/artist-os-lemon-squeezy-release-plan.md). This work must be coordinated with item 9 rather than duplicated.

## 14. Google Auth — production Gmail connection

- [ ] **NEXT — Finish the real application OAuth setup/verification.** Reconcile the existing Google project, consent configuration, requested scopes, domains/redirects, policy pages, verification submission, and any outstanding review requirements.
- [ ] **NEXT — Prove the easy user connection path.** A user should connect Gmail through the app's normal sign-in flow without creating their own Google Cloud project. Test consent, cancellation, correct-account selection, refresh, revocation, reconnect, and Settings status.
- [ ] **NEXT — Record production readiness honestly.** Verify the requirements applicable to the actual scopes when implementing; distinguish development/test-user access from approval for real users.

Source: [Google OAuth Production App](./google-oauth-production-app.md).

## 15. System Update — complete the existing-user experience

This expands item 9's release infrastructure work into the actual customer experience; updater code is already integrated.

- [ ] **NEXT — Audit the whole update flow.** Discovering a release, explaining what changed, checking manually, downloading, installation/restart, and communicating success or failure should be understandable and accessible.
- [ ] **NEXT — Complete update reliability and data-preservation proof.** Upgrade a representative older install to the intended version; verify HQ/campaign data, files, models, credentials, browser sessions, and licensing survive. Exercise network failure, interrupted downloads, failed installation, and the supported recovery path.
- [ ] **NEXT — Coordinate private-source migration with public updates.** End users must not need access to a private Git repository or a developer token to receive app updates. Confirm manifest/artifact availability after repository changes.

Acceptance and artifact gates remain in the [update distribution checklist](./artist-os-update-distribution.md). Do not mark “finished” based only on an updater API or preflight passing.

## 16. Potential addition — user announcements and offers

**IDEA / NOT YET COMMITTED TO V1:** a founder/admin surface for sending users announcements, interacting with them, and offering additional products or services.

- [ ] **LATER — Clarify the first useful outcome and channel.** Compare in-app announcements, release notes, feedback/replies, and optional promotional offers. Decide whether a small existing surface can meet the need before adding a full page or messaging system.
- [ ] **LATER — Define the administration and user experience.** Who can publish, which users see a message, how messages expire, and whether replies are supported. Separate operational update notices from marketing and provide appropriate dismiss/preferences controls.
- [ ] **LATER — Scope commerce only if selected.** Decide what is being sold and connect to existing licensing/billing where appropriate. Do not assume a new checkout or broadcast system is required.

## September 14 additions — original message preserved

```text
Add:

Durable Workflows finish:
last Commit was `93cf5ddfa`.
Two certified branding skills now preserve their instructions, references, and personal preferences across workflow restarts. This covers compatible read-only workers. Next up.... Broader Branding modes and connected-account actions remain next. Unrelated Settings edits preserved; app not restarted.

Git Privacy:
SAFELY move app to new git set to private and close this public one so apps arent stolen or forked from others. needs to be done as safe as fucking possible. shouldnt get rid of this one/public until absolutely fucking clear new repo has everything and app luanches at current version etc

Ios and apple signing and licensing:
Finish whats started

Google Auth:
Finish application for gmail real app oath for easy connection for users

System Update:
Make sure fully finished and easy way to update new versions of app for exisiting users

Potential Add:
A page that lets me kinda send alerts to users, or somehow interact with, sell more stuff to them, 
```

## Completion record

For each completed slice, append: item number, owner, decision, commit, loaded build, automated checks, live smoke, and remaining limits. No new product implementation is claimed by creation of this document.

### September 15 — Item 2: Output usefulness, Final meaning, and scheduling handoff

- Owner: Codex. Committed as `f0329c20a` on canonical `main`; not pushed.
- Shared agent instructions and tool descriptions define an Output as a usable result worth reviewing, reusing, or handing off, with explicit exclusions for scratch work. This is agent guidance, not a semantic classifier guaranteeing every artifact meets the threshold.
- Final means the exact version is finished and ready for use. Shared instructions, serialized Release Kit context, and UI explanations keep approval of finished form separate from scheduling, sending, and publication.
- Finished image/video Outputs expose a prominent **Schedule Final** action. Campaigns resolve the exact ready Release Kit snapshot and ask when multiple versions exist. HQ chooses a campaign and explicitly approves the exact file into its Release Kit if needed. Existing scheduling/account/rights/approval checks remain authoritative; promotion itself creates no schedule.
- Removed the misleading universal social-post shortcut for documents/audio/drafts. Those artifacts remain available for ordinary use and agent handoff.
- Natural-language requests use available connected publishing capabilities in the appropriate campaign. The general agent Calendar tool still does not create native social-post jobs, and delegation does not grant access to another campaign; the shared guidance names those limits and the Release Kit UI route.
- Verification: focused contract and UI-helper checks, shared/session-tool/Electron typechecks, and a production renderer build in a temporary directory. Independent code review found no remaining blocking issue. Full-suite findings exposed two older registration test fixtures missing the existing HQ model-setup handler; corrected the fixtures without changing product behavior. All six discovery shards and 53 isolated test processes passed, including reruns of the two affected shards after those fixture fixes.
- Subsequent authorized build/launch: canonical Artist OS built at `f0329c20a`, verified matching main/preload/renderer stamps, and launched against the existing profile with durable recovery enabled. Real provider scheduling and visual acceptance of that slice remained open. No push or external publishing action.


### September 15 — Item 2: Shared Outputs library and preview

- Owner: Codex. Implemented on canonical `main` after `f0329c20a`; **uncommitted**.
- HQ and Campaign sidebars open their own Outputs. The toolbar opens one shared library across permitted local workspaces, with search, workspace filter, and Finals filter. Remote work remains scoped to its connected workspace.
- Orange banner retained. Rows show type, owner, available agent/workflow identity, and review/Final state. Automatic session boards are hidden from the library without deleting them; their existing links show readable cards.
- Selection opens a wide, closable side preview while retaining the library. Exact owner travels with the link. Primary actions are Make Final/Schedule Final and Continue with agent; other actions and technical details use progressive disclosure.
- Copied Release Kit snapshots contribute Final status without being converted into mutable pointers. Scheduling resolves the exact snapshot and switches to its campaign. Final still does not authorize timing or distribution.
- Verification: Electron typecheck; 70 focused route, boundary, Final, and preview-helper tests; Artist OS production renderer build to a temporary directory. Headless Chrome with disposable fixtures passed scope isolation, duplicate IDs, formatted preview, row switching, close/search persistence, Escape/expand, and exact-Final campaign handoff. No external services were called.
- Release readiness: real-profile Electron visual acceptance and provider scheduling remain unverified for this redesign. The running app and its data were preserved; no restart, commit, push, or publication for this slice.


---

## Michael's original request — verbatim

```text
can we make a list of prior things you said plus these and then make a new TO DO SEPT14 type doc where we can track some of final work for app:



- **Campaign Assistant:** the campaign-specific counterpart we discussed—Release Kit assets, Essentials, and planning onto Calendar. This is planned work, not a finished commit waiting to merge.
- **More live testing:** scheduling/restart recovery, social publishing receipts and failure handling, campaign cleanup using disposable data, and broader Assistant workflows.
- **Public release setup:** update-feed URL, signing/notarization, and upgrade tests preserving user data. Release/updater code is already integrated.
- **V2 stays parked:** profile enrichment hardening and conversational background-work proposals.



and



Outputs upgrade/work:

when u click the outputs page, and open an output from list created, tons of buttons and shit and daunting looking, very confusing what a user should “do”.. also do our outputs just appear in the outputs page via the topbar outputs icon or is their another entry/view path? do outputs get routed to other agents or just kinda exist in outputs page and then stay there unless someone hits the “make final” button--



Command Agents:

-i think we make a seperate agent for building new agents and skills and workflows, knows to look at intel and recent intel/signals collected to be able to suggest new skill/agent/workflow, knows what agents exist and where there may be gaps that could help artist careers, get the “your job is to help agent break” bit of system prompt.. as this is more app function and shouldnt live in artist manager.. artist manager already covering so much scope



Agents:

-Artist manager: we should probably combine few of skills into more umbrella so not so many options when you open, and also create special skill for Break Artist that makes it a focus of its job/role.. as users can cue individual workers for content etc. like maybe we fold "make content" type helper skill cards into a thing more like "Find right worker" --(still should be able to invoke anybody it wants etc)



Branding Agent:

-i think we have bit of overlap of the branding and world builder, like maybe theres a world build skill in branding that make it try to redo world builderes job or overlap? also it seems fuzzy that branding agent is kinda for branding you as a whole/career in one of skills even when in campgain specific mode so your kinda wondering if cleaner seperation and seperation of context. like should it just live in HQ, or campaign agetn skill/prompt barnding agent be bit differnt then HQ one, augemnted version of agent bit like our Conciegre/setup/assistant agent.. i also notice branding trys to define hard rules for like text style and video rules and step outside its scope. it should be more focused on the core canons of someone Brand/signals etc and less like "we should use burnt auburn in videos. this exact text"-- if we think about real objective of app and agents, this type nuance and rules created for other agents is narrowing and really has nothing to do with if an artist "breaks through"-- so we should probably audit its skills and prompt to just make better all around or if smarter, combine branding and world builder into one unit/worker



Conceirge agent (HQ)

-should help with voice agent setup too, how to sign up and get key from inwrold, choose voice id, choose a personality, right model to run etc



New agent/skill

I have another great skill that is companion to Break Artist creative ethos skill/idea.. we really want focus of apps and agents is to realize they are agentic and have an edge in this sense and focus on current landscape, evolving industry and possibilites to really help aritst break through the noise/saturation of modern music realms



please add all these. feel free to word better, keep my message thou, u can expand if u have intelligent add ons etc
```


### September 15 — Campaign default-worker regression

- Found the missing workers were installed and readable, but absent from saved activation manifests. Earlier registration cleanup removed implicit UI activation without carrying the curated campaign roster into new-workspace defaults; the Outputs changes did not delete agents.
- Restored missing curated campaign workers in Homebody and turkey through the existing activation helper. Checked explicit deactivations (none), backed up both manifests under `/tmp/artist-os-roster-backup-*`, and preserved all prior active workers. Confirmed Art Director, Video Director, Video Editor Agent, Social Publisher and other restored cards in the live app.
- New-campaign initialization now unions the curated roster with existing campaign defaults, deduplicated to 26 agents. Existing workspace choices and HQ/Lab defaults stay unchanged. No blanket startup reactivation.
- Verification: 147 registration/storage/worker-default/startup-preservation tests passed; independent registration/worker-default rerun passed 15 tests. Future-creation code is covered by the subsequent canonical build and regression checks; new-campaign creation itself has not been live-tested. Existing campaign repairs are already saved and visible. No prompts, connections or sessions were replaced.
