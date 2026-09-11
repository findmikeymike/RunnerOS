# Migration customization preservation — Area 9

Dedicated branch: `codex/migration-customization`. Started on main `4188ef122`, refreshed to `4491d2122` before full validation.

## Confirmed issues addressed

1. Focus recipes now upgrade only from immutable historical fingerprints. Current installed values are never used as their own proof of being stock. Custom recipes and explicit empty arrays remain; absent recipes are populated only for recognized stock definitions.
2. Spotify Analyst upgrades use two exact historical prompt texts. Appended/custom text survives; broad whole-document regex replacement is removed.
3. Release Kit legacy imports preserve an existing primary in the same category/subtype. A legacy primary fills only an empty primary slot, including repeated imports and ledger recovery.
4. Built-in agent migration writes are atomic. Failures are logged. Before reseeding an already-unreadable required agent, its original bytes are copied to an exclusive archive; archive failure leaves the original untouched.
5. Skill migration failures no longer fail the entire SessionManager initialization gate. Agent/skill and workflow normalization/default activation are deferred, while auth, existing-session restore, watchers and runners continue. A nonblocking HQ notice reports the failure. Deferred resolution preserves loose legacy customizations and prepared aliases while respecting deliberate stock selections in completed scopes; unresolved ownership is not silently replaced with stock.
6. Skill retirement records directory identity and stages via rename before recursive removal. Verified copies and synced journal state precede deletion. Interrupted owned staging can resume, while replaced paths remain untouched. Record rewrites journal both before/after digests before publication, recovering a committed write whose journal acknowledgment was interrupted. Post-intent checks retain user edits made during journal publication. Invalid eligibility maps, pending batches, and write intents defer before migration; missing historical eligibility is retained for recovery rather than guessed.
7. The existing Comms metadata and prompt migrations now pass their intended built-in allowlists. Other migration rosters were not blindly combined.

## Verification and boundaries

Focused checks cover historical and customized recipes, exact Spotify upgrades, injected atomic-write failures, archive failures, primary preservation, malformed startup records, partial staged removal, replacement ownership, record/journal interruption, and edits during intent publication. The resolver tests compare direct loading and catalogs across project/workspace/global scopes, including explicit stock vs legacy choices and corrupt journals.

Full sharded and isolated suite: 10,189 passed, 10 skipped, zero failed (4,534 + 5,247 sharded; 408 isolated). The affected shard was rerun after final journal validation. All workspace typechecks and Artist OS Electron main/renderer builds passed; shared typecheck and main build were repeated after the final change. Independent final review found no remaining must-fix findings.

The initial skill snapshot records current bytes, including preexisting customizations; it is not a stock-content detector. Migration-history reorganization and optional stock/custom diff UI remain deferred. No new approval flow, real artist-data migration, app restart, or hardware power-loss certification was performed. Previously overwritten customizations are not reconstructed by this patch.

The known order-dependent durable-workflow permission test mock is replaced with real solo-workspace authorization in a disposable fixture (same correction verified in the separate F8 worktree). Main's equivalent browser-safe AI Settings import fix was incorporated from trunk; the duplicate local fix was removed.
