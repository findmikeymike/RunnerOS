# Composio Gmail connection

Implementation: September 17, 2026. Optional user-owned Composio project key, hosted Google sign-in, one Gmail account per Artist OS host/profile. Live profile/search/read/draft verified; sending and full release acceptance remain pending.

## User setup

1. Open **Settings → Connections → Services → Essential → Composio → Set up**.
2. Open [Composio Dashboard](https://dashboard.composio.dev), sign up/sign in, choose **Platform**, then select or create your project.
3. Open **Settings → API Keys → Create API Key**. Use a project key with session creation/linking, connected-account reading, and tool-execution permissions. Do not paste the key into chat.
4. Paste it into the password field in Artist OS; choose **Save and verify**. An invalid replacement preserves the existing saved connection.
5. Choose **Connect Gmail**. Your browser opens Composio's hosted connection page; sign in to the intended Google account and review Google's consent screen.
6. Return to Artist OS. It checks for up to two minutes. **Refresh** checks again; **Reopen sign-in** recovers an interrupted browser flow.
7. Confirm the displayed account before asking Artist Manager, Comms Agent, or Outreach Agent to search/read email or prepare a draft. Send approval includes the selected account and exact recipients, subject, and body.

The user completed real Google authorization on September 17. Dashboard navigation was inspected. The broader cancellation, revocation and persistence matrix below remains pending.

## Gmail routing and live verification follow-up

Runtime prompt composition now adds the current Gmail tool contract for Artist Manager, Comms and Outreach in eligible Artist OS workspaces, without rewriting saved personas. It supersedes old native-only draft instructions, preserves selected senders, retains the native route when Composio is unconfigured, and prevents silent route changes or retries after uncertain writes. New Outreach templates use the same delivery distinction. Composio sends approved supplied content; it cannot send an existing or user-edited Gmail draft by ID or attach files.

The first live Artist Manager check found an execution bug: Composio returned HTTP 400/code 4300 because the execute-level `account` parameter requires project multi-account support. Sessions already pin one verified Gmail account in `connected_accounts`. Removed the redundant execute selector while retaining the session pin and host account/sender checks.

The corrected source then passed a windowless Electron service check using the existing encrypted connection: profile verified, `from:me to:me` search limited to one result succeeded, that message read successfully, and exactly one draft request returned a confirmed draft receipt. Subject: `Artist OS Composio integration check`; recipient: the verified connected account itself. No message was sent, mailbox contents were not printed, and verification credential updates stayed in memory. This validates the corrected service against the provider; a subsequent authorized restart and fresh Artist Manager session also verified the new runtime guidance in the UI. The unsent test draft remains for user inspection.

Focused follow-up: 296 tests passed across prompt composition, role eligibility, agent storage, callbacks, handlers and service. Shared typecheck passed. Other Composio toolkit integrations remain deferred.

## After installing an update

Fully restart Artist OS before configuring a newly added integration. Reloading the window can load a new settings screen while the old host process still lacks its RPC handlers. On September 17, a live read-only check reproduced `No handler for: composio:status` in a process started at 09:46, before the Composio build. The original generic verification error incorrectly suggested a bad key. The card now identifies missing handlers as restart-required and distinguishes known authentication, connectivity, permission and usage errors without exposing raw exception text. No API key was used in this diagnostic.

## Scope and connection ownership

- Gmail search, message reading, plain-text draft creation, and plain-text sending. No attachments, reply threading, draft editing/sending by draft ID, bulk sender, or inbox background trigger in this slice.
- An internal read of Gmail's profile identifies the connected email address. Failure to identify the sender must not be represented as a verified mailbox.
- Native Gmail, Calendar, Drive, YouTube, Community/Resend, Monid and Zero connections are separate. This is not a replacement or automatic migration of their credentials.
- The connection belongs to the Artist OS host/profile and is shared by its eligible HQ/campaign agents. Global credential permissions apply across registered workspaces.
- Composio stores and refreshes Google tokens; Gmail requests pass through its service. Artist OS stores the project key and connection identity in its encrypted credential store. The project key is not a normal exported user secret and is not given to agent tools or subprocess environments.
- **Forget integration** removes the locally saved key/link. It does not revoke Google's consent or delete the remote Composio account. Revoke separately in Composio's connected accounts or your Google account. Replacing a key requires linking Gmail again so account identities cannot silently carry across projects.
- Composio and Google quotas apply. Check the current [Composio pricing](https://composio.dev/pricing) and dashboard usage; Artist OS makes no fixed free-usage promise and performs no automatic purchase or upgrade.

## Engineering contract

- REST v3.1 session creation → hosted connection link → connected-account verification → pinned-account execution. No deprecated direct managed-auth initiation, SDK dependency, generic executor, remote workbench, or agent-managed connection tool.
- Toolkit and tool allowlists are fixed by the host. Every account must match the stored random user identity, selected account ID, Gmail toolkit, and active status.
- Agent operations use named tools so read/draft/send permissions are visible. Sending requires exact approval even in Execute/allow-all mode. Changing the connected account invalidates a pending send; no silent account fallback.
- Provider errors are sanitized; provider account credential responses never reach the renderer or model. Email content remains untrusted task data.
- Requests and response sizes are bounded. A network failure or unreadable result after a write is reported as uncertain, not success. No automatic send retry: inspect Sent mail before requesting another exact approval.
- Message reads decode MIME text into a bounded preview (20,000 body characters), prefer plain text, label HTML fallback, and report truncation. Attachments expose names/types only; binary content is not forwarded to the model.
- UI polling is bounded and cancelled/fenced on workspace change or unmount. Connection operations serialize on the host to avoid key/account replacement races.

Entry points: `packages/server-core/src/composio/`, `packages/server-core/src/handlers/rpc/composio.ts`, `packages/session-tools-core/src/handlers/composio.ts`, `packages/shared/src/agent/core/pre-tool-use.ts`, and `apps/electron/src/renderer/pages/settings/ComposioConnectionCard.tsx`.

## Acceptance gate

Automated evidence (September 17 working tree): 161 focused tests passed across the host client/service/MIME decoder, session handlers and authorization callbacks, role filters, exact-send classifier, real Claude/Pi adapter hooks, protocol routing and channel inventory. Another 12 isolated RPC authority tests passed. These use controlled provider fixtures, not a live Google account. `bun run typecheck:all` and Artist OS main/preload/renderer builds passed; no application restart occurred.

The full `bun run test` included concurrent Release Kit/workflow edits: 63 test processes passed, 2 failed (65 total). The failures were three Release Kit assertions, outside this integration. A follow-up run of both affected test files against the latest concurrent edits passed 61 tests and left one failure: `artist-os-chrome.test.ts` still expects the removed manual audio-versions outside-click handler after that UI moved to a Popover. The two ReleaseKitService failures no longer reproduce. No unrelated production or test files were changed for this integration. The overall suite is not claimed green; a passing provider fixture is not proof of live OAuth, quota availability or real sending.

Before calling this release-ready, use a user-authorized test account:

- [ ] Follow the setup path from an unconfigured profile; verify the Google mailbox shown.
- [ ] Cancel/reopen sign-in, finish after polling ends, refresh, revoke and reconnect.
- [x] With restart authorization, verify encrypted key/link persistence after restarting Artist OS (September 17).
- [x] Search and read the known self-addressed test draft through Artist Manager (September 17).
- [x] Create one explicitly requested test draft; verify one matching draft via Gmail search/read in the fresh Artist Manager session (September 17).
- [ ] Verify the exact sender, recipients, subject and body in approval, including Execute mode; deny once and confirm nothing sent.
- [ ] With explicit send authorization, send one message to a controlled address and record the provider message ID.
- [ ] Change the selected connection while approval is pending; confirm the old send is rejected.
- [ ] Verify native Google connections still work and credentials do not appear in logs or tool results.

## Official references

- [Authentication and token ownership](https://docs.composio.dev/docs/authentication)
- [Manual hosted authentication](https://docs.composio.dev/docs/authentication/manually-authenticating)
- [Session scoping and connected accounts](https://docs.composio.dev/docs/configuring-sessions)
- [REST session creation](https://docs.composio.dev/reference/api-reference/tool-router/postToolRouterSession)
- [Gmail toolkit schemas](https://docs.composio.dev/toolkits/gmail)
- [Managed versus custom auth](https://docs.composio.dev/docs/authentication/custom-app-vs-managed-app)

Post-restart UI evidence: session `260917-fine-puma` loaded the runtime Gmail guidance. Its Composio status, search and read tool receipts all completed without errors. Search limited to two results returned one matching unsent test draft; recipient, subject and body matched (body had only a trailing newline). The agent correctly explained that the send tool cannot send a saved draft by ID. No new draft, send, edit, delete or schedule was requested or performed during this verification.
