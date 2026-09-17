# Artist Direction and Creative Direction

Status: implemented in the working tree; startup and scoped UI smoke verified; not yet committed or provider-behavior accepted.

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
- Working-tree implementation remains uncommitted. Creative strategy quality and Campaign brief-save behavior remain separate acceptance work.
