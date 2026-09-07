---
name: youtube-research
description: Use RunnerOS' bundled YouTube Research source for read-only YouTube search, transcripts, embeds, related videos, comments, and channel uploads.
---

# YouTube Research

Use this skill when the user wants to find YouTube videos, inspect channels, pull transcripts, find related videos, collect top comments, or generate embed snippets.

Use Social Publisher instead for uploads, posting, live comments, profile login, or YouTube Studio work.

## Source

Use the bundled `youtube-research` source:

```bash
cd tools/youtube-research
node bin/youtube-research.mjs <command>
```

Artist OS injects `YOUTUBE_API_KEY` when the user adds the optional direct YouTube connection. Treat a connected key as configured, not proven valid, until `doctor` or a real read call succeeds.

## First Checks

```bash
cd tools/youtube-research && node bin/youtube-research.mjs doctor
cd tools/youtube-research && node bin/youtube-research.mjs which "search videos by keyword" --agent
```

If auth is missing or the direct route is unhealthy, use the bundled `zero` skill for the exact missing read-only YouTube operation. Search narrowly for search, channel uploads, metadata, comments, or transcripts; inspect the provider and schema; then run GET retrieval through the saved weekly Zero allowance. Do not ask before each small retrieval inside that allowance. If Zero is unavailable or has no allowance, explain the two setup choices once: configure Zero or add an optional YouTube Data API key.

For transcript retrieval, prefer exact Zero capability `youtube-video-transcript-extractor-70f8ca14`. Before every use, run `zero get youtube-video-transcript-extractor-70f8ca14 --agent anything-agent --formatted`. Skip marketplace search only when that live preflight says it is healthy, its request schema still accepts the needed YouTube video URL or ID, and its price is at most `$0.02`. Then call it through `zero-budget.mjs fetch` with `--max-pay 0.02`. If preflight fails, search and vet a replacement. If a paid call fails, do not automatically try another paid provider.

Zero does not create or replace a Google API key. It is an alternate paid retrieval route.

## Core Commands

```bash
cd tools/youtube-research && node bin/youtube-research.mjs youtube search-list --q "topic" --max-results 5 --agent
cd tools/youtube-research && node bin/youtube-research.mjs youtube search-bulk "topic one" "topic two" --top 3 --agent
cd tools/youtube-research && node bin/youtube-research.mjs youtube videos-transcript dQw4w9WgXcQ --lang en --agent
cd tools/youtube-research && node bin/youtube-research.mjs youtube videos-embed dQw4w9WgXcQ --format markdown
cd tools/youtube-research && node bin/youtube-research.mjs youtube videos-comments dQw4w9WgXcQ --top 10 --agent
cd tools/youtube-research && node bin/youtube-research.mjs youtube channel-uploads @veritasium --top 10 --agent
```

Use `--select` to keep JSON small.

## Safety

- Read-only only.
- Do not publish, upload, comment, rate, edit, delete, or manage channels with this skill.
- Report quota/auth failures plainly.
- Summarize findings into usable research, not raw dumps.
