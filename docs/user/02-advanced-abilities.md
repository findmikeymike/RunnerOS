---
status: draft
owner: product
last_verified: 2026-07-05
source_of_truth: false
---

# Advanced Abilities

These are the powerful parts of RunnerOS that users do not need on day one, but should understand once work gets serious.

## Background Workers

Some workers can run while you keep doing other things.

Use background work for:
- research
- long audits
- content batches
- video/render jobs
- recurring checks
- multi-step workflows

Do not use background work for actions that need judgment right now, like approving a public post.

## Worker-to-Worker Messaging

Workers can hand work to other workers.

Examples:
- HNIC asks Content Genius for ideas.
- Content Genius hands an approved caption batch to Social Publisher.
- Industry Hunter creates targets, then Outreach Agent writes messages.
- Art Director creates a visual brief, then an image/tool worker creates the asset.

The user should still see the result. Worker messaging is coordination, not a hidden black box.

## Spawned Sessions

A worker can start a separate worker session for a subtask.

Useful when:
- one task needs research while another drafts
- a specialist should own a piece
- work should stay organized by role

Spawned sessions should inherit the workspace/campaign context and stay visible from the worker/session history.

## Permissions

Workers have permission modes.

Simple version:
- **safe**: low-risk guidance and local work.
- **ask**: asks before meaningful actions.

Any external action should be approval-gated even if the worker is smart.

## Context Docs

Context docs are the durable notes a workspace can give to workers.

Examples:
- Artist Profile
- Artist Voice
- Artist Branding
- Campaign brief
- Shared Intel
- Source guides

Workers should use context silently. They do not need to recap it unless the user asks.

## Agent Memory

Agent memory stores durable preferences for a worker.

Examples:
- "Content Genius should keep captions punchy and less polished."
- "Art Director should avoid beige palettes."
- "Outreach Agent should default to concise copy-paste packets."

User-wide preferences should go to user memory. Worker-specific preferences should stay with that worker.

## Shared Intel Routing

Share Intel does not blindly save everything everywhere.

Runner scores the useful nugget, chooses target workers, and injects it only where relevant.

Example:
- A visual direction note goes to Art Director and Branding Agent.
- A caption voice note goes to Content Genius.
- A press contact note goes to Outreach/Comms.

## Trusted Worker Tools

Some workers have trusted internal tools for bounded work.

Example:
- Art Director can create a Canvas-visible output.

Trusted tools are not a permission slip for public actions. Posting, sending, spending, uploading, and deleting still need approval.

## Long-Running Work

Long-running jobs should leave breadcrumbs:
- what started
- which worker owns it
- what it is waiting on
- where the output will appear
- what failed, if anything

If a job fails, the user should see a retry path or a clear missing-setup message.

## Automations vs Workflows

Use a workflow when the user starts the process.

Use an automation when an event starts the process.

Examples:
- Workflow: "Run weekly content pipeline."
- Automation: "When a new campaign label is added, ask Content Genius for first ideas."

## Visual Agents

Visual agents produce inspectable artifacts.

Examples:
- Art Director
- Video Editor
- Raw Video Editor
- Hypermotion
- Lottie
- Shopify/Print agents when producing previews or receipts

They should provide a preview, file path, output record, or clear receipt.

## Human Approval Packets

For external action, the best worker output is often an approval packet.

It should show:
- platform/account
- final copy
- media/file
- target recipient or destination
- timing
- risk notes
- what will happen if approved

This keeps users in control without making them dig through old chats.

## Failure States Users Should Expect

Runner should be honest when:
- a key/source is missing
- the account is not logged in
- a provider has no credits
- a worker lacks the right skill
- a file path is missing
- a tool fails
- the user has not approved the action

The right behavior is a clear blocker and next step, not fake success.
