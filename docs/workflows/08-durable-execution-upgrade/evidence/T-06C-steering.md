# T-06C ordered steering verification

Revision r6 · 2026-09-09 · canonical main based on d77f96f2f · internal certified read runner.

Updates are stored as encrypted ordered commands with immutable duplicate receipts and expected-version checks. The actual Pi core awaited turn boundary applies the ordered batch, including before the initial model. A reserved successor freezes prior selection. Late queued updates require fresh-owner replay after cleanup rather than silently dropping the update or rewriting a completed model request. The journal commits a control fence before returning that replay signal, so old Pi failure callbacks cannot fail the resumed run.

Never-dispatched replaced calls have an explicit skipped disposition, checked before legacy permission handling and again before normalized dispatch. Their unused approvals are superseded. Issued reads keep their original identity and recovery path; saved results are immutable. Paused updates stay queued, cancellation remains terminal, and new work retains original permissions and budgets. A repeated replay with no durable progress fails visibly instead of spinning.

**Fresh checks:** 111 durability tests / 606 assertions across 13 files; 355 existing regression tests / 1121 assertions across 19 files. Shared/server-core TypeScript and Pi typecheck passed. Temporary Pi bundle and diff checks passed. Independent narrow review accepted with no remaining blockers. Actual default-host Pi process probe covers three paths: pending approval, saved unused approval, and an update arriving after boundary selection before a new model reservation. First two paths SIGKILL after command persistence and again after selection persistence. Recovery delivers both user updates in order; superseded native read attempts remain zero. Late-boundary path reuses the already completed native read. All three use exactly two provider model requests. The provider is an independent loopback simulator.

Copied packaged Electron probe passed with Electron 44.2.0 / Node 24.20.0, commandsSurvivedSIGKILL, orderedDelivery, skippedWithoutDispatch and recovered epoch 2. Only the installed runtime was copied into a disposable fixture; no production app restarted. Test key injection does not certify actual OS-keychain access.

Review corrections/proof added: persisted revision fence for Pi failure callbacks, explicit skipped disposition before old permission handling, receipt and selection rollback tests, async-authorizer supersession, paused/cancelled commands, immutable sealed boundaries, and replay no-progress guard. See [independent review](T-06C-rival.md).

Logs: /tmp/artist-os-t06c-all.log, /tmp/artist-os-t06c-regression.log, /tmp/artist-os-t06c-process.log, /tmp/artist-os-t06c-electron.log and /tmp/artist-os-t06c-{shared,server,pi}-tsc.log. Test sources persist; logs are disposable local evidence.

Limits: no public steering UI/RPC or escalation routing, writable effects, child delegation or live provider certification. T-06 integration and P-03 remain open. This is neither release certification nor general agent steering rollout. No push or app restart.
