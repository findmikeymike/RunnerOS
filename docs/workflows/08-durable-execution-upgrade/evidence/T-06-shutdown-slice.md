# Small Electron shutdown slice

2026-09-09 · included in this commit.

The Electron host factory now registers pending construction and the resulting host with one lifetime owner. Shutdown waits for construction and host drainage before other app dependencies are cleaned up. New host construction is refused once shutdown begins; rejected close attempts can be retried. A failed constructor does not strand quit.

The existing quit handler prevents repeated quit events from bypassing pending cleanup and restores quit controls after failure. Concurrent cleanup callers share an attempt. The updater now aborts installation if its cleanup hook fails, clears the updating flag and retains the downloaded update for retry instead of continuing into installation.

Verification: six lifetime/storage tests (18 assertions), one isolated updater regression (five assertions), Electron typecheck and diff check passed. The updater test mocks Electron/updater in its own process; no actual update or app quit performed. Tests exercise deferred startup, hung drainage, retry, duplicate ownership, unavailable storage and update-install refusal.

No production host startup or durable public admission enabled. Live quit/update certification remains pending; no restart or commit performed. Earlier included in this commit slices preserved.
