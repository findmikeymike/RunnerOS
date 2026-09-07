---
name: youtube-intelligence
description: Extract source-backed, timestamped intelligence from YouTube transcripts into intel cards, dossiers, playbooks, and agent context packs. Use when the user wants NotebookLM-style YouTube knowledge mining, not generic summaries.
---

# YouTube Intelligence

Use this skill when the user wants to turn YouTube videos, channels, playlists, or transcripts into reusable intelligence.

This is not a summarization skill. The goal is evidence-backed extraction: tactics, principles, frameworks, warnings, tools, contradictions, implementation steps, experiments, and agent-ready instructions.

## Weekly Watchlist Rule

For scheduled Artist HQ Intel Pulse runs:

1. Read `artist-intel-state` when it exists.
2. Request only the latest upload metadata for each configured channel.
3. Skip the channel when that latest video ID is already recorded. Do not fetch a transcript and do not fall back to an older video.
4. When the latest video is unseen and inside the configured lookback window, ingest only that video.
5. Record newly ingested videos in the report's `processedVideos` array so the scheduler can update durable state.
6. If all channels are unchanged, create a no-new-videos report with empty `processedVideos` and `nuggets` arrays.

## Source And Tool

Use the bundled `youtube-intelligence` source first:

```bash
cd tools/youtube-intelligence
node bin/youtube-intelligence.mjs doctor
node bin/youtube-intelligence.mjs prepare --video "<url-or-id>" --out "<workspace>/youtube-intel/<video-id>"
```

Default provider order is cache first, then local `youtube-research` when its optional API key is healthy. When that route is unavailable, use the bundled `zero` skill for the exact missing read-only metadata or transcript operation and pass retrieved transcript text through the transcript-file input. Every Zero GET must use its weekly budget guard. Supadata is only called when `--allow-paid` is passed.

For transcript retrieval through Zero, prefer exact capability `youtube-video-transcript-extractor-70f8ca14`. Before every use, inspect it with `zero get youtube-video-transcript-extractor-70f8ca14 --agent anything-agent --formatted`. Skip marketplace search only when the live result is healthy, its request schema still accepts the needed YouTube video URL or ID, and its price is at most `$0.02`. Run the call through `zero-budget.mjs fetch` with `--max-pay 0.02`, then provide the returned transcript through `--transcript`. Search and vet a replacement only when preflight fails. Never automatically retry a paid failure with another provider.

```bash
SUPADATA_API_KEY="..." node bin/youtube-intelligence.mjs prepare --video "<url-or-id>" --provider supadata --allow-paid --out "<workspace>/youtube-intel/<video-id>"
node bin/youtube-intelligence.mjs prepare --video "<url-or-id>" --provider local --out "<workspace>/youtube-intel/<video-id>"
node bin/youtube-intelligence.mjs prepare --video "<url-or-id>" --provider auto --out "<workspace>/youtube-intel/<video-id>"
node bin/youtube-intelligence.mjs prepare --video "<url-or-id>" --provider auto --allow-paid --out "<workspace>/youtube-intel/<video-id>"
```

Supadata existing transcript fetches cost 1 credit per video. The default Supadata mode is `native` to avoid AI-generated transcript charges. AI-generated transcripts cost by minute and require explicit approval via `--supadata-mode auto` or `--supadata-mode generate`.

The tool can also accept a transcript file:

```bash
node bin/youtube-intelligence.mjs prepare --video "<video-id>" --transcript transcript.txt --out "<workspace>/youtube-intel/<video-id>"
```

For many links, channel targets, or transcript files, run the bundled batch command:

```bash
node bin/youtube-intelligence.mjs batch-prepare --input targets.txt --out "<workspace>/youtube-intel/batch-run" --provider auto --max-videos 25 --channel-limit 10
node bin/youtube-intelligence.mjs batch-prepare --channel "@channelhandle" --out "<workspace>/youtube-intel/channel-run" --provider auto --max-videos 25
node bin/youtube-intelligence.mjs batch-prepare --input links.tsv --out "<workspace>/youtube-intel/batch-run" --provider auto --allow-paid --continue-on-failure
```

Batch input supports one URL/video ID per line, channel handles/URLs, `video<TAB>transcript-file`, or transcript file paths. Channel rows expand through `youtube-research channel-uploads`. Batch outputs include `run-manifest.json`, per-video packets under `videos/<videoId>/`, `batch-extractor-prompt.md`, `cross-video-reducer-prompt.md`, `dossier-template.md`, and `agent-context-pack-template.json`.

## Hard Rule

Do not produce generic summaries.

Reject:
- generic motivation
- vague mindset advice
- repeated internet cliches
- unsupported claims
- stories with no reusable mechanism
- claims without timestamp evidence
- tactics with no implementation path

## Extraction Flow

1. Prepare the transcript packet with `youtube-intelligence`.
2. Read `extraction-packet.json`, `chunks.json`, and `extractor-prompt.md`.
3. Build a timestamped topic timeline before extracting intel.
4. Extract strict JSON intel cards per chunk.
5. Run a reducer/critic pass to dedupe, rank, and separate explicit claims from inference.
6. Produce both human and machine outputs.

For batch work:

1. Run `batch-prepare`.
2. Read `run-manifest.json`.
3. Process every successful `videos/<videoId>/chunks.json`.
4. Write per-video `intel-cards.json`.
5. Run the cross-video reducer prompt.
6. Produce `dossier.md` and `agent-context-pack.json`.

## Intel Card Schema

Return strict JSON:

```json
{
  "type": "tactic | principle | claim | warning | tool | framework | workflow | mental_model | quote",
  "title": "Specific, non-generic title",
  "raw_claim": "What the speaker actually said",
  "why_it_matters": "Why this is useful or non-obvious",
  "implementation": "How a builder, creator, operator, or agent would use it",
  "preconditions": "When this works or does not work",
  "evidence_quote": "Short supporting quote",
  "timestamp_start": 1234,
  "timestamp_end": 1290,
  "novelty_score": 0,
  "actionability_score": 0,
  "evidence_score": 0,
  "confidence_score": 0,
  "tags": ["distribution", "agent-workflow"]
}
```

## Scoring

Rank by:

```text
alpha_score =
  0.30 * actionability
+ 0.25 * novelty
+ 0.20 * evidence_strength
+ 0.15 * relevance_to_user_projects
+ 0.10 * specificity
- fluff_penalty
- unsupported_claim_penalty
```

Keep:
- Tier 1: agent-useful alpha
- Tier 2: useful context
- Tier 3: archive only

Only Tier 1 and strong Tier 2 belong in the agent context pack.

## Report Shape

For one video:
- topic timeline
- high-signal intel cards
- video brief
- quote/timestamp bank
- agent-action checklist

For many videos or a channel:
- executive intelligence brief
- core principles
- unique alpha
- playbooks
- agent instructions
- contradictions/debates
- experiments to run
- source index

For agents:
- `agent-context-pack.json` with principles, playbooks, evidence, failure modes, and retrieval notes.

## Honesty Rule

If durable storage, vector search, scheduled channel watching, STT fallback, hosted transcript providers, or an MCP server are not implemented in the current workspace, say so plainly. Propose the pipeline; do not pretend it exists.
