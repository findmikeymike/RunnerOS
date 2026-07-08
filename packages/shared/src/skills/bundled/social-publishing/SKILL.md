---
name: social-publishing
description: "Use when operating social publishing workflows for Instagram, TikTok, X, or YouTube: cross-posting campaigns, posting videos/images/text, replying/commenting, sending DMs, checking channel readiness, or preparing browser-executed social posts through RunnerOS. Built for the @social-publisher agent and Printing Press Social CLI."
tags: [social, publishing, instagram, tiktok, x, youtube]
metadata:
  version: 1.0.0
  last_verified: 2026-05-26
---

# Social Publishing

Use this skill to run social channel work through RunnerOS with the bundled Printing Press Social CLI and `browser_tool`. If the user asks to use an already-open Chrome browser/profile/tab, use the global `chrome-cdp` skill instead of launching a fresh browser surface.

## Core Flow

1. Read `sources/printing-press-social/guide.md` when available.
2. Run `node src/social.mjs doctor --json` from `tools/printing-press-social`.
3. If a campaign/release/client folder is involved, list candidate media with `node src/social.mjs assets --asset-root <dir> --platform <platform> --json` and copy with `node src/social.mjs content --content-root <dir> --json`.
4. For post/comment/DM, run the exact CLI action with `--asset-root`, `--content-root`, relative file names, and `--dry-run --json`.
5. Validate the payload against the platform checklist below.
6. Ask for explicit approval before any live publish/send action.
7. Save the full dry-run result JSON and run `node src/social.mjs execute --action-file <dry-run-result.json> --expected-action-id <act_...> --confirm yes --json`.
8. Execute through Runner `browser_tool` using the returned `RUNNER_CDP_DELEGATED` handoff and browser plan.
9. Treat `browserPlan.accountVerification` as mandatory: verify the visible logged-in account/channel matches the expected handle or account URL before submit. If `verificationTargetKnown` is false, stop and add a profile `--handle` or `--account-url`.
   - For profile readiness checks, use `accountVerification.identityProbe`, then pass only non-secret observed identity back with `profile status <platform> --profile <id> --live --verification-result <json-file> --json`.
10. Return a receipt with platform, profile, action, payload summary, media path, target, account verification evidence, timestamp, and observed result.

## Existing Chrome Sessions

Use `chrome-cdp` when the user explicitly wants the agent to inspect or operate a page already open in Chrome, such as a logged-in social profile, a preloaded draft, or a browser window they are actively using.

- First list open tabs and select the matching target.
- If Chrome is not reachable, tell the user to enable remote debugging from `chrome://inspect/#remote-debugging`.
- Use CDP for inspection, screenshots, snapshots, navigation, typing, clicking, and evidence capture.
- Keep the approval gate exactly the same: no live publish/send/comment/DM/upload/schedule action without explicit approval of the final details.
- Prefer Runner `browser_tool` for normal fresh sessions; prefer `chrome-cdp` only for existing Chrome context.

## Profile Sessions

Explain this model when the user is setting up social publishing or seems confused:

- Each platform/profile should have its own saved browser session, such as `tiktok/main`, `instagram/brand`, or `youtube/client-a`.
- Users should log in once per profile. The saved browser session keeps cookies/login state so they do not retype passwords every run.
- Passwords, recovery codes, tokens, cookies, and 2FA secrets must never be written into Workspace Context, memory, source guides, or chat prompts.
- Workspace Context should store only non-secret defaults: profile IDs, handles, account URLs, tone, posting defaults, and account notes.
- Before live work, run `node src/social.mjs doctor --live --json` and verify the visible logged-in account matches the profile handle or account URL.
- If a session expires, pause and guide the user through logging in again for that specific profile.

Use profile-specific commands:

```bash
node src/social.mjs post tiktok --profile client-a --dry-run --json
node src/social.mjs post instagram --profile brand --dry-run --json
node src/social.mjs post youtube --profile main --dry-run --json
```

If the user asks "how does this work?", answer briefly: "You create named profiles once, log each profile in once, then the agent reuses those local browser sessions. Context stores which profile to use and how to write; secrets stay out of prompts."

## Agent Shape

Use one execution agent for all platforms: `@social-publisher`.

Do not split posting into one agent per platform by default. Keep platform differences in the playbook. Use other agents only for separate roles, such as writing, creative review, research, or asset generation.

## Approval Gate

Never perform these without approval of exact details:

- publish, schedule, upload, comment, reply, DM
- delete, edit after publish, follow/unfollow, block/report
- credential entry, account switch, billing/payment, age-gated or sensitive submission

Approval must name the platform, profile, target URL or recipient when relevant, final copy, media path, visibility, and whether it is live now or draft/scheduled.

CLI safety behavior:

- New Printing Press Social profiles default to `require-confirm`.
- The `smoke` profile is dry-run only; never use it for live actions.
- After explicit user approval, pass `--confirm yes` only for the exact approved live action. Do not use `--autorun` for write actions.
- Reuse a stable `--idempotency-key` for retried live actions so the CLI can dedupe accidental repeats.
- Use `--asset-root` and `--content-root` so receipts and dry-runs preserve exact source folders and resolved files.
- When using `runner-cdp`, `social execute` validates the approved dry-run result and returns a Runner browser handoff. Prior chat approval plus the matching `--expected-action-id` is the final approval. The agent should submit without asking again when the visible account and draft match approval; stop only on mismatch, ambiguity, unexpected platform choices, or upload/UI failure.

## Universal Payload Rules

- Prefer vertical 9:16 video for short-form reuse across TikTok, Instagram Reels, and YouTube Shorts.
- Keep key text and subject matter away from top/bottom UI chrome; center-safe compositions survive more platforms.
- Use native-feeling captions: clear hook first, then context, then CTA only if useful.
- Avoid external links in primary post copy unless the user specifically wants traffic over reach.
- Validate rights for music, clips, images, likenesses, and brand assets before upload.
- If platform guidance matters to performance or compliance, refresh research before high-stakes publishing.

## Platform Detail

Load `references/platform-playbooks.md` only when you need platform-specific requirements or posting heuristics.

Use these quick defaults:

- TikTok: vertical video, fast first frame, native caption, minimal hashtags.
- Instagram: Reels for vertical video; carousel/feed when visuals matter more than video discovery.
- X: concise text, one clear point, avoid mixing too many media types; attach up to four images or one video.
- YouTube: Shorts for square/vertical videos up to 3 minutes; long-form for 16:9 depth.

## Receipt Format

Return:

```text
Status: posted | drafted | blocked | needs-user
Platform:
Profile:
Action:
Target:
Copy:
Media:
Visibility:
Observed result:
URL or evidence:
Timestamp:
```
