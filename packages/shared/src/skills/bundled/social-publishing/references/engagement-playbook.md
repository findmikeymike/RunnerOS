# Engagement Playbook

Use this playbook when the user asks Social Publisher to inspect or answer comments, mentions, or DMs now or on a schedule.

## Authorization

A direct user instruction or an active scheduled job is a bounded engagement mandate. Resolve the exact profile and inbox types once. Do not ask for approval on every reply that remains inside the mandate.

If multiple profiles could match, ask once before opening an inbox. A schedule must name an exact profile or account set that resolves unambiguously.

## Run Loop

1. Read Artist Voice, especially `commentReplyExamples`, speaking style, vocabulary, and avoid rules.
2. Resolve the exact saved profile and run live readiness/account verification.
3. Open the platform's comments, mentions, or message inbox with `browser_tool`.
4. Inspect unread/recent items. Keep private message text inside the active session only.
5. Skip items already answered by the artist unless the thread clearly needs another response.
6. Draft a native response using the incoming message, thread context, campaign context, and Artist Voice. Do not copy examples verbatim.
7. Verify the visible account plus exact comment/thread/recipient before sending.
8. Create a dry-run action for the exact response and target. Public replies must include `--reply-to <comment-id-or-permalink>`; DM replies should include `--thread-url <thread-url>` when the platform exposes one. Under an active mandate, execute it without another approval prompt.
9. Confirm visible success and record a receipt. Re-snapshot before moving to the next item.
10. Stop at the run limit or when no eligible unread/recent items remain.

## Default Limits

- Public comments/mentions: 20 sent replies per run.
- DMs: 10 sent replies per run.
- Failed attempts: stop after 3 ambiguous or broken target states on one platform.

The user may set lower or higher limits in the direct instruction or schedule.

## Response Rules

- Compliments: warm, short, specific when context supports it.
- Questions about the music/release: answer from verified Artist/Campaign context; do not invent dates, credits, lyrics, links, or availability.
- Jokes and casual conversation: match the artist's demonstrated humor without escalating hostility.
- Constructive criticism: acknowledge without arguing; answer only when useful.
- Harassment/spam: skip. Blocking/reporting requires separate authorization.
- Collaboration, press, booking, licensing, label, management, or paid requests: acknowledge only if Artist Voice contains an approved holding response; otherwise leave for the user.
- DMs: respond only to inbound threads under a DM mandate. Starting a cold DM requires separate explicit direction.

## Mandatory Escalation

Do not send a response involving:

- payments, refunds, pricing commitments, contracts, rights, or legal claims
- passwords, codes, account recovery, identity verification, or credential requests
- threats, stalking, credible safety concerns, self-harm, or medical emergencies
- sexual content involving minors or age ambiguity
- press statements, public controversy, takedowns, or business commitments
- uncertain sender, comment, thread, profile, or logged-in account identity

Leave these unanswered and report a short private summary to the user. Never copy full private threads into global memory, Workspace Context, shared Outputs, or public receipts.

## Platform Entry Points

- X: mentions/notifications for public replies; Messages for DMs.
- Instagram: post/reel comments and Direct inbox.
- TikTok: Inbox/comments and Messages when available for the account.
- YouTube: YouTube Studio comments. YouTube has no general DM send lane.

Platform UI is allowed to change. Use snapshots and visible labels rather than fixed coordinates. Stop on login, CAPTCHA, 2FA, account switch, missing thread identity, or unsupported UI state.

## Run Receipt

Return:

- mandate source: direct or scheduled
- platform/profile
- inbox types inspected
- inspected, replied, skipped, escalated, and failed counts
- one concise line per public reply with target URL when available
- private DM receipts with recipient and status, but without copying full private message bodies
- blockers or login/account issues
