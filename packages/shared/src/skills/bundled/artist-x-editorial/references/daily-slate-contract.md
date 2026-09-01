# Daily X Slate Contract

Create one Output using `create_output` with this envelope:

```json
{
  "title": "Daily X Slate — Aug 31",
  "kind": "collection",
  "summary": "Five artist-voice X candidates centered on intimacy, self-protection, and the active single.",
  "content": "<stringified JSON slate>",
  "contentMimeType": "application/json",
  "context": { "scope": "hq" },
  "approval": { "state": "pending" },
  "tags": ["artist-x-slate"],
  "showInCanvas": true
}
```

The stringified JSON `content` must be one object:

```json
{
  "schemaVersion": 1,
  "slateId": "xslate_<stable unique id>",
  "title": "Daily X Slate — Aug 31",
  "createdAt": "<ISO-8601>",
  "timezone": "<IANA timezone>",
  "profile": {
    "platform": "x",
    "profileId": "<exact saved profile id or empty string when not connected>"
  },
  "context": {
    "scope": "hq",
    "campaignId": null,
    "campaignName": null,
    "campaignWeight": "none"
  },
  "research": {
    "summary": "<what was researched and the editorial conclusion>",
    "researchedAt": "<ISO-8601 or null when no current research was required>",
    "sources": [
      {
        "id": "src_1",
        "title": "<source title>",
        "url": "https://...",
        "publishedAt": "<ISO date or null>",
        "claim": "<specific fact or tension used>"
      }
    ]
  },
  "candidates": [
    {
      "id": "post_1",
      "revision": 1,
      "lane": "worldview",
      "format": "post",
      "text": "<exact proposed post>",
      "thread": null,
      "rationale": "<why it fits this artist and why now>",
      "researchBasis": "mixed",
      "sourceIds": ["src_1"],
      "campaignId": null,
      "scheduledFor": "<future ISO-8601>",
      "timingBasis": "editorial-default",
      "asset": null,
      "status": "proposed"
    }
  ]
}
```

## Enumerations

- `campaignWeight`: `none`, `light`, `focus`
- `lane`: `worldview`, `campaign-adjacent`, `direct-release`
- `format`: `post`, `thread`
- `researchBasis`: `artist-truth`, `cited-research`, `mixed`
- `timingBasis`: `account-analytics`, `known-audience`, `campaign-constraint`, `editorial-default`
- `status`: `proposed`, `approved`, `skipped`, `scheduled`, `posted`, `needs-attention`

## Candidate Rules

- `post` uses `text` and sets `thread` to null.
- A schedulable `post` must be 280 Unicode characters or fewer. Premium long-post capability is not assumed in V1.
- `thread` sets `text` to the opening post and `thread` to the full ordered string array, but remains draft-only until native thread execution exists.
- `researchBasis` names the actual foundation of the candidate. `cited-research` and `mixed` require at least one `sourceId`; `artist-truth` does not.
- `sourceIds` must resolve within `research.sources`.
- A factual current-event claim must have at least one source.
- `scheduledFor` must be future ISO-8601 or null if the X profile/timezone is unresolved. An unresolved time disables approval.
- Never invent a profile ID. Use an empty string and explain the missing connection in the slate summary.
- `asset` is null unless an exact approved asset reference and digest are available.
- Do not include secrets, provider tokens, hidden reasoning, private notes, or unpublished lyrics not approved for public drafting.

## Optional Asset Shape

```json
{
  "kind": "release-kit",
  "campaignId": "<campaign id>",
  "itemId": "<release kit item id>",
  "sha256": "<verified digest>",
  "label": "<asset label>"
}
```

If the exact hash is unavailable, set `asset` to null and mention the desired asset in `rationale`; do not invent or approximate the reference.
