---
status: draft
owner: agent
last_verified: 2026-07-03
source_of_truth: false
---

# Artist Vault Architecture Spec

## Decision

The Vault should become a local-first artist asset library, not a generic file browser.

It should organize files by how artists, managers, and agents actually use them:

- finished vs rough
- global artist asset vs campaign asset
- agent-safe vs private
- usable deliverable vs raw source
- rights-cleared vs needs review

```text
HQ Vault = global artist library
Campaign Vault = campaign/release-specific working set
Agent manifest = compact map of what exists, not file bytes
```

## Product Principle

Artists should not manage folder architecture.

They should think:

```text
Add Final Master
Add Demo
Add Raw Footage
Add Cover Art
Add Press Photo
Add Contract
Use With Agent
```

The app handles placement, metadata, and agent visibility.

## Relationship To Mission Assets

Existing mission/campaign assets are scoped working files.

The Artist Vault is the global library above them.

```text
Artist Vault
  permanent artist library
  reusable across campaigns
  identity, masters, photos, logos, docs, references

Campaign Assets
  release/project-specific subset
  can link to Vault assets
  can also hold campaign-only files
```

Do not merge everything into one flat asset bucket. That creates confusion and makes agents pull rough/private files by accident.

## Default Folder Structure

Create this lazily under workspace root:

```text
vault/
  music/
    masters-finals/
    demos/
    stems/
    beats-instrumentals/
    mix-references/
    lyrics-notes/

  video/
    final-videos/
    raw-footage/
    content-clips/
    b-roll/
    live-performance/
    project-files/

  visuals/
    cover-art/
    artist-photos/
    face-references/
    logos-marks/
    brand-assets/
    posters-flyers/
    merch-designs/

  campaigns/
    release-assets/
    ads/
    press/
    social-packs/

  business/
    contracts/
    splits/
    invoices/
    one-sheets/
    epk/

  references/
    moodboards/
    inspiration/
    similar-artists/
    swipe-files/
```

Rules:

- Folder names stay lowercase kebab-case.
- Create category folders lazily, not at workspace creation.
- Default import is copy, not move.
- Preserve original filename unless collision.
- Collision appends `-2`, `-3`, etc.
- Agent-generated final exports can be saved into Vault only after explicit user action.
- Never auto-promote rough files to finals.

## Asset Metadata

Folders are not enough. Every asset needs metadata.

```ts
type VaultCategory =
  | 'music'
  | 'video'
  | 'visuals'
  | 'campaigns'
  | 'business'
  | 'references'

type VaultAssetKind =
  | 'master-final'
  | 'demo'
  | 'stem'
  | 'beat-instrumental'
  | 'mix-reference'
  | 'lyrics-note'
  | 'final-video'
  | 'raw-footage'
  | 'content-clip'
  | 'b-roll'
  | 'live-performance'
  | 'video-project'
  | 'cover-art'
  | 'artist-photo'
  | 'face-reference'
  | 'logo-mark'
  | 'brand-asset'
  | 'poster-flyer'
  | 'merch-design'
  | 'release-asset'
  | 'ad-asset'
  | 'press-asset'
  | 'social-pack'
  | 'contract'
  | 'split-sheet'
  | 'invoice'
  | 'one-sheet'
  | 'epk'
  | 'moodboard'
  | 'inspiration'
  | 'similar-artist-reference'
  | 'swipe-file'
  | 'other'

type VaultAssetStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'final'
  | 'archived'
  | 'missing'

type VaultRightsStatus =
  | 'safe-to-use'
  | 'needs-clearance'
  | 'private'
  | 'unknown'

interface VaultAssetRecord {
  id: string
  category: VaultCategory
  kind: VaultAssetKind
  label: string
  relativePath?: string
  absolutePath?: string
  mimeType?: string
  sizeBytes?: number
  sha256?: string
  source: 'copy' | 'linked-file' | 'linked-folder' | 'agent-output' | 'manual'
  status: VaultAssetStatus
  rightsStatus: VaultRightsStatus
  usableByAgents: boolean
  campaigns?: string[]
  tags?: string[]
  notes?: string
  createdAt: string
  updatedAt: string
}

interface VaultManifest {
  version: 1
  workspaceId: string
  vaultRoot: 'vault'
  storageMode: 'copied' | 'linked' | 'mixed'
  assets: VaultAssetRecord[]
  updatedAt: string
}
```

## Agent Visibility

Agent visibility is a first-class control.

Default rules:

- `masters-finals`, `cover-art`, `artist-photos`, `face-references`, `logos-marks`, `one-sheets`, `epk`: agent-usable by default after import confirmation.
- `demos`, `raw-footage`, `lyrics-notes`, `brand-assets`, `references`: ask during import.
- `contracts`, `splits`, `invoices`: private by default.
- Anything marked `needs-clearance`, `private`, `draft`, or `missing` should not be used as a final asset by agents.

Good agent behavior:

```text
I found an approved press photo and final master in the Vault.
I also see three demos, but they are not marked final.
```

Bad agent behavior:

```text
I used the rough demo and private split sheet for the campaign brief.
```

Agents receive a compact manifest, not file bytes.

## Manifest Context

Save one global Vault manifest as a workspace context doc:

```text
context/artist-vault/CONTEXT.md
```

Body:

````md
This context lists artist Vault assets. Do not assume files were analyzed. Use tools to inspect specific files only when needed.

```json
{
  "version": 1,
  "workspaceId": "workspace-id",
  "vaultRoot": "vault",
  "storageMode": "copied",
  "updatedAt": "2026-07-03T00:00:00.000Z",
  "assets": []
}
```

## Key Ready Assets

- Final masters: 0
- Approved press photos: 0
- Face references: 0
- Cover art: 0
- EPK / one-sheet: 0
- Agent-usable assets: 0
````

Campaign/mission manifests can reference Vault asset IDs:

```json
{
  "vaultAssetIds": ["vault_asset_123"]
}
```

This avoids copying global assets into every campaign unless the user exports/packages a campaign.

## Classification

Classification should be deterministic first.

### MIME Type Routing

```text
audio/wav, audio/aiff, audio/flac
  -> music/masters-finals unless filename says demo/stem/ref

audio/mp3, audio/m4a
  -> music/demos or music/mix-references unless filename says master/final

video/*
  -> video/raw-footage unless filename says final/export/clip

image/*
  -> visuals/cover-art if square-ish or filename contains cover/artwork
  -> visuals/artist-photos if filename contains press/photo/headshot
  -> visuals/face-references if filename contains face-reference/face-ref/identity-ref/likeness/selfie
  -> visuals/logos-marks if filename contains logo/mark
  -> references/moodboards if filename contains mood/ref/inspo

.psd/.ai/.fig/.sketch
  -> visuals/brand-assets or video/project-files depending filename

.txt/.md/.docx/.pdf
  -> music/lyrics-notes if filename contains lyric
  -> business/contracts if filename contains contract/agreement
  -> business/splits if filename contains split
  -> business/epk if filename contains epk/press-kit
  -> business/one-sheets if filename contains one-sheet
```

### Filename Hints

```text
master, final, bounce, clean, explicit -> music/masters-finals
demo, idea, rough, v1, scratch         -> music/demos
stem, vocal, drums, instrumental       -> music/stems
beat, instrumental, prod               -> music/beats-instrumentals
ref, reference                         -> music/mix-references or references/moodboards
cover, artwork                         -> visuals/cover-art
press, headshot, portrait              -> visuals/artist-photos
face-reference, face-ref, likeness     -> visuals/face-references
logo, mark, wordmark                   -> visuals/logos-marks
poster, flyer                          -> visuals/posters-flyers
merch, shirt, hoodie                   -> visuals/merch-designs
clip, reel, short, tiktok              -> video/content-clips
raw, bts, take                         -> video/raw-footage
final, render, export                  -> video/final-videos
contract, agreement                    -> business/contracts
split, splitsheet                      -> business/splits
invoice, receipt                       -> business/invoices
epk, press-kit                         -> business/epk
```

Low-confidence imports go to the review step, not an `unsorted` folder.

## Import Flow

### Quick Upload

User drops files or clicks `Add Assets`.

The app shows a confirmation table:

```text
Add to Vault

final-master.wav       Music / Masters & Finals     Final      Agent usable
studio-bts.mov         Video / Raw Footage          Review     Ask
cover-v4.png           Visuals / Cover Art          Approved   Agent usable
producer-split.pdf     Business / Splits            Private    Not agent usable

[Save to Vault] [Change] [Cancel]
```

Required controls:

- category/kind dropdown
- status dropdown
- rights dropdown
- agent-usable toggle
- campaign link dropdown
- copy/link selector for large files

### Save From Agent Output

When an agent creates a cover, video export, report, or design:

```text
Save to Vault
[Cover Art] [Merch Design] [Press Asset] [Social Pack]
Status: Draft / Approved / Final
Agent usable: On / Off
```

Do not automatically save all agent outputs to Vault. Outputs are receipts/deliverables; Vault is curated source-of-truth.

## UI Layout

### Vault Home

First screen should feel like a command library, not Finder.

```text
Vault
Search all artist assets...

[Add Assets] [Import Folder] [Open Vault Folder]

Music       24 assets   4 finals
Video       61 assets   12 clips
Visuals     38 assets   8 approved
Campaigns   15 packs
Business    9 private
References  44 refs

Ready To Use
- Final masters
- Approved cover art
- Press photos
- EPK / one-sheet

Recent
- cover-v4.png
- final-master.wav
- bts-studio.mov
```

### Category View

```text
Music

Subnav:
Masters / Finals
Demos
Stems
Beats / Instrumentals
Mix References
Lyrics / Notes

Filters:
Status
Campaign
Rights
Agent usable
File type

Main:
Grid/List toggle
Preview panel
Use with Agent
Add to Campaign
Show in Finder
```

### Asset Detail Panel

Right panel:

```text
Title / filename
Preview
Category / kind
Status
Rights
Agent usable
Campaigns
Tags
Notes
Path
Actions:
  Use with Agent
  Add to Campaign
  Save New Version
  Show in Finder
  Archive
```

## Navigation

HQ side nav:

```text
Vault
```

Inside Vault, use category cards and internal subnav. Do not add every category to the main app side nav.

Campaign spaces:

```text
Campaign
Assets
```

Campaign `Assets` shows campaign-local files plus linked Vault assets.

## Search And Filters

V1 search:

- filename
- label
- kind
- tags
- notes
- campaign

V1 filters:

- category
- kind
- status
- rights
- agent usable
- campaign
- source

Later:

- waveform/audio duration
- BPM/key
- video duration/aspect ratio
- image dimensions/colors
- OCR/text extraction
- semantic search over notes/transcripts

## Save/Storage Rules

1. Never move original user files.
2. Default to copy into Vault.
3. Let user link existing folders for large media libraries.
4. Warn before copying more than 2GB.
5. Store relative paths for files inside workspace.
6. Store absolute paths only for explicitly linked external files/folders.
7. Mark missing linked files without crashing.
8. Do not expose private/business assets to agents by default.
9. Do not include file bytes in context prompts.
10. Keep manifests compact; agents inspect only the needed files.

## Business / Private Assets

Business assets need stricter defaults.

```text
contracts -> private, not agent usable
splits    -> private, not agent usable
invoices  -> private, not agent usable
one-sheets -> approved/agent-usable possible
epk        -> approved/agent-usable possible
```

Agents can be told that business files exist only when useful:

```text
Business docs exist in Vault, but are private and not available to agents unless enabled.
```

## Campaign Integration

Campaign asset picker should support:

- `Add from Vault`
- `Upload campaign-only asset`
- `Link this asset to campaign`
- `Copy into campaign package`

Campaign export/package should include:

- selected campaign-local files
- selected Vault-linked files
- manifest snapshot
- rights warnings

## Agent Integration

Agents should get:

- Vault manifest summary
- key ready assets
- campaign-linked assets
- file paths only when agent-usable

Agents should not get:

- private business file paths
- draft assets unless explicitly relevant
- raw footage unless the user/agent task needs it
- any file bytes by default

Example prompt context:

```md
## Artist Vault

Ready assets:
- Final master: vault/music/masters-finals/song-final.wav
- Cover art: vault/visuals/cover-art/cover-final.png
- Press photo: vault/visuals/artist-photos/press-photo-01.jpg
- Face reference: vault/visuals/face-references/face-reference-01.jpg

Private assets:
- 3 business docs exist but are not agent-usable.

Notes:
- Use tools to inspect files. Do not claim analysis without inspection.
```

## Implementation Plan

### Phase 1: Shared Vault Foundation

Goal: create the non-UI source of truth.

Add:

```text
packages/shared/src/artist-vault/
  types.ts
  classify.ts
  storage.ts
  manifest-context.ts
```

Responsibilities:

- classify files
- compute metadata
- copy/link files
- write/read manifest
- serialize context doc
- enforce agent visibility rules
- test collision handling, private defaults, context output, and invalid manifest backups

Exit criteria:

- shared tests pass
- manifest can be created, loaded, saved, and serialized
- imports copy files into stable Vault folders
- business/private defaults are enforced
- campaign assets can reference Vault asset IDs in data shape

### Phase 2: App Integration Bridge

Goal: expose Vault primitives to the desktop app and agent context system.

Add handlers:

```ts
chooseVaultAssetFiles(workspaceId, kindHint?)
importVaultAssets(workspaceId, filePaths, options)
linkVaultFolder(workspaceId, folderPath)
getVaultManifest(workspaceId)
updateVaultAsset(workspaceId, assetId, patch)
openVaultFolder(workspaceId)
```

All file copying and hashing stays outside renderer.

Also add:

- workspace context doc creation/update for `artist-vault`
- reuse shared safe path validation for agent-readable asset paths
- `Save to Vault` entry point shape for agent Outputs
- campaign manifest support for `vaultAssetIds`

Exit criteria:

- renderer can call IPC handlers
- Vault manifest updates context docs
- private/non-agent-usable paths are hidden from agent context
- campaign assets can link to Vault records without copying

### Phase 3: Vault Experience

Goal: ship the actual Vault product surface.

Build:

- Vault home category cards
- import confirmation modal
- category/subcategory view
- grid/list toggle
- right preview/detail panel
- filters
- `Use with Agent`
- `Add to Campaign`

Exit criteria:

- user can import assets through the UI
- user can browse by Music, Video, Visuals, Campaigns, Business, References
- user can edit status/rights/agent visibility
- user can link assets to campaigns
- user can open the real Vault folder in Finder
- Canvas/Output cards can save selected deliverables into Vault

## V1 Non-Goals

- Full DAM system.
- Cloud sync.
- Semantic asset search.
- Automatic audio/video analysis.
- Automatic rights detection.
- Moving existing user folders.
- Replacing Finder.

## Acceptance Criteria

- User can import files into clear artist categories.
- User can see global Vault assets by Music, Video, Visuals, Campaigns, Business, References.
- User can mark assets final/approved/draft/private.
- User can control whether agents can use each asset.
- Campaigns can link to Vault assets without duplicating files.
- Agent prompts receive a compact manifest and never raw file bytes.
- Private business assets are hidden from agents by default.
- Re-importing same filename does not overwrite without collision handling.
- User can open the real Vault folder in Finder.

## Open Questions

- Should Vault live per artist workspace only, or support multiple artist profiles inside one workspace?
- Should linked folder mode be V1.5 or V2?
- Should agent-created Outputs have a one-click `Save to Vault` action in every Output card?
- Should Vault assets support version chains in V1, or only filename collision suffixes?
- Which preview types are essential first: audio waveform, video thumbnail, image preview, PDF preview?
