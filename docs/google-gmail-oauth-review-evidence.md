# Google Gmail Review Evidence

Status: implementation evidence checklist; do not submit until the live flow passes.

## Demo recording

- Show the Artist OS Connections page and the configured desktop client ID (masked except for a recognizable suffix).
- Click **Connect Gmail** and show that consent opens in the system browser.
- Record the English **Magic Co** consent screen.
- Show exactly these requested permissions:
  - `gmail.readonly`
  - `gmail.compose`
- Return to Artist OS and show the connected Google account and status.
- Open one deliberately selected test message or thread. Do not demonstrate a bulk inbox crawl.
- Create a harmless Gmail draft.
- Show the exact recipient, subject, body, sender, and draft before approving send.
- Show the approval prompt immediately before the send call, then show the Gmail message/thread receipt.
- Repeat the approval check through a send path with query parameters (for example `?alt=json`) to prove path variants cannot bypass approval.
- Reopen Artist OS and show that the encrypted connection survives.
- Click **Disconnect & revoke**, then show that Gmail requires authorization again.

## Data handling statement

- Access and refresh tokens are stored only in Artist OS encrypted credential storage. Electron `safeStorage` protects the encryption key through macOS Keychain when available.
- The Google client secret comes only from encrypted Settings storage or the process environment. Workspace `config.json` files may carry the non-secret client ID, but their client-secret field is ignored.
- Tokens, authorization codes, Gmail bodies, and recipients are not written to application logs or renderer storage.
- Gmail content is fetched directly from Google by the local Artist OS runtime.
- Gmail content reaches the user's configured AI provider only when the user deliberately asks an agent to inspect or act on that selected mail. Artist OS does not perform a default inbox crawl.
- The OAuth client ID is configurable through **Connections -> Google / Gmail**. Downloaded Google credential files are not stored in the repository.
- `gmail.compose` technically permits sending. Artist OS therefore enforces its own exact-payload approval immediately before every Gmail send, including upload and query-string path variants.
- Google review and live-account evidence must be recorded in packaged Electron with `safeStorage` available. The weaker machine-bound fallback is intended for non-GUI/headless compatibility, not Gmail review evidence.

## Submission boundary

- Keep the OAuth app in Testing during implementation and live smoke testing.
- Do not add scopes, create another client, switch to Production, or submit verification until this checklist is fully evidenced.
