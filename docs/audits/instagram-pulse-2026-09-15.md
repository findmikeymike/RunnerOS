# Instagram Pulse — September 15, 2026

## Implemented

- HQ manual/weekly Instagram refresh uses a native, bounded reader of the saved account's Account Insights page. It no longer depends on model-led catalog/script discovery or a historical-month navigation hunt.
- Verify the visible account identity and reporting window; wait for stable exact counts, including delayed zero activity. Capture followers, views, interactions, engaged accounts and profile visits when actually available. Never relabel Viewers as Reach or Profile activity as Profile visits.
- Save immutable same-day snapshots, publish Workspace Context, and notify the mounted HQ widget automatically. Missing optional metrics remain unknown and are hidden in details.
- Reject duplicate Instagram refreshes independently of Spotify. Both retain separate sessions and saved browser profiles. Cancellation fences publication and retains browser ownership while pending work drains.
- Display current Views when no actual growth measurement exists. Both platform history readers now accept immutable UUID filenames and order captures by date and capture time.

## Live evidence

Canonical main checkout, Artist OS build, existing `.artist-os` profile and durable host enabled. No accounts reconnected or data cleared.

Before fix, manual Instagram sessions stalled on live catalog/script access and dashboard navigation. Both stalled runs were stopped through their normal Stop controls.

After rebuild:

- `260915-coral-otter`: Instagram completed in **5,321 ms**. HQ updated without navigation/reload; details showed 800 Views, 18 Engaged, 19 Interactions, 275 Profile visits, actual 30-day window. Saved followers: 10,814, matching the visible account page.
- `260915-misty-tiger`: repeat Instagram completed in **4,551 ms**, retaining the prior snapshot.
- `260915-fresh-dove`: Spotify completed in **11,862 ms**, overlapping the repeat Instagram run (Instagram approximately 21:42:47.872–52.423 UTC; Spotify 21:42:49.142–21:43:01.004 UTC).
- Browser partitions: `social-instagram-MikeyMike` and `social-spotify-spotify-main`. Real connected accounts remained available after restart. A second restart retained the newly populated Instagram widget (followers and 800 Views).

## Verification boundary

45 focused tests passed, including real SessionManager collection/publication without model calls, duplicate rejection and independent cross-platform admission. Server/shared/Electron typechecks and canonical production build passed. The full regression run passed 58 of 59 processes; its sole failed shard contained two obsolete static UI expectations. Those were updated for conditional metrics/Views and the entire affected shard passed on rerun. No remaining regression failures. Live provider evidence covers this connected English-language professional Instagram account; provider layout/permission changes fail safely rather than inventing numbers. No synthetic history or account changes were made.

Spotify fixes committed separately as `610655764`. Instagram changes are included in the subsequent native Insights fix commit. No release publication is claimed.
