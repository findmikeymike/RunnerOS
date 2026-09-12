# Backup and recovery audit — 2026-09-12

Baseline: `ccb1ef91e`. Work branch: `codex/backup-recovery`.
Scope: app registry snapshots, HQ recommendation/outcome backups, session bundles/imports, Runner-to-Artist copying, and durable journal backup/key handling.

## Confirmed and fixed

- Missing HQ primary files ignored valid backups. Recovery moved corrupt primaries away before copying the backup, so a failed copy could leave apparent empty state and a later save could erase the last good copy. Readers now recover absent or corrupt primaries; recovery preserves evidence and replaces snapshots atomically. Write failures preserve the previous usable snapshot.
- App registry daily backups existed but were never consulted by the loader. Corrupt primaries could also be copied into the retention pool. Recovery now selects the newest validated snapshot, preserves corrupt evidence, and flushes/atomically publishes replacements. Rotation retains three valid daily snapshots. Saves refuse to replace unrecoverable existing state with a fresh empty registry. Workspace fields used by normal loading are validated, and dangling links are preserved rather than mistaken for first run. This retains the existing first-snapshot-of-day policy; it does not guarantee recovery of the latest settings.
- Session import sanitized a malformed ID only after the collision check, allowing an alias to overwrite another session. A bundled session.jsonl could overwrite the generated transcript. A late invalid file could leave a partially published import. Full path/size validation now precedes destination writes, canonical IDs are required, target creation is exclusive, and the transcript is published last. Caught failures clean only the newly owned import. Imported queued messages no longer replay automatically; existing goal/task relocation behavior remains.
- Exported attachment paths pointed back to the source machine. Exports now use existing session-relative placeholders; imports relocate current and legacy absolute paths, including thumbnails and converted text. A real host fixture deletes the source after import and reads all three copied files successfully for both move and fork.
- The Runner-to-Artist copy tool could delete an original source whose name resembled an old staging folder. Workspace IDs could also escape the destination root. Removed the unowned age sweep, validated IDs, resolved actual source/destination containment including symlinked ancestors, and restricted cleanup to stages/destinations created by that invocation with matching filesystem identity.

## Verification

- 230 tests passed across 21 regular files: the complete shared config test directory, HQ storage, session bundle/import, and real CLI migration tests.
- Two separately executed isolated files passed: 12 HQ recovery tests and one real SessionManager import test. Total final selected verification: **243 tests, zero failures**.
- Five config watcher tests failed inside the filesystem sandbox; the same standalone tests and final combined run passed with filesystem watcher access. No timeout or test behavior was weakened.
- Full `typecheck:all` passed; the final small config validation changes also passed shared typechecking. Dependency containment and diff checks passed.
- No running app restart, real profile recovery, provider action, or live data migration was performed. This is focused verification, not a full repository test run or hardware power-loss acceptance.

## Existing protections and remaining boundaries

- Durable journal backup uses VACUUM INTO, clears owner metadata, and sets dispatch-disabled; opening that backup as an execution journal is refused. These properties are already tested and were not changed. SQLite documents why a live database cannot safely be backed up by independently copying its database and WAL files: [SQLite corruption guidance](https://www.sqlite.org/howtocorrupt.html). Its supported snapshot mechanisms matter here: [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html).
- The durable encryption key envelope is protected by OS safeStorage and fails closed when missing or unreadable. Copying an encrypted journal to another machine is not itself a portable key-recovery mechanism. No secrets were extracted or weakened.
- No complete user-facing whole-app backup/restore flow was found in the examined code. These separate mechanisms do not yet provide a versioned, restorable inventory of all media, registries, private state, and recoverable encryption keys.
- A hard crash before imported transcript publication can leave undiscoverable staging/reservation folders. They are not automatically deleted on age alone, because ownership and preservation must be proven. Complete crash-recovery journaling for these remnants remains future work.
- The public config loader retains its nullable error contract. With no usable snapshot, saves preserve damaged disk state, but the UI still lacks a dedicated recovery-status experience.
- The Runner copy script retains source folders and copies workspace automations unchanged. If both separately configured apps continue running, their schedules can run independently. This is not a safe whole-app disaster-restore activation protocol. A future restore flow needs explicit ownership/activation semantics; this audit did not silently disable existing automation or add approval prompts.
