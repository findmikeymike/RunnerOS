---
status: v2-idea
owner: unassigned
last_verified: 2026-09-03
related: ../creator-command-center/26-agent-bound-messaging-spec.md
---

# Team Chat: More Than One Person Per Agent

## The idea

Today one phone talks to one agent. The person who redeemed the pairing code is
the only one who can message that chat. A manager, bandmate, or assistant cannot
join the conversation.

V2: let the paired owner invite others.

## Why this is cheap when we get to it

`ChannelBinding.authorizedSenderIds` is already a **string array**, not a single
value (`packages/messaging-gateway/src/types.ts`). Today it holds exactly one
entry — whoever paired. Adding people is appending to that array.

No migration, no reshaping of the binding model, and nothing in the V1 work has
to be undone. That was deliberate.

The sender check is one function, `senderIsAuthorized` in
`packages/messaging-gateway/src/binding-store.ts`. It already fails closed on an
empty list, so widening it is additive.

## Two shapes it could take

Both fit the current model. The choice is a product call, not an architectural
one.

**Group chat — several people, one thread.** Everyone in a Telegram group or
WhatsApp thread talks to the same agent and sees the same replies. One binding,
several entries in `authorizedSenderIds`.

- Fits: a band or a manager plus artist working the same campaign.
- Watch: the agent has one memory, so everyone shares context — good for
  coordination, bad if one person's private direction should stay private.
- Note: the Telegram adapter currently drops non-private chats
  (`adapters/telegram/index.ts`), so a real group would need that relaxed
  deliberately, not by accident.

**Per-person chats — same agent, separate threads.** Each person pairs their own
phone. Several bindings for one agent, one authorized sender each.

- Fits: an assistant who should reach the manager without seeing the artist's
  thread.
- Watch: each thread resolves its own session, so they do not share context.
  That is usually the point, but it means the agent will not remember what it
  told the other person.

## What has to be decided first

- **Who can invite.** Presumably only the original paired sender. Inviting from
  the desktop (where identity is already established) is safer than inviting
  from chat.
- **How someone joins.** Reuse the existing pairing code, issued per person, so
  joining still proves possession of something the owner handed over. Do not let
  an agent slug or a channel id be the credential.
- **Removal.** Removing a person is dropping their entry. Should their prior
  messages stay in the thread? Almost certainly yes; deleting history is a
  bigger promise than this feature needs to make.
- **Whether team-mode workspace membership gates it.** Spec 26 slice 5 wanted
  binding to require workspace membership and campaign access. That is real once
  a workspace has more than one human, and it belongs with this note rather than
  in V1.

## Related V1 decision

V1 closed the door that made this urgent: pairing is now the only way to create
a binding, so a stranger cannot attach themselves to a chat. Multi-sender is
therefore an additive feature rather than a hole to patch.
