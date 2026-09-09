# T-02 — transactional storage proof

Revision r2 · 2026-09-09 · Isolated prototype only. Current source `6c631f8ad35cd954641905b14e077bdd3fbf60e9`. SHA-256 of sorted prototype relative paths + NUL + file bytes: `480f400254395a3ae9c0e36511539963b371f6b3def5c45785292a47776aa8ce`.

## Implemented and verified

- Existing Bun/Node SQLite constructor selection, WAL/FULL/foreign keys/schema validation and 150ms busy timeout. No dependency added.
- Five fixture tables: encrypted current run state, events, outbox, commands and control metadata. Operations/attempts/approvals/child state/budget reservations are logical records in the encrypted run. This is a coarse single-owner prototype, not the final production schema.
- 25 actual SIGKILLs after run INSERT inside an open transaction: run/event/outbox all absent after reopening. 25 SIGKILLs after commit: one acknowledged admission survives.
- Competing live owner denied; dead owner reclaimed with a newer epoch; stale writes fenced. Actual SQLite full condition induced with max_page_count preserves previous state and original error. Live lock contention times out.
- VACUUM backup quarantined in staging before atomic no-clobber publication. Copied/reopened backups refuse dispatch immediately, with no extra disable step. Newer schema and unsafe PRAGMAs fail closed.
- Private 0700 directories, 0600 DB/WAL/SHM/backup; AES-256-GCM replay payload encryption with workspace/run/schema authenticated data. Synthetic marker absent from DB/WAL/SHM/backup bytes; wrong key fails without reset. Disposable keys supplied externally, never stored in journal. No user payloads or credentials.

## Packaged Electron proof

Command: `bun packages/server-core/src/workflows/__tests__/durability/verify-electron.ts`.

PASS: **Electron 44.2.0 / Node 24.20.0 / SQLite 3.53.4 / app.isPackaged=true / recovered epoch=2**. A hidden packaged fixture .app, copied from the installed canonical Electron runtime with its own probe entry and temp profile, committed state, was SIGKILLed, reopened in another actual Electron main process, verified retained data/ownership and produced a backup. **Packaged contention check also passed:** a second connection was blocked by BEGIN IMMEDIATE, returned busy in **158.49ms**, then admitted/read the same record after the first connection released its lock. Temp fixture removed afterward. No production app/config/window was loaded, restarted or replaced.

The initial development-branding attempt failed the packaged assertion, corrected by proper executable/plist packaging. Sandbox initially aborted the probe; the isolated command passed with escalation. Reference: https://www.electronjs.org/docs/latest/tutorial/application-distribution (read 2026-09-09). Temporary raw log: `/tmp/artist-os-durability-p01-electron.log`.

## Limits

Not canonical Artist OS release-bundle, licensing, user-session or provider acceptance. No physical power loss, full physical volume, corrupt-file repair, product migration, cross-platform package, artifact retention or concurrent child-budget certification. SQLite page-limit exhaustion is a real engine error, not a full-volume simulation. Production APIs/migrations/restore UX remain later tasks.
