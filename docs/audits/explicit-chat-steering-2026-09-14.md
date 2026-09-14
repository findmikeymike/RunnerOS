# Explicit chat queue and steering

Main chat sends request queue-only delivery during an active response. Pending messages appear above the composer rather than inside transcript turns. They enter the transcript after the previous response when processing starts.

The queue exposes Edit, Remove, and Steer now. Host commands resolve canonical or optimistic identity, serialize with send admission, reject already-dispatched messages, preserve attachments and explicit skill choices, and flush changes before interruption. Edits remove stale text-offset badges while retaining skill selections. Remove affects only the selected queued message. Steer now persists priority, interrupts through the existing backend Redirect path, then resumes the selected message after the old response drains. Other queued messages remain. Approval/auth handoffs are not bypassed. This does not undo work already performed by an in-flight tool.

UI states distinguish saving, queued position, and applying. Concurrent action clicks are guarded. Queue-change receipts match optimistic IDs; late receipts cannot remove already-processing messages. Selected update priority survives stored queuedOptions recovery.

Validation: 26 isolated host tests and 17 queue/event/RPC tests pass. Live Runner smoke on 2026-09-14 used the canonical Electron app, Scriptwriter session 260913-quick-ocean, deepseek-v4-pro. Harmless QA prompts requested text only, no tools or file changes.

Observed passes:
- Default queue waited for the first answer to finish, then produced the requested three titles.
- Edit changed the pending instruction from ORIGINAL to EDIT RECEIVED; the saved text appeared in the queue.
- A second disposable pending message showed position 2; Remove removed only that message.
- Steer now stopped the 60-scene answer mid-scene 29 and the next response was exactly EDIT RECEIVED. No response to the removed message appeared. The queue cleared and composer returned to idle.

Initial live visual issue: screenshot showed the pending message text, status, and Edit/Remove icons nearly invisible against the dark surface, while the orange Steer now control was visible. Accessibility exposed all controls and allowed functional testing, but this is not a visual acceptance pass. The queue now uses an opaque dark card and explicit white text/icon colors consistent with the chat surface; the edit field has its own dark background and readable text. Live screenshots confirmed readable queued status, message, Edit/Remove icons, and edit field after rebuilding. Transcript placement also warrants checking: accessibility order exposed the dequeued user message before the preceding assistant answer, despite next-turn execution.

No app restart, external publication, account changes, or source implementation edits were performed during this smoke.

Renderer build reminder: set BOTH VITE_CRAFT_PRODUCT_VARIANT=artist-os and CRAFT_PRODUCT_VARIANT=artist-os. product-identity.ts reads import.meta.env.VITE_CRAFT_PRODUCT_VARIANT; the build provenance fallback alone does not select Artist OS UI.

Final visual check: rebuilt with both Artist OS flags, refreshed the idle renderer, and confirmed the window title and Campaigns layout were Artist OS. Screenshot verified the pending card, status, message, pencil and remove icons are readable above the composer. Renderer build and git diff --check pass. No commit made.

Compact design follow-up: queue is now a single-line 11px strip in ActiveOptionBadges centerSlot, between Goal and nugget/view controls. Its top and side border meet the composer top edge; long messages truncate with full text available in Edit. Multiple messages scroll within a bounded strip; compact-mode layouts retain the queue through a fallback slot. Live Artist OS screenshot verified placement and readability; Steer was exercised from the new strip. Electron typecheck passed.
