# YouTube Intelligence Transcript Spec

## Goal

Build a transcript pipeline that is cheap at low volume, reliable enough for daily use, and honest about paid calls.

Target user pattern: about 5 videos/day, roughly 150 transcript pulls/month.

## Provider Strategy

Default path:

```text
cache
-> local youtube-research/youtube-pp-cli
-> Supadata when --allow-paid is explicit
-> manual transcript file
```

Why:

- Cache prevents repeat spend.
- Supadata is cheap enough for 5/day and more reliable than local YouTube scraping, but it must be explicit because it consumes credits.
- Local `youtube-research` remains the free fallback.
- Manual transcript file keeps the pipeline usable when providers fail.

## Supadata Cost

Supadata pricing currently treats an existing transcript fetch as 1 credit.

- Free: 100 credits/month
- Basic: 300 credits for $5/month
- Pro: 3,000 credits for $17/month
- Mega: 30,000 credits for $47/month
- Giga: 300,000 credits for $297/month

For 5/day:

- 150 transcript pulls/month.
- Free tier may cover most usage.
- Basic covers the whole habit for $5/month.

Important caveat: AI-generated transcripts are priced by minute, not by video. Existing caption/transcript fetch is 1 credit per video.

## API Contract

Supadata YouTube transcript endpoint:

```http
GET https://api.supadata.ai/v1/transcript?url=<encoded-youtube-url>&lang=en&text=false&mode=native
x-api-key: <SUPADATA_API_KEY>
```

The response can contain segment objects with `text`, `offset`, and `duration`. Offsets/durations are milliseconds and must be normalized to seconds before chunking.

Large/generated transcript requests can return:

```http
HTTP 202
{ "jobId": "..." }
```

Poll:

```http
GET https://api.supadata.ai/v1/transcript/<jobId>
x-api-key: <SUPADATA_API_KEY>
```

MVP supports single-video `prepare` plus local batch packet preparation. Batch uses repeated per-video transcript acquisition, not a Supadata batch endpoint.

## CLI Behavior

`youtube-intelligence prepare` supports:

```bash
node bin/youtube-intelligence.mjs prepare \
  --video <url-or-id> \
  --out <dir> \
  --provider auto|supadata|local|file \
  --lang en \
  --allow-paid
```

`--allow-paid` is required before any Supadata call. Without it, `auto` is cache -> local only.

Default Supadata mode is `native` to avoid AI-generated transcript charges. Use `--supadata-mode auto` or `--supadata-mode generate` only with explicit approval.

Credential sources:

1. `SUPADATA_API_KEY`
2. `~/.config/runneros/youtube-intelligence/credentials.json`

Credential JSON shape:

```json
{
  "supadataApiKey": "..."
}
```

`youtube-intelligence batch-prepare` supports:

```bash
node bin/youtube-intelligence.mjs batch-prepare \
  --input targets.txt \
  --out <dir> \
  --provider auto|supadata|local \
  --max-videos 50 \
  --channel-limit 10 \
  --continue-on-failure
```

Input formats:

```text
https://www.youtube.com/watch?v=<id>
<video-id>
@channelhandle
https://www.youtube.com/@channelhandle
<video-or-url>	<transcript-file>
<transcript-file>
```

Channel rows expand through the bundled `youtube-research` wrapper using `youtube channel-uploads`.

Batch outputs:

- `run-manifest.json`
- `batch-extractor-prompt.md`
- `cross-video-reducer-prompt.md`
- `dossier-template.md`
- `agent-context-pack-template.json`
- `videos/<videoId>/...` per-video extraction packets

## Non-Goals For This Phase

- No vector database yet.
- No scheduled channel watcher beyond the starter webhook trigger template yet.
- No Supadata batch endpoint usage yet.
- No STT fallback yet.
- No generic video summaries.

## Next Phase

Add:

- monthly spend/credit counters.
- `yt-dlp` fallback between local wrapper and Supadata if needed.
- persistent dossier index/search after extraction quality is proven.
- optional Supadata batch endpoint support if it proves cheaper or more reliable than per-video transcript calls.
