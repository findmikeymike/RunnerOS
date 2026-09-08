# Built-in skill protection — implementation and acceptance

Status: implementation and automated verification complete; live Electron/provider acceptance pending. No restart performed.

## Product contract

Artist OS exposes public skill descriptors rather than runtime bodies. Built-in details offer public metadata, required connections, notices, and personal instructions. User skills retain their existing supported read/edit/export/delete behavior. Shared and workspace preferences are separate, bounded to 16 KB, and loaded only with their parent skill. Missing-parent preferences remain disabled and discoverable for export/deletion.

The trusted inventory covers both inline and generated sources: 106 skills and 317 files. Runtime adapters privately admit the selected core and on-demand references; executable helpers retain their supported execution route. Per-run snapshots pin core/reference/preference revisions through retries, resume, and compaction. New selections take effect at the next run. Public activities and transcript persistence redact private tool material without censoring useful generated work.

This is practical concealment through normal app operations, not local-owner DRM. Old chats, backups, and preserved customized legacy copies remain intact. No paid provider call is authorized merely by reading status or loading a skill.

## Compatibility and review fixes

Migration prepares exact backups and deterministic custom copies before rewriting mutable references and retiring originals. Known historical stock hashes qualify only with unchanged remaining files; unknown or modified material remains custom. Original AGENT/WORKFLOW body bytes stay intact. Existing assignments, session recovery metadata, automation templates, workflow definitions, and rerun snapshots retain their selected custom behavior. Authored text is unchanged; hash-bound compatibility markers stop applying after edits. Fresh renderer sends stamp a current empty marker, preventing retries from resurrecting old selections.

Rival reviews corrected project-scope Finder/icon resolution, unavailable-parent imports, empty-import data loss, personal mutation team permissions, launch aliases, automation/rerun compatibility, and run-specific retry selection. Artist OS migration and managed storage are gated from Runner. Runtime product gating is covered by fresh-process checks for both products; the final review also identified Explore classification and built-in validation/import compatibility corrections.

## Recovery boundary

Do not downgrade a migrated live profile directly to a build that predates managed skill support: old builds do not understand qualified aliases or personal-instruction records. Rollback uses a separate restored pre-migration profile or a deliberate recovery of backed-up skill directories and reference records. Never replace subsequently edited files with an older backup. Migration journals retain exact scope and record backups and do not purge historical user outputs.

During the first full-suite attempt, an existing headless Runner smoke path reached the shared library because Runner ignores CRAFT_CONFIG_DIR for its shared libraries. The new coordinator was initially missing a product gate. Testing stopped; 106 original skill directories and 25 modified AGENT.md files were restored from exact backups and independently rehashed with zero mismatches. Generated copies/journals were quarantined. Recovery evidence: `/tmp/artist-os-library-recovery-20260908T212025Z/actions.json`. No app restart occurred. Subsequent full-suite runs use an OS write fence around real app/shared-library roots in addition to temporary test profiles. The production coordinator and storage now preserve Runner behavior.

## Evidence

- Independent review: repeated after each slice; final pass clear, including Explore reads, product-gated result masking/imports, and read-only enabled/disabled validation.
- Real React browser controls with fake RPC: six checks passed (scope save, in-flight lock, empty save, missing-parent restrictions/deletion, load retry, import retry).
- Focused storage/migration/startup tests: 29 passed, 572 assertions; existing stock migration regression groups also passed.
- Focused authored references, automation/workflow propagation, renderer boundary tests: 117 passed, 441 assertions.
- Full `typecheck:all` passed after merging main `b01e34bbe` and after the final production fixes.
- Shared lint passed. After merging main `b01e34bbe`, Electron lint reports two preexisting nonstandard shadows in ArtistHQHome.tsx (lines 2753 and 2800), plus 99 warnings. Root lint separately reports the preexisting raw `campaign:deleted` Electron send in main/index.ts. All three errors were verified in origin/main; this feature leaves those completed HQ/channel paths intact.
- Artist OS main and renderer builds passed after moving hash validation out of the browser workflow-parser graph. Final main test phase: 8,853 passed, ten skipped, zero failed. Nine product-specific skipped cases also run with zero skips in the isolated Artist OS child; the remaining skip is the existing optional CUA-driver contract. All 23 separate test groups passed: 355 tests, zero failures or skips. The separate prerequisite fixture was corrected to use runtime profile paths instead of a hard-coded home directory; no production source changed after the main phase. Its assertions are unchanged. Main and separate phases together complete the repository test coverage.
- Live Electron/profile migration and actual Claude/Pi/provider execution: not yet verified. Mocked runtime and browser checks do not certify live providers.

Verification logs are retained locally under `/tmp/artist-os-skill-acceptance-*`; browser evidence is `/tmp/artist-os-skill-ui-checks.log`. Runtime product tests use fake providers and cannot certify actual Claude/Pi paid-provider behavior.
