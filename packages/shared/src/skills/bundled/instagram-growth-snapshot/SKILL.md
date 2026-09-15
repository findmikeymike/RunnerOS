---
name: instagram-growth-snapshot
description: "Read a connected Instagram professional account's current Insights and refresh Artist HQ Social Pulse. Read-only; not for posting, replies, DMs, or ads."
metadata:
  version: 1.1.0
  last_verified: 2026-09-15
---

# Instagram Growth Snapshot

## Artist HQ manual and weekly Pulse

Artist HQ's manual refresh and weekly automation use the native collector. The host attaches the saved Instagram profile, verifies the account identity, reads its own-account Insights at `https://www.instagram.com/accounts/insights/?timeframe=30`, saves a unique dated snapshot, and publishes `artist-instagram-snapshot` automatically. Do not launch another browser collection or write duplicate context for that run.

Capture the current visible reporting window and exact visible followers, views, interactions, accounts engaged, and profile visits. Include reach or follower change only when actually shown. Record the real window; the URL's requested 30 days is not proof of the displayed range. Missing means unknown/null, never zero. Zero is valid only when Instagram displays zero.

No follower-history search, post-by-post collection, ads, range hunting, chart estimates, private endpoints, or network inspection. Save useful partial results; briefly state missing metrics. Never relabel an old snapshot as a successful new refresh.

## Ad hoc agent fallback

Use one bounded read-only run, at most 120 seconds including save time:

1. Use the injected `printing-press-social` source context. From its exact absolute **Local path**, run `node src/social.mjs catalog --json` once. Do not guess a checkout or read private source/skill files. Use the explicitly requested saved Instagram profile; otherwise require one unambiguous saved Instagram profile. If missing or ambiguous, stop with the specific connection/profile issue.
2. Attach `browser_tool profile instagram <profile> --foreground`. Verify the visible signed-in identity against the saved handle/account URL before reading Insights. Never use a generic browser or a different account. Stop on login, identity mismatch, or access restrictions.
3. Open the direct own-account Insights URL above. Read only the displayed current window and metrics. If blank, foreground the attached browser and retry loading once. If still unavailable, stop. Do not browse around for history or substitute public profile counts.
4. **Write** the raw JSON capture inside the exact absolute `dataFolderPath` injected in `<session_state>`. Use a new filename each run. Keep the shape below; copy only observed values.
5. Normalize with the skill's `scripts/normalize-snapshot.ts` helper only through an available, documented safe script-execution tool. If the runtime exposes `run_skill_script`, follow its actual schema and pass the absolute session capture path and current workspace path (`--capture`, `--workspace`); omit `--out` for a unique immutable snapshot. Do not invent this tool, read/copy private helper source, invoke guessed private paths, or change permissions. If no supported helper is available, retain the session capture and explain that Artist HQ's native Refresh is needed to save the Pulse snapshot.
6. Successful native Pulse publication is handled by the host. For an ad hoc run, only claim the widget updated after publication is confirmed; a saved capture alone is not a published snapshot. End with the actual reporting window, key observed metrics, and any missing data.

Raw capture shape (example numbers are placeholders, not defaults):

```json
{
  "snapshotDate": "2026-09-15",
  "windowDays": 30,
  "profile": { "profile": "main", "handle": "@artist", "accountUrl": "https://www.instagram.com/artist/" },
  "metrics": {
    "followers": 4200,
    "views": 12000,
    "interactions": 390,
    "accountsEngaged": 240,
    "profileVisits": null,
    "accountsReached": null,
    "followerDelta": null
  },
  "partial": true,
  "errors": ["Profile visits, reach and follower change were not visible"]
}
```

## Boundaries

Read-only collection needs no publishing approval. Never publish, reply, DM, follow, edit account settings, record secrets, or overwrite previous snapshots. Same-day reruns use new UUID filenames with the true capture date. If no metric is observable, report the failure and preserve the previous Pulse.
