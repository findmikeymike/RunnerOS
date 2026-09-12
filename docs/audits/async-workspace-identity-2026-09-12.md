# Workspace and campaign identity across async work

This is phase 2 of the follow-up reliability review. The five areas are:

1. Output persistence, registration, receipts, and retry duplication — completed in the preceding output-integrity commits, integrated at `a7341e260`.
2. Workspace/campaign identity during navigation and async work — this review.
3. Existing approvals remain bound to the approved content, account, media, and destination.
4. Connection/account changes under active sessions.
5. Test discovery, mock isolation, subprocess failures, and skips.

## Confirmed and fixed

### Workspace pages reused drafts across campaigns

Panel reconciliation can preserve a panel ID when another workspace opens the same route. `PanelSlot` reused `MainContentPanel`, so workspace-owned React state survived the identity change. In `WorkspaceContextPage`, an A draft could then save using B's `upsert` callback. A remote directory selection and an unfinished `File.text()` import had the same problem.

`MainContentPanel` is now keyed by workspace ID. Navigation disposes of the old page state and its pending local updates. Same-workspace rerenders retain drafts; the new workspace can still create and save its own documents. This does not cancel server work.

The isolated Chromium regression uses the real `PanelSlot`, `WorkspaceContextPage`, and directory-picker hook, with external IO and unrelated shell components stubbed. Before the fix, it recorded A's text saved to B, a directory update to B, and a late A import dialog appearing in B. All three paths now stay isolated.

### Remote directory confirmation changed owners

`useDirectoryPicker` previously confirmed through the latest `onSelect` callback, unlike the native dialog, which retains the callback that opened it. The hook now retains the opener callback and consumes it once. Cancellation clears it. This preserves operation ownership and prevents duplicate/late confirmations; it adds no approval step.

Regression coverage includes A-to-B callback changes, cancellation, duplicate confirmation, a fresh B selection, and a delayed native selection.

### Chat pages reused async attachment state across sessions

The session route also reused `ChatPage` when the session ID changed inside one workspace. Its input subtree used the constant `freeform` key. A pending attachment read in `FreeFormInput` could therefore complete after navigation, update the retained component, and persist through the new session's attachment callback. Cancellation of draft hydration did not protect independently running attachment reads.

`ChatPage` is now keyed by session ID. This isolates the entire session page, including draft state, attachment setters, and picker UI. The existing input cleanup still saves an unfinished text draft through the original session callback.

`bun run test:session-identity-ui` tests the real `MainContentPanel` route boundary with an explicitly substituted session lifecycle probe. Before the fix, A's local draft and pending result appeared under B; after the fix, B starts with its own state and A's late setter cannot affect it. This test proves route lifecycle isolation, not actual file parsing or the full chat UI; the attachment path above was verified by code trace.

## Verified healthy

- Session tool callbacks retain `managed.workspace` and the originating session ID. Changing the visible session does not rewrite this ownership.
- Queued messages replay through the original session. A regression exercises real `sendMessage`, queue drain, and disk persistence with a paused provider boundary: B's JSONL stays byte-identical, both A messages persist exactly once, and no A session file appears under B.
- Output, Finals, workflow, and Release Kit callbacks use session-bound roots or explicit, validated campaign targets. Intentional global HQ storage is not a navigation leak.
- Browser screenshots and uploads resolve the session's browser instance. Downloads freeze the save path from the bound/owner session when the download begins. Manual unowned browser downloads use the OS downloads destination.

## Validation scope

`bun run test:workspace-identity-ui` runs the isolated browser checks. On this machine, use `PLAYWRIGHT_CHANNEL=chrome` for the installed Chrome binary. No live app, provider, browser account, or artist workspace is used by these fixtures. The session regression is discovered by the ordinary Bun suite.

Verification: all six shards passed (9,852 tests, 10 skips); all 34 isolated files passed (410 tests). The two browser scripts passed 10 checks. All package typechecks and dependency containment passed. The browser checks exercise local React behavior, not external services.

The running Artist OS app was not restarted. Source-level and isolated-browser verification must not be presented as a live-app acceptance run.
