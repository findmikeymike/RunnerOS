---
status: backlog
owner: product
last_verified: 2026-07-06
source_of_truth: true
---

# Google OAuth Production App

## Goal

Submit and verify a Runner-owned Google OAuth app so normal users can connect Gmail, Calendar, and Drive with a standard **Connect Google** flow instead of creating their own Google Cloud project and OAuth credentials.

## Why

The current setup works for development, but it is too painful for real users:

- create Google Cloud project
- enable Gmail/Calendar/Drive APIs
- configure OAuth consent screen
- create desktop OAuth credentials
- paste client ID/secret into Runner

Runner should own that setup once the product surface is stable.

## Scope

V1 production app:

- App name/branding approved for Runner.
- OAuth consent screen configured for external users.
- Google verification submitted for required scopes.
- Published OAuth client available to packaged app builds.
- Settings/Connections uses Runner-owned credentials by default.
- Developer/self-hosted mode can still override with user-provided credentials.

## Initial Scopes

Keep verification narrow:

- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.compose`
- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/drive.file`
- `https://www.googleapis.com/auth/drive.metadata.readonly`

Avoid `gmail.modify`, full Drive, or broad Calendar scopes unless a later feature truly needs them.

## Required Work

1. Confirm final Google feature surface and exact scopes.
2. Prepare privacy policy, support contact, app homepage, and demo video for Google review.
3. Submit OAuth consent screen verification.
4. Handle restricted Gmail scope review if required.
5. Store production OAuth client config safely for packaged builds.
6. Update setup UI/docs so normal users only click **Connect Google**.
7. Keep `.env.example` / source config override path for developers and self-hosters.

## Acceptance Criteria

- Fresh user can connect Gmail/Calendar/Drive without touching Google Cloud Console.
- OAuth consent screen shows Runner branding, not a user-created test app.
- Existing user-provided OAuth configs still work.
- Agents never receive raw Google tokens or client secrets.
- Docs clearly separate "normal user" setup from "developer/self-hosted" setup.
