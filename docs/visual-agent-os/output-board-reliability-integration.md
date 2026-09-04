# Output and board reliability — integration notes

Reviewed base: `369ef747c`, following `ca0850b6e` and `b8de2f632`.
Fixes are on `claude/artist-os-onboarding-0f75bd`; not merged into main.

- Board saves merge against immutable observed card hashes, not editable timestamps. Unseen additions and independent remote edits/deletes survive. Conflicts, duplicate pins and capacity overflow fail visibly without replacing the stored board.
- Renderer preserves dirty drafts and typing during saves; stale reads/save responses cannot cross session navigation. Failed saves expose the error and Retry save. Overlapping-edit conflicts require copying the draft and reopening the board.
- Generated outputs use separate, path-bound origins with self-only asset/data access. Legacy URLs redirect before serving bytes. Realpath checks prevent cross-bundle symlinks; legacy absolute assets must be manifest-attached.
- HTML/SVG document sandboxing blocks domain relaxation. Do not substitute `Origin-Agent-Cluster: ?1`: it reproducibly crashed Electron 39.8.10 custom-scheme navigation during this audit. PDFs are not document-sandboxed.

## Verification (2026-09-04)

- 97 tests passed across OutputService, board model, output storage, protocol and preview URL suites.
- Server-core and Electron typechecks passed; renderer production build passed with existing dependency/chunk-size warnings.
- `node --experimental-strip-types scripts/verify-output-preview-isolation.ts` passed with the actual production handler in hidden Electron fixtures: iframe and Browser Pane-equivalent sessions, classic/module scripts, CSS, local JSON, legacy redirect, cross-output scripts/fetch/images denied, forged host/path denied, document.domain relaxation denied.
- Attached PDF/image serving is covered by protocol tests. Interactive PDF rendering and board navigation/typing have not received a live UI acceptance pass; board lifecycle guards have code review/typecheck and pure merge/rebase tests.

## Integrating

### Navigation follow-up

Pending edits now live in a per-board renderer save queue rather than being discarded with the panel. Navigation flushes the debounce immediately. Newer edits wait for the in-flight save, rebase against its result, and save to the original board. Failed drafts stay in memory across navigation and show Retry on return; this does not promise recovery after an app process crash.

Regression command: `node scripts/verify-board-autosave.mjs`. It runs the actual component and hook in hidden Electron with fake persistence, checking quick navigation, in-flight edits, failure/retry, and absence of writes to the newly opened board. The five `board-draft.test.ts` tests cover the queue independently. Keep this follow-up with the renderer integration.

Keep shared/server/renderer changes together; old board clients without observed state are deliberately rejected. Restart/reopen the app after integration. Existing boards acquire observed state on read, with no persisted-schema migration.

Run `bun install` in the destination worktree before validation if its dependencies changed. Re-run the checks above after applying to main; another branch's build is not destination-tree proof. Do not include unrelated `.claude-flow/` telemetry. Signed packaging and a live board/PDF smoke remain release gates, not claims made by this audit.
