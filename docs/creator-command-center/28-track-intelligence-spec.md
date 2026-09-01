---
status: proposed
owner: agent
last_verified: 2026-08-31
source_of_truth: true
related: ./07-artist-vault-architecture-spec.md, ./23-release-kit-architecture-spec.md, ./25-release-kit-asset-use-social-scheduling-spec.md
---

# Track Intelligence: Lyrics, Timing, And Musical Metadata

## Briefing For The Implementing Agent

Read this first.

### What this is

Drop a track into the Vault. It transcribes automatically. A review sheet opens with timestamped lyrics. The artist fixes whatever the model misheard, tags genre / energy / tempo, and saves. From then on the lyrics and musical character travel with that track as metadata, so any agent — a lyric-video generator today, a sync-licensing agent later — can reason about the song without opening the audio.

### The one rule that shapes everything

**Machine output is a draft. Only a human save makes it canon.**

Transcription will misread lyrics — that is certain, not a risk. Music transcription is genuinely hard: vocals sit under instrumentation, and speech-trained models handle singing, harmony, and ad-libs poorly. So the review sheet is not a formality bolted on for safety; it is the feature. Unreviewed lyrics must never reach an agent, a lyric video, or a sync pitch.

This mirrors the house pattern the Release Kit already uses: an agent may propose, only a human approves.

### The good news: the data model already exists

`VaultAssetRecord` (`packages/shared/src/artist-vault/types.ts:73`) already carries:

```ts
tags?: string[]
genre?: string[]
moods?: string[]
bpm?: number
similarSongs?: string[]
```

`updateVaultAsset` already persists `moods` and `bpm` with validation (`storage.ts:238-243`). And `listArtistVaultFn` returns **whole asset records** (`SessionManager.ts:7898-7904`), so any field added here reaches agents with no serializer change.

What is missing is: lyrics with timing, an energy rating, auto-population of any of it, and the review surface.

### What you are adding

1. A `trackIntelligence` block on `VaultAssetRecord` (lyrics + timing + musical character + provenance).
2. A transcription/alignment job that runs on audio ingest and produces a **draft**.
3. A review sheet where the artist corrects lyrics and sets tags, then saves.
4. The same block on `ReleaseKitItem.technical`, carried at promotion.

### What you must not do

- **Do not let draft lyrics reach agents.** Unreviewed status must be filtered out of agent-facing reads, not merely labelled.
- **Do not send an unreleased master to a third party without explicit consent.** This is the most sensitive file in the product. Default to local.
- **Do not overwrite artist-corrected lyrics** with a later machine pass.
- **Do not treat energy or genre as machine-authoritative.** Suggest; let the human decide.

### Start here

Slice 1 (data model) and Slice 2 (duration + tempo only, no transcription) deliver value with no privacy surface at all. Transcription arrives in Slice 3.

---

## Purpose

Artist OS holds an artist's masters but knows nothing about them. A master is bytes with a MIME type: no duration, no lyrics, no tempo, no sense of what the song *is*.

That blocks three things the product already wants to do:

- A lyric video needs **timed** lyrics, not a lyrics document.
- A sync-licensing pitch needs to answer "what does this song feel like, and where would it place."
- Any agent asked to pick "the right track for this" is guessing from a filename.

## User Promise

Drop a track in. A minute later it is understood: lyrics transcribed and timed, tempo detected, ready for review. Fix the two words the machine misheard, set the vibe, save.

From then on, every agent that touches that track knows what it says and how it feels — and nothing an agent sees was machine-guessed without the artist's sign-off.

## Non-Goals

- No stem separation, key detection, or mastering analysis in V1.
- No automatic pitching, placement, or outreach. This produces metadata; deciding what to do with it belongs to other features and their own approval paths.
- No lyric-video rendering. This supplies the timing a renderer needs.
- No editing of the audio. The Vault snapshot stays immutable.
- No public lyrics registry integration (Musixmatch, Genius) in V1.

## Core Laws

```text
Machine output is a draft until a human saves it.
Only reviewed lyrics are visible to agents.
The audio is never modified; intelligence is metadata beside it.
Artist corrections are never overwritten by a later machine pass.
An unreleased master does not leave the machine without explicit consent.
```

## Data Model

Added to `VaultAssetRecord`, and mirrored into `ReleaseKitItem.technical` at promotion.

```ts
export type TrackIntelligenceStatus =
  | 'pending'      // queued or running
  | 'draft'        // machine output awaiting human review
  | 'reviewed'     // human-saved; the only agent-visible state
  | 'failed'       // analysis failed; reason recorded
  | 'skipped'      // user declined analysis

export interface LyricLine {
  /** Line text as the artist approved it. */
  text: string
  startMs: number
  endMs: number
  /** Optional per-word timing. Absent when alignment could not resolve words. */
  words?: Array<{ text: string; startMs: number; endMs: number }>
  /** True when a human edited this line's text away from machine output. */
  corrected?: boolean
}

export interface TrackIntelligence {
  status: TrackIntelligenceStatus
  schemaVersion: 1

  /** Present once analysis has produced anything. */
  lyrics?: {
    lines: LyricLine[]
    language?: string
    /** How timing was produced. Alignment is preferred; see Analysis Pipeline. */
    timingSource: 'alignment' | 'transcription' | 'manual'
    /** Machine confidence 0-1, for surfacing "check this line" hints in review. */
    confidence?: number
    /** True when the artist supplied the lyric text and only timing was machine-derived. */
    artistSuppliedText?: boolean
  }

  /** Musical character. Machine may suggest; the human decides. */
  character?: {
    genre?: string[]
    subgenre?: string[]
    /** 1-10. Human-set. A machine suggestion may prefill but never finalizes. */
    energy?: number
    tempoBpm?: number
    /** Detected vs artist-corrected, so we never silently overwrite a correction. */
    tempoSource?: 'detected' | 'manual'
    moods?: string[]
    /** Free text: "sounds like late-era Frank Ocean", "good for a road-trip montage". */
    notes?: string
  }

  /** Technical facts extracted without any model. */
  technical?: {
    durationMs?: number
    sampleRate?: number
    channels?: number
  }

  provenance: {
    /** Which engine produced the draft, for auditing and reprocessing decisions. */
    engine?: string
    engineVersion?: string
    /** Where analysis ran. Recorded so a privacy question is answerable later. */
    processedLocally?: boolean
    analyzedAt?: string
    reviewedAt?: string
    reviewedBy?: { type: 'user'; clientId: string }
    failureReason?: string
  }
}
```

`reviewedBy` is typed `{ type: 'user' }`, matching `ScheduledWorkAuthorization.authorizedBy`. As established in spec 25, **the type proves shape, not origin** — the binding guarantee is that only the host mints this, in response to an authenticated human save. No tool accepts a `trackIntelligence` block as input.

### Existing field reconciliation

`VaultAssetRecord` already has top-level `genre`, `moods`, `bpm`, `tags`, `similarSongs`. Do **not** duplicate them.

- `character.tempoBpm` is the reviewed value; on save, mirror it to the existing `bpm` field so current consumers keep working.
- Same for `genre` and `moods`.
- `trackIntelligence.character` is the richer, provenance-carrying record; the flat fields remain the compatibility surface.

## Analysis Pipeline

### Alignment beats transcription

Two paths, and the better one is the less obvious:

**Alignment (preferred).** The artist already has their lyrics — they wrote the song. Given known-correct text plus audio, forced alignment solves only *timing*. The words are already right, so the output is dramatically better than transcription and the review pass becomes "check the timing" rather than "fix every third word."

**Transcription (fallback).** When no lyrics exist, transcribe. Expect line-level timing to be usable and word-level to be unreliable. Set `timingSource: 'transcription'` so the review sheet can warn accordingly.

The ingest flow should therefore *ask*: "Do you have the lyrics?" A paste box that turns a hard problem into an easy one is worth more than any model choice here.

### Ordering

1. **Technical extraction** — duration, sample rate, channels. No model, no network, never fails meaningfully. Do this first and store it immediately; it is useful even if everything else is skipped.
2. **Tempo detection** — local DSP, no model. Prefill `tempoBpm` with `tempoSource: 'detected'`.
3. **Lyrics** — alignment if text was supplied, otherwise transcription. Produces `status: 'draft'`.
4. **Character suggestions** — genre/mood/energy hints. Explicitly a suggestion; the review sheet must not present them as findings.

Steps 1 and 2 need no network and carry no privacy question. Step 3 is where consent applies.

## Privacy And Consent

An unreleased master is the most sensitive file in this product. A leak is career damage, not an inconvenience.

- **Default to local processing.** Whisper-class models run locally; prefer that for a shipped desktop app.
- **Any remote processing requires explicit, per-workspace consent**, stated plainly: this uploads your audio to *named provider* for transcription. Not buried in settings, not implied by dropping a file in.
- **Respect existing Vault flags.** An asset with `usableByAgents: false` or a private `rightsStatus` must not be sent anywhere remote, regardless of consent.
- **Record `processedLocally`** on every result so "where did this song go" is answerable a year later.
- **Analysis is skippable.** `status: 'skipped'` is a first-class outcome, not a failure.

## Review Sheet

The approval surface, and the heart of the feature.

**Opens** automatically when a draft is ready, and is reachable any time from the asset. A pending analysis never blocks the Vault — the file is usable immediately.

**Layout:**

- Player with waveform; clicking a lyric line seeks to it. The artist must be able to *hear* the moment a line is claimed to start.
- Timestamped lyric lines, editable in place. Low-confidence lines visually flagged so attention goes where it is needed.
- Below: genre, subgenre, energy 1-10, tempo, moods, notes.
- Machine suggestions render as **prefilled but visually distinct** from artist-entered values, so nobody mistakes a guess for a fact.
- One **Save** action. That save is the approval, and it sets `status: 'reviewed'`.

**Rules:**

- Editing a line sets `corrected: true` on it. Corrected text is never replaced by a later machine pass.
- Editing tempo sets `tempoSource: 'manual'`, with the same protection.
- Saving with empty lyrics is legitimate — an instrumental. It still marks reviewed, with character tags intact.
- Re-running analysis on a reviewed track requires explicit confirmation and **preserves corrected lines**.

Per the house principle established in this codebase: the artist telling the system to analyze a track *is* the approval for analysis. Saving the sheet *is* the approval of its contents. There is no third confirmation step, and no re-prompt later.

## Agent Visibility

**Only `status: 'reviewed'` is agent-visible.** `listArtistVaultFn` must filter unreviewed intelligence out of the returned records — omit the block rather than returning it with a status flag, so no agent can reason over draft lyrics by ignoring a field.

Because `listArtistVaultFn` returns whole records, reviewed intelligence reaches agents with no serializer change.

**Lyrics are untrusted content.** They are artist- and model-authored text flowing into agent prompts. They must be rendered as data — the pattern `serializeSessionTasksForPrompt` established in spec 24 (labelled untrusted, envelope-wrapped, `<>&` escaped) applies directly and should be reused rather than reinvented.

**Prompt budget.** Full lyrics for every track would flood context. The compact vault listing carries character (genre, energy, tempo, moods) and a `hasLyrics` boolean plus line count. Full lyrics load on demand through `get_asset_record`. This mirrors the Release Kit's compact-index-plus-fetch pattern.

### What this unlocks

A sync agent can then ask real questions — "mid-tempo, melancholy, 70-90 BPM, no explicit content, lyrics about leaving home" — and get answers without opening a single audio file. A lyric-video agent gets `startMs`/`endMs` per line directly. That is the point of the feature.

## Campaign / Release Kit Carry-Through

When a Vault master is promoted into a campaign Release Kit, its `trackIntelligence` **copies onto the Kit item** alongside the hashed snapshot.

This matters for the same reason Release Kit items are byte copies rather than pointers (spec 23): the approved item must not change when its source does. Lyrics carried at promotion are the lyrics that were approved for that campaign.

- Extend `ReleaseKitItem.technical` with the same block. Bump `schemaVersion` to `3` — a **type-level** change (currently `1 | 2`), widening plus every parser, exactly as spec 25 documented for the `1 → 2` bump. Migration stays additive; a v2 manifest loads as valid v3 with the field absent.
- Editing lyrics in the Vault after promotion does **not** retroactively change the Kit item. Offer an explicit "update this Kit item from the Vault" action, which is a fresh human decision.
- Uploads promoted directly into a Release Kit without passing through the Vault may be analyzed in place, writing to the Kit item's block.

## Failure And Edge Cases

| Condition | Behavior |
| --- | --- |
| Transcription engine unavailable | `status: 'failed'`, reason recorded, Vault unaffected, retry offered |
| Audio unreadable or corrupt | `failed` with a plain-language cause |
| Instrumental / no vocals | Reviewable with empty lyrics; not a failure |
| Very long file (DJ set, album stem) | Duration cap with a clear message rather than a silent hang |
| Non-English vocals | Record `language`; do not silently produce English-shaped nonsense |
| User declines analysis | `skipped`; re-runnable later |
| Re-analysis of a reviewed track | Requires confirmation; corrected lines preserved |
| Asset deleted mid-analysis | Job cancelled; no orphaned write |
| Two analyses queued for one asset | Serialized per asset id |
| Remote consent absent | Local only; if unavailable, `skipped` with an explanation — never a silent upload |

## Implementation Slices

**Slice 1 — Data model.** `TrackIntelligence` types, validation, persistence via `updateVaultAsset`, defensive parse. Mirror reviewed values to the existing flat `genre`/`moods`/`bpm` fields. Pure, testable, no UI.

**Slice 2 — Technical + tempo.** Duration, sample rate, channels, local tempo detection on audio ingest. **No network, no model, no privacy surface.** Ships real value alone: agents learn how long tracks are and roughly how fast.

**Slice 3 — Lyrics.** The "do you have lyrics?" paste box, alignment path, transcription fallback, local-first with explicit consent for remote. Produces drafts only.

**Slice 4 — Review sheet.** Player, waveform, seek-on-line-click, in-place editing, character tagging, Save. This is the slice that makes Slice 3 usable at all — do not ship 3 without 4.

**Slice 5 — Agent visibility.** Filter unreviewed from `listArtistVaultFn`, compact character in the listing, full lyrics via `get_asset_record`, untrusted-data wrapping.

**Slice 6 — Release Kit carry-through.** `schemaVersion` 3, promotion copy, explicit re-sync action.

Slices 1-2 are worth shipping on their own. Slices 3-4 must ship together.

## Acceptance Tests

### Draft containment

- an unreviewed track's intelligence is **absent** from `listArtistVaultFn` output, not merely flagged
- a draft never reaches a Release Kit item
- `reviewedBy` cannot be set through any tool or RPC payload; only a host save sets it

### Review

- editing a line marks it `corrected` and a subsequent machine pass preserves it
- editing tempo sets `tempoSource: 'manual'` and survives re-analysis
- saving with empty lyrics marks reviewed (instrumental case)
- machine suggestions are visually distinguishable from artist values

### Privacy

- a `usableByAgents: false` or private-rights asset is never sent to a remote engine
- absent consent, remote analysis does not run and the outcome is `skipped` with a reason
- `processedLocally` is recorded on every completed analysis

### Carry-through

- promotion copies reviewed intelligence onto the Kit item
- editing Vault lyrics afterward does not alter the promoted Kit item
- a v2 Release Kit manifest loads as valid v3 with the field absent, and is not rewritten on read

### Agent surface

- reviewed lyrics reach agent context wrapped as untrusted data with `<>&` escaped
- the compact listing carries character plus `hasLyrics`, not full lyric text
- a track with 200 lyric lines does not materially inflate a normal agent turn

### Robustness

- engine unavailable, corrupt audio, and over-length input each produce `failed`/`skipped` with a plain-language cause
- two queued analyses for one asset are serialized
- deleting an asset mid-analysis leaves no orphaned write

## Deferred

- Stem separation, key/chord detection, loudness analysis
- Public lyrics-service lookup to seed alignment
- Automatic sync/placement matching (this spec supplies the inputs; matching is its own feature with its own approval path)
- Multi-language transcription beyond language detection
- Lyric-video rendering
- Re-analysis triggered automatically on engine upgrade
