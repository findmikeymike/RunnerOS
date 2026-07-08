# Lab Contextual Agent Popover

## Goal

Let a writer highlight any lyric fragment in the Lab Pad and call the right Lab worker directly on that selection without leaving the writing surface.

## Core UX

1. User highlights text in Rough Pad, Remember, or a structured song section.
2. A small floating toolbar appears near the selection.
3. Toolbar actions: References, Rewrite, Review, Hook.
4. Clicking an action opens a compact response popover near the selection.
5. User can keep, replace, insert, or park the agent result.

## Agent Context

Every contextual call should send:

- selected text
- source location: rough, remember, or section id/label
- full rough pad
- full remember text
- all structured song sections
- active song title/project
- Lab workspace id
- Artist HQ profile context when available

## Response Popover

The popover should stay small and disposable, not become a full chat.

Actions:

- Replace selection
- Insert below selection
- Send to Remember
- Open full chat
- Copy

For Reference Master, each suggested reference/allusion should also support a small `+` action that sends only that item to Remember.

## Routing

Suggested action-to-role mapping:

- References -> `research.reference`
- Rewrite -> section-aware rewrite role, falling back to `lyrics.rewrite`
- Review -> `lyrics.review`
- Hook -> `lyrics.section.chorus` when target is chorus/hook-like, falling back to `lyrics.rewrite`

The request should still include full song context even when the target is only one phrase.

## Open Questions

- Should the toolbar appear on mouse selection only, keyboard selection, or both?
- Should Replace preserve original selection casing/punctuation when possible?
- Should agent responses be stored as hidden sessions, lightweight transient runs, or visible session threads?
- Should the popover support multiple agent options when more than one active worker can satisfy the role?

## First Implementation Slice

Start with textarea selection support inside `LabSongPadPage`:

- track active selection text and source
- render a floating toolbar using textarea selection coordinates or a simple anchored overlay
- support References only first
- open a compact popover with Reference Master output
- support Send to Remember and Copy
