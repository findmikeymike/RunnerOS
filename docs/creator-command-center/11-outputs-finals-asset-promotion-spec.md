---
status: implemented-v1
owner: agent
last_verified: 2026-07-06
source_of_truth: true
---

# Outputs, Finals, And Asset Promotion

## Purpose

Keep generated work clean without forcing fake decisions too early.

The app should support messy creative exploration, then let the user promote chosen work into a trusted campaign or HQ kit.

V1 is implemented as a lightweight promotion layer on top of existing Outputs. It does not duplicate files, publish assets, or create a separate asset-library object.

## Core Law

```text
Chat is discussion.
Outputs are possibilities.
Finals are trusted assets.
Primary is optional.
```

Do not create a large state machine. V1 has only:

- `Output`
- `Final`
- optional `Primary`

## Definitions

### Output

A durable draft, option, variation, or work product.

Examples:

- generated cover art option
- text-overlay image
- video cut
- bio draft
- caption pack
- ad copy
- campaign plan
- HTML preview
- PDF/report

Outputs can be messy. They are the working pile.

### Final

An Output promoted into the trusted campaign or HQ asset kit.

Final does **not** mean there can only be one. It means:

```text
User-approved enough that agents can trust and reuse it.
```

Examples:

- two final cover-art options still being compared
- three approved shortform clips
- two final caption sets
- one final artist bio

### Primary

An optional marker for the current default choice inside a final slot.

Use only when the app needs one active/default asset.

Example:

- `Final Cover Art`: Cover A, Cover B
- `Primary Cover Art`: Cover B

## User-Facing Model

Use simple language:

```text
Outputs
Finals
Primary
```

Avoid:

- approved
- candidate
- official
- archive
- selected
- locked
- published
- alternate

Those can exist internally later, but not in V1 UX.

## Slots

Finals live in named slots.

Campaign slots:

- `Cover Art`
- `Master`
- `Video`
- `Shortform Clips`
- `Press Copy`
- `Captions`
- `Ads`
- `References`

HQ slots:

- `Artist Bio`
- `Press Photos`
- `Brand Visuals`
- `Brand Copy`
- `References`
- `Logos / Marks`
- `Reusable Captions`

Slots may contain multiple finals.

## Promotion Flow

### Visual / Media Artifacts

Images, videos, audio, HTML previews, PDFs, and design files should already be Outputs.

Each Output card should expose:

- `Set as Final`
- `Set as Primary` when already final
- `Remove from Finals`

Clicking `Set as Final` opens a small picker:

- Scope: `Campaign` or `HQ`
- Campaign ID when scope is `Campaign`
- Slot: `Cover Art`, `Shortform Clips`, etc.

Clicking `Set as Primary` opens the same dialog for existing Finals and marks one chosen Final as the current default for that slot. It does not remove other finals.

Clicking `Remove from Finals` removes only that Final pointer. It does not delete the source Output.

### Text From Chat

Chat text is not automatically an Output.

If the user wants to keep a bio, caption set, strategy, ad copy, or plan from chat:

1. Create an Output from the selected assistant text.
2. Promote that Output into a Final slot if requested.

Text actions:

- `Save as Output`
- `Set as Final`

The second action creates the Output first, then promotes it.

## Agent Behavior

Agents can propose but should not silently finalize.

Good:

```text
I recommend Variation 3. Want me to set it as final cover art?
```

Bad:

```text
I finalized this for you.
```

Agent tool calls should use the same backend action as the UI button.

One underlying operation:

```text
promote_output_to_final
```

Inputs:

- outputId
- scope: `hq` or `campaign`
- campaignId required when scope is `campaign`
- slot
- makePrimary optional
- note optional

## Storage Shape

Do not duplicate files unless needed.

The Output remains the source bundle:

```text
<workspace-root>/outputs/<output-id>/
  output.json
  content.md
  assets...
```

Finals are lightweight pointers in campaign/HQ context:

```json
{
  "id": "final_abc123",
  "scope": "campaign",
  "campaignId": "release-one",
  "slot": "cover-art",
  "outputId": "out_123",
  "assetId": "image_main",
  "isPrimary": true,
  "promotedAt": "2026-07-06T00:00:00.000Z",
  "promotedBy": "user"
}
```

If a final must be exported into a human-readable folder later, use a derived export:

```text
Campaign Assets / Finals / Cover Art / ...
```

But the canonical source should stay the Output manifest plus final pointer.

Current V1 storage:

```text
<workspace-root>/context/finals/CONTEXT.md
```

The body is JSON with schemaVersion `1` and a `finals` array.

Writes use a workspace filesystem lock:

```text
<workspace-root>/context/.locks/output-finals.lock
```

This protects Electron/server-core and standalone session MCP paths from overwriting each other.

## Agent Context

Agents should not ingest every Output by default.

Agents may automatically see:

- Finals for the current campaign
- HQ Finals relevant to their job
- Primary assets when one exists

Agents should only inspect regular Outputs when:

- the user points to one
- the agent created it in the current task
- the workflow explicitly compares outputs

This prevents context clutter.

Agents know how to promote Finals through the normal session tool manifest. The tool name is:

```text
promote_output_to_final
```

The runtime exposes it alongside other session tools. If the user says "make this final" and the Output is clear, the agent should call this tool. If "this" is ambiguous, the agent should ask which Output.

## UI Placement

Output card actions:

- image/video/artifact card in Canvas
- Output detail page
- Outputs page list item menu

Campaign page widgets:

- Recent Outputs
- Finals / Campaign Kit

HQ widgets:

- Recent Outputs
- Artist Kit / Finals

Do not make users dig through old chat sessions to approve or find finals.

## Replacement Rules

Adding a Final never deletes existing finals.

Setting Primary only changes the default pointer.

Removing from Finals does not delete the original Output.

Deleting the source Output should warn:

```text
This output is used in Finals.
```

Current V1 behavior: deleting an Output that is still referenced by Finals is blocked until the user removes it from Finals.

## V1 Non-Goals

Do not build yet:

- complex approval states
- asset version trees
- full DAM taxonomy
- automatic replacement rules
- folder-heavy duplication
- global search ranking
- permissions around finals
- publishing workflows tied to finalization

## Implemented V1 Checklist

Done:

1. Add final-slot data model.
2. Add `promote_output_to_final` service/tool.
3. Add Output card/detail actions: `Set as Final`, `Set as Primary`, `Remove from Finals`.
4. Add Campaign Finals widget.
5. Add HQ Finals widget.
6. Add tests for multiple finals per slot, optional primary, corrupt registry preservation, delete guard, lock timeout, and session tool validation.

Still deferred:

1. Text-selection `Save as Output` / `Set as Final`.
2. Automatic Finals injection into every agent prompt. Agents can promote Finals now; prompt-context summarization should stay compact and explicit when added.
