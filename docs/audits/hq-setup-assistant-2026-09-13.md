# HQ setup assistant integration — 2026-09-13

Canonical Artist OS main integration: domain cards and on-demand General routing,
secure model/tool/social setup guidance and tools, field-specific Brain saves,
Network/Community imports with duplicate and consent preservation, and Vault/media/
face-reference help. Existing custom helper definitions are preserved by exact-stock
migrations. Campaign-specific helper behavior remains future work.

The user reports the assistant smoke test is working well. This is not a claim that
all providers, payment flows or external publishing paths have been certified.
Targeted assistant checks, Electron typecheck and Artist OS builds passed.

## Spotify surface correction

Artists, Web Player and Ads previously used the same browser-window ID. Settings
and the setup tool now give each surface a separate navigation target while retaining
the same account's persistent browser partition. Verification rejects a page from
another surface. A user-profile link without confirmed login is not saved as the
signed-in identity. Eleven browser tests and five assistant-adapter tests pass.
This correction was built after the user's smoke test; live acceptance is pending.

## Open: actual login loss across app restarts

The user reports having to sign into Instagram and one Spotify surface again after
relaunch. This is distinct from a stale Settings badge and from surface-window
interference. The canonical launch uses the existing ~/.artist-os profile; no template
was restored or account storage intentionally cleared. Persistent cookie databases
exist. An isolated synthetic persistent-cookie restart probe retained the cookie both
with and without an explicit flush, so missing flush is not a proven root cause.

Next: with restart authorization, compare redacted session metadata before and after
one controlled normal quit/reopen, then verify the same exact account and surface.
Do not export cookie values, alter expirations, clear sessions or mark the issue fixed
based only on a historical verification badge.

## Development launch note

For the current saved workflow recovery data, also set CRAFT_DURABLE_READ_HOST=1
alongside CRAFT_PRODUCT_VARIANT=artist-os, CRAFT_CONFIG_DIR=$HOME/.artist-os and
the canonical bundled-assets root. Launch the canonical compiled Electron app;
do not substitute a packaged release or the separate development profile.

### Controlled restart observation

After the user performed a normal Cmd+Q, the shutdown log confirmed normal cleanup.
Before quit and after quit: Instagram 13 cookies, Spotify 84, TikTok 61; no cookie
records removed. After reopening the same canonical profile, all cookie metadata
matched the post-quit snapshot exactly. Saved verification observations also survived
(Instagram/TikTok verified; Spotify Artists and Web Player verified, Ads unverified).
Only cookie metadata was inspected; no cookie values were exported. This rules out
wholesale storage clearing in this restart, but does not prove the sites accept the
saved authentication. Live site acceptance remains to be checked without re-login.

The user then opened Instagram and Spotify without signing in again and confirmed
both were already signed in. This controlled restart passes login persistence.
The earlier intermittent report is not explained conclusively; no speculative cookie
storage fix was applied. Reproduce with the exact failing surface if it recurs.
