---
name: instagram-growth-snapshot
description: "Use when reading a connected Instagram professional account's Insights, capturing a dated 14-day growth snapshot, comparing growth or decline, or refreshing Artist HQ Social Pulse. Read-only; not for posting, comment replies, or DMs."
metadata:
  version: 1.0.0
  last_verified: 2026-08-28
---

# Instagram Growth Snapshot

Use this skill for manual or weekly read-only Instagram Insights checks. One Social Publisher run handles the full job. Do not create one worker per metric or per post.

## Default Profile Rule

1. Read `sources/printing-press-social/guide.md` directly.
2. From `tools/printing-press-social`, run `node src/social.mjs catalog --live --json`.
3. If the user named an exact Instagram profile, use it.
4. Otherwise, select the **first returned Instagram profile whose `ready` value is true**, preserving catalog order. This deterministic default applies only to this read-only snapshot skill.
5. Never select a logged-out, unverified, wrong-account, or missing session. If no Instagram profile is ready, stop and point to Settings → Instagram.

## Capture

1. Attach the exact saved session with `browser_tool profile instagram <profile>`; never use a generic browser session.
2. Verify the visible Instagram identity against the saved handle or account URL before reading data.
3. Open the professional dashboard / Insights page.
4. Select the last 14 completed days when Instagram offers a custom range. If it does not, use the nearest visible supported range and record its real `windowDays`; never label a different range as 14 days.
5. Capture only values visibly reported by Instagram:
   - current followers
   - follower growth or decline for the selected period
   - accounts reached
   - accounts engaged
   - content interactions
   - profile visits
   - aggregate likes and comments, when visible
6. Do not scan individual posts when aggregate Insights are available. If aggregate likes/comments are unavailable and a post-level fallback is genuinely useful, inspect only posts published inside the reporting window, mark the snapshot partial, and state the limitation.
7. Save the raw observed JSON under `$CRAFT_WORKSPACE_PATH/data/instagram/captures/<YYYY-MM-DD>.json`.

Use this raw capture shape. Missing values are `null`, never zero:

```json
{
  "snapshotDate": "2026-08-28",
  "windowDays": 14,
  "profile": { "profile": "main", "handle": "@artist", "accountUrl": "https://instagram.com/artist" },
  "metrics": {
    "followers": 4200,
    "followerDelta": 37,
    "accountsReached": 1800,
    "accountsEngaged": 240,
    "interactions": 390,
    "profileVisits": 120,
    "likes": 330,
    "comments": 60
  },
  "partial": false,
  "errors": []
}
```

## Finalize

Normalize the capture into an immutable snapshot:

```bash
"${CRAFT_BUN:-bun}" "${CRAFT_GLOBAL_SKILLS_DIR:-$HOME/.agents/skills}/instagram-growth-snapshot/scripts/normalize-snapshot.ts" \
  --capture "$CRAFT_WORKSPACE_PATH/data/instagram/captures/<YYYY-MM-DD>.json" \
  --workspace "$CRAFT_WORKSPACE_PATH"
```

The script writes `data/instagram/snapshots/<YYYY-MM-DD>-insights.json` and returns a `contextPayload`. Write that payload to Workspace Context slug `artist-instagram-snapshot` so Artist HQ Social Pulse updates immediately.

Finish with a short private note: reporting window, follower growth/decline, reach, interactions, and any missing data.

## Failure Rules

- This job is read-only and needs no approval.
- Never publish, reply, DM, follow, edit, or change account settings.
- Never record passwords, cookies, tokens, recovery codes, or 2FA secrets.
- Never fabricate hidden or unavailable metrics.
- Never overwrite a past snapshot. Same-date reruns must stop or use a later capture date after confirming the data is actually newer.
- If the visible account does not match the saved profile, stop without reading analytics.
