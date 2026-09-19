# Instagram and TikTok manual pre-publish walkthrough

Date: September 17, 2026 (America/Chicago). Started 22:34:14 local / September 18 03:34:14 UTC.

## Scope and result

User requested manual operation in the connected Artist OS browsers, log/console observation, and documentation. Explicit boundary: stop before the final publish click.

**Both platforms reached enabled final publish controls. Neither Instagram Share nor TikTok Post was clicked during this walkthrough. No scheduler jobs were started.** This proves a manual pre-submit path, not unattended publishing, publication success, or receipt recovery.

The existing connected sessions were reused. No app restart, connection reset, code change, commit, or push occurred. Drafts remain open in their browser instances; they were not explicitly saved or discarded.

## Test input

- Video: `/Users/michaelb.williams/.artist-os/workspaces/homebody/release-kit/video/master/homebody-goose-video.mp4`
- Size: 1,068,639 bytes; approximately seven seconds.
- SHA256: `77799afd281404903849fe1670834c3ab971714d2a02fedbbd3b47bec4905367`
- Caption: `boop`
- Instagram: `@findmikeymike`; saved profile ID `MikeyMike`; browser/partition `social-instagram-MikeyMike` / `persist:social-instagram-MikeyMike`.
- TikTok: `@earthtomikey`; browser/partition `social-tiktok-earthtomikey` / `persist:social-tiktok-earthtomikey`.

## Instagram: fresh upload

| Stage | Manual action | Observed result |
| --- | --- | --- |
| Connected account | Settings → Connections → Social Accounts → Instagram → Open | Existing authenticated session opened Instagram home. |
| Create | New post → Post → Select from computer | Native file picker opened. |
| File selection | Go to Folder, enter exact video path, select Open | Goose video entered the editor. |
| First-upload notice | Dismiss “Video posts are now shared as reels” with OK | Informational gate cleared; crop screen appeared. |
| Crop | Inspect preview; Next | Edit screen with cover thumbnails, trim timeline, and sound control. |
| Edit | Next | Final New reel screen appeared. |
| Caption | Enter `boop` | Accessibility value `boop`; counter `4/2,200`. |
| Destinations | Inspect Share to | Facebook / Mike Williams / Public was enabled by default. |
| Limit this draft to Instagram | Toggle Facebook off; choose “Don’t share this reel” | Facebook switch off. “Stop sharing all reels” was not selected; account-wide default unchanged. |
| Final verification | Inspect enabled Share; switch away/back; manually pop browser out for wider view | Draft persisted. Share visibly unobstructed in wider browser; caption still `boop`; Facebook off. **Stopped.** |

An “Unable to play media” accessibility message appeared transiently during editing. Cover frames and the goose preview rendered; the message subsequently disappeared. Playback progress was not conclusively verified. Do not treat preview rendering as proof that playback or server-side processing completed.

The Add AI label switch remained off; authorship/label requirements were not evaluated or changed in this test. Location and collaborators remained blank.

## TikTok: restored unfinished upload

| Stage | Manual action | Observed result |
| --- | --- | --- |
| Connected account | Open TikTok through Settings | Authenticated home; profile link identified `@earthtomikey`. |
| Upload | Select Upload | Studio opened `/tiktokstudio/upload?from=webapp&tab=video`. |
| Recovery prompt | “A video you were editing wasn’t saved. Continue editing?” → Continue | Earlier unfinished goose-video draft restored. Nothing discarded. |
| Media verification | Inspect filename, size, preview | `homebody-goose-video.mp4`, 480P, Uploaded (1.06MB), approximately seven seconds, correct goose cover. |
| Caption | Replace filename-derived caption with `boop` | `4 / 4000`; preview text included `Mikey boop`. |
| Final settings | Scroll to publish controls | Now selected; Everyone visibility; high-quality uploads on; music copyright check and content check lite off. |
| Final verification | Inspect Post | Pink Post button enabled and visibly unobstructed. **Stopped.** |

This was **not a fresh TikTok upload**: an earlier unfinished draft was restored. Replace was initially disabled. No Save draft, Discard, Post, privacy change, or check-enabling action was performed.

First-run editing tutorials and optional-check invitations did not appear during this walkthrough; earlier work had dismissed them. Their cold-profile handling is not re-proven here.

Native accessibility focus on the TikTok caption initially failed to focus the editor. A screenshot-grounded click inside the description followed by select-all/type succeeded; the resulting caption and character counter were verified. Automation must verify the edited field rather than assume a keyboard operation reached its target.

## Log and console observations

Source: `/tmp/tiktok-final-app.log`, beginning after line 2408 (walkthrough start). This is the running Artist OS output, including browser-pane console events. Counts below are a captured sample through approximately 03:39 UTC, counting `[main]` browser-console entries only; duplicate forwarded renderer entries were excluded.

- Instagram: four console entries: two unrecognized `attribution-reporting` Permissions-Policy messages, one `unload` policy violation, one react-spring v9 deprecation.
- TikTok: 89 console entries, including player `Forbidden` / `NETWORK_FORBIDDEN`, performance-measure DOMExceptions, WebAudio and player-engine diagnostics, and a “get long to short file params timeout” warning.
- Representative timing: Instagram browser created at 03:34:41.903 with `show=false`, manual ownership, and its persisted partition; navigated at 03:34:42.729. TikTok player warnings appeared around 03:37:33; cover/performance warnings around 03:37:56–57.

Both editors reached final controls despite these console messages. The messages alone do not establish a publish failure or prove they are harmless. Network response bodies/status traces were not captured. Raw logs are not copied into this document because they may contain signed media URLs and unrelated session data.

## Concrete automation gaps exposed

1. **Instagram first-upload Reels notice:** current executor does not explicitly handle this gate before Crop → Edit → New reel. Exactly two Next clicks were observed after dismissing the notice; stage recognition is still needed.
2. **Instagram default Facebook cross-posting:** the browser can silently include an unselected destination. The executor needs to inspect and enforce the scheduled destination without changing account-wide preferences.
3. **TikTok unfinished-draft recovery:** recognize Continue/Discard and establish that a recovered draft matches the intended media. Never discard or overwrite unrelated existing work automatically.
4. **Browser viewport:** the narrow Artist OS sidecar clipped Instagram’s final Share control and portions of the form. Accessibility presence does not guarantee a clickable on-screen target. The wider manually popped-out browser exposed Share clearly. Automated background runs need adequate viewport sizing and target hit-testing without requiring a visible popup.
5. **Stage and field verification:** verify media readiness, caption value, selected destinations, and the final control after each stage. A successful input/click call alone is insufficient.

## Remaining acceptance work

- Implement and regression-test the above platform-specific handling.
- Exercise a fresh TikTok upload, restored-draft matching/conflict behavior, and Instagram onboarding/default-sharing variants through the actual executor.
- Repeat a pre-publish-only automation pass with adequate background viewport sizing.
- Separately verify real scheduled publication and receipts under explicit publication authorization, including ambiguous outcomes and duplicate prevention. This walkthrough does not authorize or perform that step.

The earlier assisted TikTok live-publication test is a separate event documented in `tiktok-scheduled-publish-2026-09-17.md`; it must not be counted as a publication or unattended success from this walkthrough.

## Follow-up implementation

Implemented after the walkthrough, without restarting or touching the open drafts:

- Instagram dismisses the scoped Reels notice and advances by observed Crop/Edit headings until the final caption screen, with a bounded timeout.
- Instagram disables Facebook for this reel only, handles the confirmation, and verifies the switch is off. Missing/ambiguous destination controls do not silently pass; an account without a Facebook section can proceed when the final composer is present.
- TikTok handles Continue on the observed recovery prompt, checks exact filename and matching/default caption, then uses Replace so the existing upload path reattaches the host-verified bytes. Different drafts are preserved with an actionable message. Disabled Replace is awaited, never forced.
- Background browser preparation requests at least 1280×900 without showing/focusing the window. Visible/docked sessions are preserved rather than taken over.
- An existing hidden in-memory draft is detected before navigating away for a receipt baseline. The user must finish/save it before retrying; it is not erased automatically.
- Instagram final submit supports semantic role buttons as well as native buttons.

Verification: 40 focused executor/composer/page-readiness tests passed; 97 browser-manager tests passed. Cases cover per-reel versus global Facebook settings, unknown stages, ambiguous destinations, unrelated recovered drafts, delayed/permanently disabled Replace, caption readback, and no submit when destination verification fails. These are automated fixtures, not a fresh live executor pass. The open Instagram/TikTok drafts and previous no-publication boundary remain unchanged.
