---
status: partially-implemented
owner: unassigned
last_verified: 2026-09-07
source_of_truth: true
scope: chat steering UI surfacing
---

# STEER FEATURE — Mid-Stream Chat Steering

Chat steering lets the user send a message **while the agent is already
working** and have it change the in-flight turn instead of waiting for the
next one. The entire backend and message pipeline is built, tested, and
merged. **The UI never surfaces it**, so the feature is undiscoverable in the
main chat and structurally unreachable in compact mode. This doc records the
full wiring and what a fixing agent needs to know.

Verified against `main` at `57eaa8255` (2026-09-07). Line numbers are real
but will drift; symbol names are the stable reference.

## Current state in one paragraph

Typing + Enter in the main chat while the agent is streaming **does steer
today** — nothing blocks it — but the only visible affordance while
processing is a Stop button, the placeholder is an empty string, and in any
compact surface (window < 768px, EditPopover chats) the input is hidden
entirely while processing. Users conclude they must wait or press Stop. The
feature works only by accident of Enter-key muscle memory.

## What is built and works

### Send path (renderer)

- `handleSendMessage` in `apps/electron/src/renderer/App.tsx:1162` captures
  `sendingMidStream = sessionAtSend?.isProcessing === true` (line 1169),
  flags the optimistic user message `isQueued: sendingMidStream` (line 1303),
  and sends via the normal `sendMessage` RPC. No special channel exists or is
  needed.
- Comments at App.tsx:1167 and App.tsx:1291 document the two-backend split:
  Pi steers (server emits status `'accepted'`, renderer **preserves**
  `isQueued` through that update), Claude queues (server emits `'queued'`
  which confirms it).
- Queued/steered bubbles render with a dashed-draft treatment plus a "queued"
  chip: `UserMessageBubble` in
  `packages/ui/src/components/chat/UserMessageBubble.tsx:330-400` (chip has a
  min-visible-time guard against sub-150ms ack flicker). Wired from
  `ChatDisplay.tsx:2476`.
- Event-processor mapping of `'accepted'` vs `'queued'`:
  `apps/electron/src/renderer/event-processor/handlers/session.ts:617`
  (plus the turn-completion clear at line 88).

### Backend (server)

- `SessionManager.sendMessage` mid-stream branch:
  `packages/server-core/src/sessions/SessionManager.ts:12657-12720`. When
  `managed.isProcessing`, it calls `agent.redirect(message)` and:
  - steered → emits `user_message` with status `'accepted'`; sets
    `activeHumanMessageId`.
  - not steered → backend already aborted via `forceAbort(Redirect)`; message
    is pushed to `managed.messageQueue` for re-send, `wasInterrupted = true`,
    event status `'queued'`.
  - Persists + **synchronous flush before telling the renderer "accepted"**
    (#616 reliability fix) — do not weaken this.
- `steer_undelivered` handling (steer never reached the model): SessionManager
  line 15120 re-queues the message.
- Contract: `BaseAgent.redirect()` in
  `packages/shared/src/agent/base-agent.ts:1190` and
  `packages/shared/src/agent/backend/types.ts:403` — returns `true` if
  steered (events continue through the existing stream), `false` if the
  backend aborted internally.

### Per-backend behavior (do not homogenize blindly)

- **Pi** (`packages/shared/src/agent/pi-agent.ts:2112`): native
  `steer()` — sends `{ type: 'steer' }` over the session socket
  (`packages/pi-agent-server/src/index.ts:1626`), message is injected at the
  next step boundary, events keep flowing through the original stream.
- **Claude** (`packages/shared/src/agent/claude-agent.ts`):
  `redirect()` stores `pendingSteerMessage` (line 2577). The message is
  injected as `additionalContext` on the next **PreToolUse** hook (lines
  1276-1303) with "Stop what you are currently doing and address their
  message instead". If the turn ends with no tool call, it yields
  `steer_undelivered` (lines 2218-2224) and the session layer re-queues.
  Safety net: `pendingSteerMessage` is cleared at turn start (line 917).
- **Other backends**: `redirect()` returns false via
  abort-and-queue fallback.

### Tests that already cover this

- `packages/shared/src/agent/__tests__/claude-agent-handoff.test.ts` —
  pending-steer consumption on handoff.
- `apps/electron/src/main/__tests__/session-message-parity.test.ts` —
  `isQueued` persistence/restore parity.
- Event-processor interrupt tests
  (`handle-interrupted.test.ts`) cover silent-redirect rendering (#616).

## Why it is not usable in practice (the actual gap)

1. **Send button becomes Stop while processing.**
   `FreeFormInput.tsx:2358-2374`: when `isProcessing`, the send button is
   replaced by a Stop (square) button. Enter still steers —
   `submitMessage` (line 1309) checks only `disabled`, `disableSend`, and
   content, never `isProcessing` — but nothing in the UI says so.
2. **Placeholder is literally empty.** `effectivePlaceholder = ''` at
   `FreeFormInput.tsx:446`. No hint like "Agent is working — type to steer
   it".
3. **Compact mode hides the input entirely while processing.**
   `FreeFormInput.tsx:1813`: `{!(compactMode && isProcessing) && (<RichTextInput …>)}`.
   In compact surfaces there is no way to type a steer at all; only Stop
   remains. Compact mode is active when:
   - the shell width < 768 (`MOBILE_THRESHOLD`,
     `AppShell.tsx:598-599`, `isAutoCompact`), or
   - the chat lives in `EditPopover` (`components/ui/EditPopover.tsx:1093`,
   hard-coded `compactMode={true}`).
4. **Steer injection is invisible.** When Pi injects at the next step
   boundary nothing marks that the running turn changed course; the only
   signal is the dashed border on the user's own message. "Steered" vs
   "queued until the turn ends" is indistinguishable to the user.

## Fix options (proposed, not decided)

1. **Minimal affordance (full mode).** While `isProcessing`: keep the send
   button as Send (move Stop beside it or into the toolbar/status slot) and
   set the placeholder to something like "Agent is working — type to steer
   it". Smallest diff; touches only `FreeFormInput.tsx`.
2. **Compact mode: collapse instead of hide.** Render a single-line collapsed
   input while processing rather than removing it, so steering stays
   reachable on narrow windows and EditPopover chats. Watch the
   height-collapse animation in `InputContainer.tsx` (it already animates on
   `isProcessing` transitions in compact mode, lines 94-105) and the
   `compactMode && isProcessing` height logic in `FreeFormInput.tsx:1080`.
3. **Make the steer visible.** When the server emits status `'accepted'` (a
   true steer, not a queue), show a subtle inline note ("steered the running
   task") near the user bubble or in the turn card. This is the only change
   that needs server cooperation beyond what exists — the `'accepted'`
   status already distinguishes the two paths, so it may not need any server
   change at all.

Options 1 and 2 are independent; 3 is additive on top of either.

## Key intel for the fixing agent

- **Enter already steers.** Whatever you build, do not add a separate "steer"
  channel, RPC, or tool — the mid-stream branch in `SessionManager.ts:12660`
  is the path. A dedicated `steer` send type does not exist; sending a normal
  message mid-stream IS the API.
- **Do not "fix" the missing `isProcessing` guard in `submitMessage`** — its
  absence is the feature. A guard there would kill steering in full mode too.
- **Preserve the `'accepted'`-vs-`isQueued` renderer subtlety**: on Pi,
  server says `'accepted'` but the bubble should keep the queued/dashed
  treatment until the `'processing'` status or turn end clears it
  (App.tsx:1291 comment, session.ts:88). If prompts behave oddly around
  this, check both `compose.ts` and `SessionManager.ts` — prompt assembly is
  duplicated there (known drift risk).
- **The synchronous flush before emitting `'accepted'`**
  (SessionManager.ts:12708-12712) is a deliberate #616 reliability fix.
  Keep it.
- **Claude steering can silently no-op** if the model finishes without
  another tool call — that's what `steer_undelivered` re-queue covers. Any
  new UI note must not assume a steer landed just because Enter was pressed;
  key the UI off the emitted status, not the keypress.
- **Escape overlay / interrupt status slot** (`ToolbarStatusSlot`,
  FreeFormInput.tsx:1848) is the existing "interrupt" surface — a natural
  home for a Stop affordance if the send button goes back to being Send.
- **Model dropdown, dictation, compaction badge** are all intentionally
  disabled during `isProcessing` (lines 2058-2090, 2288-2315, 2331) — leave
  those alone; only message sending needs to stay live.
- **`useArtistManagerVoice.ts`** (voice/Mikey path) has its own typed-send
  gate (`canSendTyped`) unrelated to chat steering — don't conflate them.
- **Verify with**:
  - `PANGOCAIRO_BACKEND=fontconfig bun test --path-ignore-patterns='**/release-artist-os/**' --path-ignore-patterns='**/dist/**'`
  - `cd apps/electron && bun run tsc --noEmit && bun run build:renderer`
  - Live smoke needs `CRAFT_PRODUCT_VARIANT=artist-os CRAFT_CONFIG_DIR=$HOME/.artist-os-dev`
    from `apps/electron` (close the user's running instance first —
    single-instance lock). Renderer is served from `dist/renderer`; rebuild +
    Cmd+R.
  - Manual check matrix: full-width chat (steer via Enter on a Pi-backed and
    a Claude-backed agent — Pi should visibly change the streaming turn,
    Claude should abort + queue), narrow window < 768px, and an EditPopover
    chat.
- **Suite must stay green.** There are no known-failing tests to excuse;
  existing steer coverage is listed above — extend, don't weaken.
- **House rules:** never `git add -A`, never bare `git stash`, don't commit
  unless asked, stage only your own paths.
