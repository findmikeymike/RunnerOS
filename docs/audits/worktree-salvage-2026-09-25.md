# Artist OS worktree salvage — 2026-09-25

## Scope and baseline

Reviewed the 54 registered RunnerOS worktrees against canonical Artist OS `main`
at `ec4f590fd8`; remote main was `318bda507c`. Recovery uses a separate integration
worktree. Launch OS is a legitimate separate product, as are personal-ops,
trade-god and voice-hnic: their divergent code is not missing Artist OS work.
No worktrees or branches were deleted. Canonical licensing edits were left alone.
Trial/demo-account media is disposable per the user; profile data, credentials,
app settings and app workspace data remain protected and outside cleanup scope.

Git ancestry and patch IDs were followed by current source comparisons. A positive
`git cherry` result does not by itself establish missing functionality; later
rewrites often retain the feature. Historical consolidation claims were not
accepted without checking current behavior.

## Recovered work

| Recovery | Origin | Integration |
| --- | --- | --- |
| Video editor layout and transport, LUT/color controls and agent color operations, editing/history/media/render correctness | `077ed1d10`, `1f7e60f61`, `2993533f4` | Cherry-picked as `1fd44f196`, `06de8d3dc`, `ac9628183`; current Lab/Campaign shell retained |
| Research receipt integrity | Useful narrow subset of parked `63533db72` | Stop treating arbitrary result JSON as host-attested redirect evidence; retain requested resource query IDs while stripping recognized credentials/tracking using a shared URL policy |
| Disposable synthetic smoke fixtures | `d66b3dfc4` | Adapted to current context/Outputs APIs, stable IDs and marked disposable directories; no credentials, providers or app registration |
| Trusted built-in source doctors | Missing guard from `dc48b0611` | Resolve bundled Lottie/Video Studio tools instead of executing workspace-supplied shadow scripts |
| Squad command failure contract | `5b2102fd5` / `55c8ce791` | Restore failure handling for failed or malformed child results while preserving supported pending results |

Research recovery does not enable V2, broaden browser-tool eligibility or migrate
stored receipts. Query redaction covers recognized credential keys, not arbitrary
proprietary secrets. The local smoke loader is developer tooling, not a new app UI.

## Existing work already retained

- Dirty `scheduled-work-lifecycle`, `social-execution-outcomes`,
  `steering-reliability` and `vault-smoke-fixes` implementations are already
  represented by `2c076e037`, `930928b83`, `7749710aa` and `be203b4ad`, respectively,
  with later hardening on main. Replaying old whole files would regress newer code.
- Seven clean patch-equivalent groups: `proliferate-chimpanzee`,
  `build-provenance`, `campaign-onboarding-smoke-fixes`,
  `deep-research-contract-spine`, `migration-customization`,
  `monid-global-persistence`, and `simple-artist-public-context`.
- `canvas-smoke-fixes` behavior is retained despite differing patch IDs.
- Archived timeline, runtime isolation, Spotify/curator agents, social browser
  and output-preview changes, secrets presets, raw video agent and orchestration
  code are already present or superseded. The specific missing guards above were
  extracted instead of merging those branches wholesale.
- The older per-request credential-getter implementation is absent, but current
  credential save/revoke handlers await source rebuilds, including active sessions;
  no current regression justified restoring it.

## Preserve rather than import

- `app-action-layer`: unfinished generic action dispatch writes to a separate
  shadow store, not the current UI's domain storage. Preserve design/code; it is
  not a ready-to-integrate feature.
- `conversation-background-tasks`, `enrichment-startup-followup`, and the rest of
  `profile-enrichment-review-fixes`: intentionally parked unfinished V2 work.
- `model-catalog-lifecycle`: untracked design plan, no implementation to cherry-pick.
- `claude-sad-clarke-10a760`: orchestration implementation already retained; 27
  unique authored planning documents preserved separately. Fetched upstream
  reference repositories require provenance, not copying into the product.
- Root `codex/agent-adds` is historical, not canonical. Its full divergent history
  must not be merged into main. Other products and standalone `TheRoom` documents
  are outside the retirement set.

## Retirement policy

The initial conservative set contains 12 old clean worktrees whose tips are exact
ancestors of both local and remote main: `proliferate-alligator`,
`proliferate-mamba`, `approval-binding`, `artist-profile-enrichment-v1`,
`backup-recovery`, `connection-lifecycle`, `connection-lifecycle-integration`,
`output-integrity`, `profile-enrichment-spec`, `team-mode-reliability`,
`test-infrastructure`, and `workspace-identity`. Their measured folder usage was
44.58 GiB; this is not a guaranteed amount of reclaimable disk space.

Additional trees can be retired after recovery lands and their preserved history
and untracked files are verified. This means removing redundant working folders,
not deleting branch history. Parked feature trees remain explicitly protected.
Recheck dirty state, ancestry, dependencies and running processes immediately
before any eventual removal; this audit is not a deletion command.

Private backup artifacts include binary working/staged patches, untracked-file
archives, manifests and a verified self-contained history bundle of 50 refs.
Six ignored Squad storyboard files and one local agent settings file were also
archived and hash-verified; all 27 authored orchestration planning files matched
their backups. Both fetched reference repositories were clean and their remote
and exact revision provenance was recorded. They live outside all candidate trees.
Detailed per-tree ledgers and the retirement inventory accompany the user-facing
audit artifact rather than importing private historical notes into this repo.

## Verification

- Full repository gate: **68 processes passed, zero failed or skipped** (six
  regular shards plus 62 isolated processes), after product source was frozen.
- Real styled video editor browser harness: **43 passed, zero failed**, including
  editing/history, audio playback, LUT pixels, GPU/CPU fallback and responsive layout.
- All-package typecheck passed; shared typecheck rerun after final doctor changes.
- Artist OS main-process and renderer builds passed with both product variant
  variables set. Actual CommonJS source resolver load is covered by a regression.
- Targeted shared lint passed; affected Electron files had zero errors and 11
  existing warnings (hook dependencies/localStorage). Root has no ESLint config;
  configured package checks were used.
- Research: 18 focused tests / 122 assertions, including persisted receipts and
  synthesis source catalog. Smoke fixtures: five tests. Guard recovery: six doctor,
  23 Squad wrapper and 16 source-test handler checks. A separate real bundled
  storyboard smoke passed with local Python 3.12; wrapper contract fixtures are
  deterministic and do not call providers.
- Review found and fixed OAuth-query leakage, a cwd-based doctor fallback bypass,
  and a CommonJS import incompatibility before the final gate. An earlier test run
  was deliberately stopped while those changes were applied; only the completed
  frozen-source run above is the acceptance result.
- Three original video commits are patch-equivalent to the recovery branch.
  No live providers or user profile were used. Compiled integration builds do not
  imply the running app was restarted.

Recovery commits: `0ff633cc` (research), `22fff52b` (synthetic fixtures),
`9b84c02e` (trusted doctors), `0e1e9d58` (Squad), plus the three video cherry-picks
listed above. The final audit commit contains this ledger. Land by fast-forward
only, preserving unrelated canonical working changes.
