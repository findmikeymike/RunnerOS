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

If the direct route is unavailable, use the pinned YouTube metadata or transcript endpoint in the bundled `monid` skill. Inspect its current schema and cost, then use the existing single-call and weekly allowance. Monid is the second route; Zero is the final transcript fallback. Do not repeatedly search the marketplace for these known capabilities. If no suitable connection is usable, direct the user to Connections once. Do not claim the transcript endpoint can perform channel discovery or comments retrieval.

For transcript retrieval after native and Monid are unavailable, use exact Zero capability `youtube-video-transcript-extractor-70f8ca14`. Before every use, run `zero get youtube-video-transcript-extractor-70f8ca14 --agent anything-agent --formatted`. Its live schema must accept the needed video URL or ID, it must be healthy, and its price must be at most `$0.02`. Then call it through `zero-budget.mjs fetch` with `--max-pay 0.02`. Do not search for replacements during routine Signals runs. Never duplicate an unresolved paid call or retry a pending charge through a different provider.

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
