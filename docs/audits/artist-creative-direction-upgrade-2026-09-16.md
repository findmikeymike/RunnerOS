# Artist Direction and Creative Direction

Status: implementation committed in `fc91256fd`; startup and scoped UI smoke verified. Bounded HQ response and live Campaign proposed-brief save/retrieval acceptance passed September 18. This does not certify production execution or acceptance of the proposed creative idea.

## Agreed behavior

- Stable `branding-agent` identity, history and configuration. Artist HQ presents **Artist Direction**; Campaigns present **Creative Direction**. Lab/general retain Artist Direction.
- HQ explores enduring artist identity, ethos, convictions, tensions, expression and audience recognition.
- Campaigns connect established artist identity with this release: who feels seen, what the artist stands for, a strongest campaign idea or committed act, emotionally meaningful words/images/behaviors, and the best placements across the release.
- World Builder develops an optional concrete experience from the chosen direction. No duplicate identity exercise or mandatory lore, mystery, enemy, archetype, ritual or website.
- Production specialists retain craft judgment. Typography/colors are supporting choices, not the default creative strategy.

## Implementation

- Scoped catalog, launch, delegation, scheduling, workflow and capability resolution; raw global definitions remain the source for editors.
- Narrow stock-only migration with backup. Custom body, skill inventory or focus changes are preserved, not forcibly upgraded; runtime/model/permission settings and saved history remain intact.
- New `release-creative-direction` skill; updated World Immersion and four supporting skills, including referenced guides. Exact historical bundles migrate safely; personal files survive.
- Campaign Creative Direction and World Builder borrow authoritative HQ identity in place. Private, disabled and restricted routing remains enforced; ambiguous HQ never chooses an artist arbitrarily.
- `save_release_creative_brief` persists `campaign-creative-direction` in the current Campaign only. It requires Creative Direction identity, normal write permission, proposed/accepted status and an exact current-body conflict check. Saving does not approve production or distribution.
- Release board starts with Creative Direction; Fan Experience is optional. Existing item IDs, completed work and linked chats survive.
- Existing stock focus identifiers have explicit aliases; unknown/custom identifiers do not silently change meaning.

## Acceptance and limits

Automated coverage includes real frontmatter round-trips, HQ/Campaign projection and reverse projection, stock/custom migrations, context access, concurrent-save protection, runtime launch, legacy focus/delegation receipts, and bundled-skill parity.

Final verification:
- 578 focused tests pass across 33 files, including composed production prompts, legacy delegation aliases and saved release-board work.
- Full repository typecheck passes.
- Artist OS main and renderer builds pass.
- Changed Electron files lint with zero errors (three existing hook warnings). The full Electron lint still reports two pre-existing shadow-style errors in unchanged `SignalsTracksPanel.tsx` and other existing warnings.
- An independent runtime review prompted fixes for old focus aliases and focused production brief delivery; both have regression coverage.
- Bundled skills regenerated and required local skill catalog rebuilt.

The renderer build first exposed a missing browser-safe package export; it was fixed and the final renderer build passed.

Live relaunch authorized and completed September 16 using the rebuilt canonical Electron app and existing ~/.artist-os profile. HQ Workers shows Artist Direction; Homebody Workers shows Creative Direction and updated World Builder. Opening Creative Direction succeeds with General, Find the Big Idea, Who Will Feel This?, Signals & Moments, and Release Creative Brief. Existing Outputs and conversations remain visible. No model message was sent in this smoke; creative response quality and live brief-save/handoff behavior remain unverified. This is not public release certification.

## Branding adoption and supporting context

- Artist Direction can submit exact before/after DNA changes and supporting documents with `propose_branding_update`. Suggestions remain pending until the artist clicks Apply to Branding; creating or marking an Output final does not adopt it as identity.
- Brain → Branding displays reviewable suggestions and dated supporting documents with preview, close, add/import, and remove controls. Removal excludes the attachment from future context; original Outputs remain intact.
- HQ DNA remains authoritative across HQ and Campaigns. Relevant active attachments supplement it, favoring newer material when similarly relevant. A compact index avoids injecting all document bodies into every prompt; full active documents remain available on demand. Pending suggestions and removed documents are excluded.
- Approval preserves surrounding custom prose, unknown JSON fields, untouched DNA fields, and newer privacy/routing metadata. Revision checks reject stale approvals; interrupted approved writes recover safely.
- Final repository typecheck and main, preload, renderer builds pass. The final focused rerun passes 25 tests / 99 assertions; separate isolated approval checks also pass. Earlier focused suites additionally cover routing, context access, migrations, and trusted drafting. This is not a claim that every repository test was rerun.
- Live verification September 16: real Artist Direction session `260916-tall-wren` created one supporting-only QA proposal in Approval Mode. Brain → Branding showed it pending; Apply added it, preview and Close worked, and X removed it. Core DNA remained unchanged. The disposable attachment is no longer active. No real DNA edit was applied during live testing; core-edit preservation is covered by fixtures.
- Live testing exposed a stale preload bridge after building only main/renderer. Rebuilding preload and reloading resolved the page crash; all three build components are now current. App remains open on Branding with the existing profile.
- The implementation above was committed in `fc91256fd`. Campaign brief-save behavior remains separate acceptance work.

## September 18: bounded HQ response acceptance

Live Artist Direction session `260918-lively-falls`, using `deepseek-v4-pro` in Approval Mode, received a read-only request for one grounded expression and a Campaign/World Builder handoff. No external research, delegation, saving, scheduling, or publishing was requested or observed.

- Used existing HQ bio, audience, themes, and reaction-hook context without starting another identity interview.
- Recommended a direct-line/voicemail expression grounded in the artist's previous public phone-number activity. Explicitly marked current number availability, willingness, and time/spam costs as assumptions.
- Supplied a concrete Campaign handoff and kept World Builder optional until there is an experience worth developing.
- Quality limitation: this develops a known artist behavior; it is not evidence of consistently novel breakthrough strategy. Any actual fan-voicemail production would still need permission from the people featured.

Homebody Creative Direction session `260918-aware-shoal` then passed a read-only context-inheritance check with the same model. It read campaign material, distinguished HQ identity from release facts and assumptions, acknowledged it had not heard the audio, and proposed a release-specific hotline/chorus concept. Its World Builder handoff called out budget, moderation, fan-voice consent, and a simpler route that skips World Builder. The UI reported three read steps and explicitly stated nothing was saved or delegated.

No branding or campaign brief was changed. Next acceptance slice: live proposed brief persistence and actual World Builder consumption; the chat-only handoff above does not establish either. Social posting acceptance remains parked separately.

## September 18: live proposed-brief handoff

Following authorization to continue, Creative Direction session `260918-aware-shoal` read the existing context and saved a new `campaign-creative-direction` document with `save_release_creative_brief`, `status: proposed`, and `expectedBody: null`. The ordinary one-time write approval was allowed; persistent permission settings were not changed. The saved file was independently read at `~/.artist-os/workspaces/homebody/context/campaign-creative-direction/CONTEXT.md` and contains `Direction status: proposed`, assumptions, consent/budget/moderation questions, and the simpler route that skips World Builder.

A fresh World Builder session, `260918-bright-plain`, was asked to retrieve the brief without being told its idea. Its sole recorded tool call was `get_workspace_context` for `campaign-creative-direction` with `maxChars: 12000`. It correctly identified "Opt out loud" and the Homebody Hotline, recognized the proposal was not accepted, retained unresolved decisions, and described the optional simpler route. No downstream execution or write was observed.

This passes bounded live persistence and cross-worker retrieval. The proposed brief remains saved in Homebody for review; the test does not accept its idea or approve production. HQ identity was not edited. No app restart, publication, external service activation, or new schedule occurred. Actual production execution and social posting acceptance remain separate work.
