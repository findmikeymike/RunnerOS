# TikTok scheduled publishing — September 17, 2026

## Live result

The user authorized restarts and publishing the saved Homebody “goose post” exactly once.

- Account: `tiktok/earthtomikey`
- Asset: Release Kit `kit_e60168bc-b70f-4069-9948-90e6ace15114`, `homebody-goose-video.mp4`
- Caption: `boop`
- Published URL: https://www.tiktok.com/@earthtomikey/video/7686704360977419533
- TikTok initially showed “Content under review”; the separate public profile subsequently displayed the video.
- No second publication was attempted.

The scheduler uploaded the exact video and filled the exact caption automatically. TikTok's editing tutorial intercepted the automated Post click. The assistant dismissed it and completed the authorized final click. The real receipt was then recorded on `scheduled-work-tiktok-goose-caption-test-20260917`, preserving its original failed attempt and adding an explicitly assisted verification run. After restart, Calendar visibly showed Done and the correct Open post link.

**This proves an assisted live publication, not a fully unattended live run of the final patch.**

## Implemented fixes

- Wait for asynchronously mounted/enabled page controls after navigation.
- Preserve selected-file evidence when TikTok unmounts its upload input; verify the actual uploaded filename and platform upload state.
- Fill contenteditable captions using selection, native deletion, and text insertion rather than assigning an irrelevant `value` property.
- Dismiss only the observed editing tutorial and optional automatic-checks invitation; do not enable optional checks.
- Check the actual click target for obstruction before attempting Post.
- Recognize Studio's new matching video link after submission, using a pre-upload list of existing links and the approved account/caption to reject old or ambiguous receipts.
- Report platform review honestly in the receipt summary.
- Allow replacements after a single known pre-submit failure; preserve duplicate protection for uncertain submissions, multiple prior runs, and actual receipts.
- Retain Settings verification in the exact persisted account partition and keep scheduled browsers hidden until the user opens them.

## Validation

- 93 focused tests passed across browser CDP, page scripts, social executor, saved connection observations, composer, conflict guard, and Composio guidance.
- Electron typecheck passed.
- Artist OS main build passed; canonical app restarted with final code and existing profile.
- `git diff --check` passed.
- Changes remain uncommitted.

## Remaining verification boundary

The final tutorial/receipt changes have regression coverage but were added after the single authorized post. A further unattended real publication requires a separately authorized post; do not repost this video to prove the fix. Other platforms were not live-posted during this task.
