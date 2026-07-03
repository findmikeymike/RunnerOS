---
name: Record Doctor Handoff
description: Prepare a premium producer-review submission packet and approval-gated email to mikeymikemusic@gmail.com using Artist HQ context and song-specific notes.
tags: [artist, producer, song-review, email, handoff, music]
---

# Record Doctor Handoff

Use this skill when an artist wants a song vetted, reviewed, enhanced, or assessed for release readiness by the producer contact.

## Recipient

Always prepare the producer email for:

`mikeymikemusic@gmail.com`

Do not ask the user for the recipient unless they explicitly want to override it.

## Intake

Start with this user-facing framing. Do not mention internal product names:

> I'll include the key artist context already saved in your profile: your style, similar artists, brand notes, release goals, and relevant details. Add anything specific you want the producer to know about this song: what feels unfinished, what you want help with, reference tracks, story behind it, concerns, or the outcome you're hoping for.

Collect only what is missing:

- song file, attachment, or share link
- artist name
- song title
- goal: vet, feedback, enhancement, mix/arrangement notes, hit potential, or release readiness
- song-specific notes
- reference tracks or similar records
- deadline or urgency
- best contact info

## Artist Context To Pull

Use saved Artist HQ context before asking the user to retype it:

- `artist-profile`
- `artist-voice`
- `artist-branding`
- themes/topics
- similar artists
- genre/style
- release or campaign goal
- relevant notes from vault, campaign, or prior intel when available

If context is missing, still build the packet and mark missing fields.

## Packet Rules

The producer email should be concise and useful:

- lead with the ask
- include song link/file note near the top
- include the artist context blurb near the bottom
- separate confirmed facts from user notes
- do not invent credits, stats, urgency, budget, relationships, or guarantees
- never discuss price, quotes, terms, or scheduling unless the user provides exact language
- do not imply the producer has agreed to work on the song

## Gmail / Sending

Gmail is optional.

If Gmail is unavailable, return a copy-paste email packet and tell the user it is ready to send manually.

If Gmail is connected:

1. Draft the exact email first.
2. Show the recipient, subject, and body to the user.
3. Require explicit current-turn approval before creating or sending anything.
4. Prefer creating a Gmail draft before sending. Build an RFC 2822 message with To, Subject, and body, base64url encode it, then call the Gmail API draft endpoint: `POST /users/me/drafts` with `{"message":{"raw":"<base64url>"}}`.
5. After draft creation, return the draft id/link if provided.
6. Send only after the user explicitly approves the final recipient, subject, body, sender/account, draft id, and send action.
7. To send an approved draft, call `POST /users/me/drafts/send` with `{"id":"<draftId>"}`.
8. If sending fails or Gmail is unavailable, keep the draft/manual copy-paste packet as the finished deliverable.
9. After sending, return the Gmail receipt/thread/message id if the tool provides it.

## Output

```markdown
Record Doctor Submission Packet

Recipient:
Subject:

Submission summary:
- Artist:
- Song:
- Goal:
- Song file/link:
- References:
- Deadline/urgency:
- Contact:

Artist context blurb:

Producer email draft:

Approval checklist:
- Recipient confirmed
- Song file/link included
- Artist context included
- User notes included
- User approved send/draft

Missing info:
```
