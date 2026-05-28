---
name: canva-design
description: "Use when creating, editing, autofilling, exporting, or organizing Canva designs through the Canva Connect API. Triggers on requests like 'make a Canva design', 'create a presentation in Canva', 'export this Canva design', 'autofill a brand template', 'resize for Instagram and TikTok', 'list my Canva designs', or any design-ops task on a Canva account. Built for the @canva agent and the bundled Canva source."
tags: [canva, design, graphics, branding, autofill, export]
metadata:
  version: 1.0.0
  last_verified: 2026-05-28
---

# Canva Design Ops

Use this skill to drive the Canva Connect API through the bundled `canva` source. All calls go through the generic API tool exposed by the source: `api_canva` with `{ path, method, params }`.

## Prerequisites

1. The `canva` source must be enabled and authenticated. If `isAuthenticated` is false, tell the user to open Sources → Canva → Connect, then resume.
2. Read `sources/canva/guide.md` once at the start of a session for the current endpoint list and quirks.

## Core Endpoints

| Action | Method | Path |
|--------|--------|------|
| List designs | GET | `/designs` |
| Create design (preset) | POST | `/designs` |
| Get design | GET | `/designs/{designId}` |
| Resize design | POST | `/designs/{designId}/resizes` |
| Add comment | POST | `/designs/{designId}/comments` |
| Start export job | POST | `/exports` |
| Poll export job | GET | `/exports/{exportId}` |
| Upload asset (start) | POST | `/asset-uploads` |
| List brand templates | GET | `/brand-templates` |
| Get brand-template dataset | GET | `/brand-templates/{templateId}/dataset` |
| Start autofill job | POST | `/autofills` |
| Poll autofill job | GET | `/autofills/{jobId}` |
| List folders | GET | `/folders` |
| Create folder | POST | `/folders` |
| Profile | GET | `/users/me` |

## Create a New Design

Preset (presentation, doc, whiteboard, email, etc.):

```json
POST /designs
{
  "design_type": { "type": "preset", "name": "presentation" },
  "title": "Q3 Launch Deck"
}
```

Custom dimensions:

```json
POST /designs
{
  "design_type": { "type": "custom", "width": 1080, "height": 1350 },
  "title": "IG Carousel — Launch"
}
```

From an uploaded image asset:

```json
POST /designs
{
  "asset_id": "Mxyz123",
  "title": "Edited Hero Image"
}
```

The response contains `design.id` and `design.urls.edit_url` (give the user the edit URL so they can open the design in Canva).

## Autofill a Brand Template

Use when the user has a Canva brand template and wants to mass-personalize it (requires Enterprise plan).

1. `GET /brand-templates/{templateId}/dataset` — discover field names and types (image / text / chart).
2. `POST /autofills` with:

```json
{
  "brand_template_id": "DAFxxxx",
  "title": "Campaign — Customer A",
  "data": {
    "title_field": { "type": "text", "text": "Launch Day" },
    "hero_image":  { "type": "image", "asset_id": "Mxyz123" }
  }
}
```

3. Poll `GET /autofills/{jobId}` until `status: success`. The result includes the new `design.id`.

## Export a Design

```json
POST /exports
{
  "design_id": "DAFxxxx",
  "format": { "type": "pdf" }
}
```

Other format types: `png`, `jpg`, `pptx`, `gif`, `mp4`.

Poll `GET /exports/{exportId}` until `job.status: success`, then download from `job.urls[0]`. Save the file to the session downloads folder (the api tool will auto-save large binary responses; otherwise fetch the URL).

## Resize for Different Platforms

```json
POST /designs/{designId}/resizes
{
  "design_type": { "type": "custom", "width": 1080, "height": 1920 }
}
```

Common targets:

| Platform | Width × Height |
|----------|----------------|
| Instagram square | 1080 × 1080 |
| Instagram portrait / Reels / TikTok | 1080 × 1920 |
| Instagram landscape | 1080 × 566 |
| YouTube thumbnail | 1280 × 720 |
| X / LinkedIn post | 1200 × 675 |
| Pinterest | 1000 × 1500 |
| Story (any) | 1080 × 1920 |

For multi-platform repurposing, run one resize per target, then export each.

## Upload an Asset

Two-step process for the Connect API:

1. `POST /asset-uploads` with body containing the asset name, returns an `upload_url`.
2. Upload the binary to `upload_url` with the correct content type.

Then reference the returned `asset.id` when creating a design or autofilling.

## Working with Folders

```text
GET  /folders                 → list folders
POST /folders                 → create folder { "name": "...", "parent_folder_id": "..." }
GET  /folders/{id}/items      → list designs/assets in a folder
```

Use folders to organize campaign output (one per launch, per client, etc.).

## Receipts and Output

When you complete a Canva action, return:

```text
Action: created | autofilled | exported | resized | uploaded | commented
Title:
Design ID:
Edit URL:
Output files: (paths or URLs)
Notes:
```

When you export, the file URL or saved path is the most important value — surface it clearly.

## Approval Gate

These actions are user-visible and should be confirmed before running unless the user already explicitly requested them in the current turn:

- Bulk autofill or resize (more than 3 designs at once)
- Comments on shared designs
- Folder mutations that move other people's work
- Deletes (delete is destructive — always confirm)

Single-design creates, exports, and resizes inside the user's own account can run on the initial request without an extra confirmation.

## Errors

- `401` — token expired or revoked. Tell the user to reconnect Canva in Sources.
- `403` — scope missing or insufficient plan (autofill / brand templates require Enterprise).
- `429` — back off, retry with exponential delay.
- `4xx` validation — read the `code` and `message` in the response body and fix the request shape before retrying.
