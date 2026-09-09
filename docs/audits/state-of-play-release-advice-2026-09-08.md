# State of Play: campaign release advice

Date: 2026-09-08

## Scope

Second slice: derive imminent-release advice from each campaign's Release Kit,
instead of pairing an arbitrary HQ calendar event with global Vault inventory.

The manager checks upcoming campaign release dates within fourteen days. Missing
or unreadable inventory prompts review; positive file counts do not certify an
entire release as ready. Plans are not treated as a mandatory media asset.
Recommendations identify the campaign and use a campaign-specific intent so
unrelated releases do not share recommendation state. Existing approval/failure
priority is preserved.

The route remains a manager review in HQ, with the exact campaign supplied in
the instruction. This slice does not add a direct campaign-navigation button or
change automatic execution permissions.

## Verification

- Composer regression tests: 38 passed, covering unrelated HQ dates, global
  Vault versus campaign inventory, multiple releases, local-day boundaries,
  missing/malformed/partial inventory, optional Plans, and distinct intents.
- Real snapshot integration: 3 passed, including adding approved files to a
  campaign and removing its inventory warning while HQ Vault remains empty.
- Full discovery suite: 8,881 passed, 0 failed, 10 skipped. Nine product-specific
  private-skill cases run separately in the isolated groups; the optional
  installed CUA-driver contract remains skipped.
- All 27 isolated groups: 371 passed, 0 failed, 0 skipped.
- Shared and server-core typechecks passed. Artist OS main-process build passed.
- Independent logic review clear. Exact workspace identity remains in the
  existing launch instruction for reliable retrieval, not in card labels.
- Tests used temporary profiles under the real-profile OS write fence.

No app restart or live/provider verification is included in this slice.
