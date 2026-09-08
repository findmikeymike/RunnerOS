# Monid-first agent integration — 2026-09-08

## Scope and behavior

Base: `bf82317c1` on canonical Artist OS main. Work isolated on `codex/monid-first-agents`.

Six directly Zero-wired workers were found: Anything Agent, YouTube Research, YouTube Intelligence, Art Director, Outreach, and Industry Hunter. Artist Manager, Setup Concierge, and Hypermotion also contained indirect Zero guidance. All nine stock definitions now prefer Monid among marketplaces; dedicated native tools remain preferred when suitable.

Zero remains available when the user explicitly requests it or focused Monid discovery establishes that the required capability is not provided. Disconnection, low balance, budget blocks, outages, failed calls, and unresolved paid submissions are not capability absence. Existing spending and mutation approvals remain in force.

Monid and Zero remain visible in the initial skill list with a concrete read path. Their detailed skills load when marketplace work is needed, instead of being mandatory reads for every chat. Explicit skill mentions still require reading the skill. Domain skills retain their existing prerequisites, and missing declared marketplace skills still produce a clear error.

## Tool choices and evidence

Read-only research used official documentation and the public Monid catalog; no paid calls, purchases, installs, or account changes were made. Candidates were selected for narrow task fit and observed cost, not unverified claims of best reviews or reliability.

| Task | Candidate | Listed price on review date |
| --- | --- | --- |
| Requested professional email | `hunterio /email-finder` | $0.02392/result |
| Known LinkedIn profile | `ploid /linkedin/profile` | $0.01/call |
| Instagram profile | `tikhub /api/v1/instagram/v1/fetch_user_info_by_username` | $0.0015/call |
| Web search | `context.dev /web/search` | $0.00009/result; minimum 10 |
| One page as text | `context.dev /web/scrape/markdown` | $0.0009/call |
| Text-only image draft | `minimax /v1/image_generation` | $0.0035/result |
| YouTube transcript | `apify /starvibe/youtube-video-transcript` | $0.0075/result; existing $0.02 cap retained |
| YouTube metadata | `apify /streamers/youtube-scraper` | $0.0045/result |

Exact public catalog links are recorded beside the pins in the bundled Monid and domain skills. Pins avoid repeated discovery, not fresh inspection of schema, price, availability, result limits, or approvals. Current catalog billing includes tiers and matrices; unknown pricing stays blocked. There are no public review scores or live success measurements in this evidence.

The previous LinkedIn blog recipe's TikHub endpoint returned 404; the chosen profile route exists in the current catalog. Hunter's narrower email lookup costs less on the listing than PDL's broader $0.30 enrichment, without claiming equal coverage.

Three narrow spending contracts now support the real count semantics: a single Hunter identity, MiniMax's `n`, and Context's `numResults`. They require a matching inspected schema, reject batches/unknown options, and do not make these fields generic budget overrides. MiniMax reference-image input is not supported by this narrow bound; use another compatible inspected route for that job.

## Existing installations

The migration accepts exact shipped prompt bodies and skill hashes only, including older YouTube and Zero versions proven in git history. It preserves custom prompt bytes, custom routing selections, deleted agents, and disabled workspace choices. Startup runs the migration before legacy metadata changes and after legacy prompt normalizers; obsolete unconditional routing restorations were removed.

A copy of the existing local library upgraded eight stock agent definitions and all six affected skills; a second pass made no changes. The Artist Manager copy did not match the exact stock baseline and was preserved; inspection confirmed it contains no Zero routing, so every installed Zero-routing definition was covered. The original profile was not modified during verification.

## Verification and limits

- Focused skill loading, source, provider recovery, budgeting, migration, and startup tests passed.
- Independent rival review: 158 focused tests passed, no remaining blocking finding. The review caught and corrected a MiniMax reference-image promise that exceeded the implemented bound.
- Shared/server and full workspace typechecks passed during development; main and renderer builds passed.
- Final post-catch-up evidence: 8,703 main-suite tests passed, zero failed, one skipped. All 21 isolated files passed with 349 additional tests: **9,052 total passed, zero remaining failures, one skipped**. One isolated assertion expected old guidance wording; it was corrected to verify the persisted guide against the built-in guide, then the entire isolated set passed.
- Final full workspace typecheck and Artist OS main build passed. Renderer build passed with the changed UI guidance. No source changes followed these checks; only the stale test assertion and this evidence note changed.

Authenticated Monid MCP inspection/execution was unavailable to this engineering session. The public catalog and offline contract tests do not prove a real paid endpoint succeeds. Automatic Signals has no provider-choice UI or authoritative marketplace-wide absence detector: it now stops on Monid failures rather than guessing absence and charging Zero. General agent routing supports the two user exceptions through its tool instructions.

No app restart or production package replacement was performed. The running development app keeps its existing profile and development access; updated startup migrations take effect on the next authorized restart.

## Anything Agent follow-up

Anything Agent explicitly considers both marketplaces while planning and may compare focused read-only catalog searches when fit/coverage is uncertain, including tool combinations. Monid remains preferred for execution; comparing catalogs does not itself authorize a paid Zero step.

Connection status, wallet funds, and local spending limits are separate facts. Zero has a known read-only `zero wallet balance` command. Monid's official REST wallet API is documented, but availability through the OAuth MCP connection is not verified: agents must use a genuinely exposed balance tool or report the amount as unknown. They must not invent tools, extract credentials, request an extra API key, or make paid probes. Ordinary chat does not trigger account checks.

The rival follow-up found a historical-metadata edge: an already-current prompt with intentionally selected old routing could have that routing restored. Migration now requires a matching previous prompt body before changing metadata, with a regression proving byte-preservation across repeated runs. New exact stock snapshots preserve upgrades from `4c78d219d` without replacing user edits.

Follow-up verification: full discovery plus all 21 isolated files passed: **9,058 tests passed, zero failed, one skipped**. Shared typechecking passed. The independent rival verified the migration fix and reported no remaining findings. No paid calls or app restart occurred.
