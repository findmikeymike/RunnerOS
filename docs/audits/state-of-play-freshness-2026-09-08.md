# State of Play: freshness slice

Date: 2026-09-08

## Scope

First slice of the State of Play improvements: refresh derived HQ and campaign
briefs after Release Kit and community mutations, and notify the open UI.
This does not change recommendation ranking, Signals ingestion, or layout.

## Behavior

- Release Kit changes rebuild the affected campaign and HQ brief before notifying
  their context subscribers. Unchanged reads do not rebuild the briefs.
- Community contact and email changes rebuild the generated summary and affected
  manager briefs, including agent-driven changes.
- Observer or refresh failures must not change the reported result of an already
  committed operation, particularly email delivery.
- Existing deterministic composition is reused; no model calls or extra prompt
  material are introduced.

## Verification

- Full discovery suite: 8,869 passed, 0 failed, 10 skipped. Nine private-skill
  cases run separately in the isolated groups; the optional installed CUA-driver
  contract remains skipped.
- All 27 isolated groups: 370 passed, 0 failed, 0 skipped.
- The 28 focused regression cases include actual temporary-workspace contact
  updates, audio readiness changing from zero to one, fresh HQ/campaign broadcasts,
  unchanged reads, and notification/summary failures preserving operation results.
- Server-core TypeScript check and Artist OS main-process build passed.
- Independent review findings addressed: observer errors masking successful
  mutations, summary failures overriding send results, and an unnecessary refresh
  on the read-only request-send check.
- Tests used temporary data; an OS write fence protected real app profiles.
  The full suite uses its standard variant; product-specific cases use their
  isolated Artist OS test processes.

The running Electron app has not been restarted or live-verified with this change.
