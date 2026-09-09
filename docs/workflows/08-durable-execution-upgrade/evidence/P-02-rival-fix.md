# P-02 rival and fix record

Revision r3 · 2026-09-09 · independent reviewer `rival_phase1`.

Initial review found four meaningful defects:

1. Connection settings were frozen but credentials were not. An account replacement under the same connection slug could redirect recovery. Fix pins the exact supported API-key/bearer transport digest and rechecks it in the actual Pi launch. OAuth/IAM/ambient credentials fail closed in this first adapter; credential rotation requires a new run.
2. SDK/tool implementation drift was not pinned. Fix persists a manifest for Pi core, AI, coding-agent and the durable adapter revision and rejects incompatible runtimes before dispatch.
3. Host cleanup could replace the original storage failure with a secondary failure-mark/release error. Fix preserves the original error and makes cleanup best effort only on that error path.
4. Duplicate admission after the saved deadline incorrectly rejected an already-completed command. Fix resolves identical saved admissions before enforcing the deadline for new runs. Changed duplicates still conflict; expired execution still cannot dispatch.

Initial independent journal/controller rerun: 17 passed, 58 assertions. Final independent re-review additionally executed the host/startup regressions: **13 passed, 40 assertions**. The reviewer found error masking also in PiAgent and the streamed error route; both were fixed and covered by those regressions. All four findings are closed.

Reviewer accepted the narrow internal single-step read-only foundation after inspecting default-backend integration, process and packaged-journal evidence, subject to final consolidation. Final consolidation passed: **42 tests, 166 assertions** across the new durability suites (40/161 combined plus 2/5 startup). See [verification](P-02-verification.md). Public rollout, live providers and real OS-keychain certification remain outside this acceptance.

Additional defensive startup-error handling was inspected: existing timeout already bounded startup, so this was not reported as an indefinite hang. No styling or unrelated cleanup was requested.
