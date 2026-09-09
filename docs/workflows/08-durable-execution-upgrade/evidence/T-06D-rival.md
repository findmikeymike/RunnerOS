# T-06D independent rival review

Revision r7 · 2026-09-09 · reviewer rival_phase1. Parent records the independent read-only response; reviewer did not edit files.

Narrow T-06D accepted. All four findings fixed and independently rechecked:

1. Legacy coexistence: filtered legacy-run listing formerly threw when no matching journal run existed. Only explicit not-found now produces an empty durable projection; storage/authorization errors still propagate. Real service plus legacy handler test covers coexistence.
2. Privacy: exact normalized inputs were initially broadcast workspace-wide despite principal filtering. Durable updates now target only the requesting client, verified with two client inboxes.
3. Stale-version recovery: mounted cards previously retried old expected versions indefinitely. Renderer refreshes failed durable decision state without silently resubmitting; unchanged retry identity remains stable through transport failure.
4. Decision acknowledgement: current superseded state was conflated with historical approval success. DTO now separately includes immutable journal receipt. Exact duplicate lookup follows current principal authorization and precedes new manifest/input checks, without restarting execution. New incompatible decisions remain blocked.

Verified consolidated evidence: 135 tests / 723 assertions, actual attention-bridge crash recovery, and copied packaged journal approval proof. Independent targeted checks: 22 tests / 96 assertions. Parent verified 355 additional regressions / 1121 assertions, four package typechecks, focused renderer lint and temporary Pi bundle.

Accepted r6-to-r7 historical prerequisite carry-forward; historical evidence remains historical. Optional service remains unconfigured. Public admission, live UI, host lifecycle, remaining T-06 routing and P-03 are not accepted as complete. No app restart or push.
