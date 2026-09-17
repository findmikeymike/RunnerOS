# Website Agent: HQ entry and Campaign sources

## Implemented

- Website Agent defaults to HQ; new Campaigns can add it from the library. Existing Campaign activations are preserved.
- Existing local HQs receive a one-time activation with an activation-file backup. Explicit deactivation, missing/deleted definitions, and customized definitions are preserved. No recurring reactivation.
- Website Agent can discover local Campaign IDs and request one Campaign's narrow release information, accepted Creative Direction, and ready, unrestricted, byte-verified Release Kit items. Private, disabled, malformed, or inaccessible context is withheld; draft Outputs are not included.
- `website_build` and `website_preview` accept a Campaign source ID. Destination remains the shared HQ website; preview Outputs stay in the requesting workspace. Campaign callers remain scoped to their own Campaign. Omitted Campaign source IDs enforce the same context checks as explicit IDs for website roles.
- Website Agent handles ongoing maintenance; Site Builder receives a bounded Campaign brief for substantial layout/build work. Prompt guidance is composed at runtime without overwriting saved agent instructions.
- Publication approval remains separate from accepted creative direction and asset readiness.

## Verification

- Focused registration, activation, context, prompt, tool filtering, callback, and provider tests pass.
- WebsiteService integration passes with temporary fixtures and a local preview server: Campaign artwork renders in the HQ site, Output remains HQ, Campaign website files remain unchanged, and restricted/tampered assets are rejected.
- Full repository typecheck and both main/renderer Electron builds pass.
- Independent review found an implicit-source access-check gap; fixed and verified with explicit/omitted source regression coverage.

## Status

Included in the September 17 canonical `main` commit. After the authorized restart, Website Agent was verified beside Site Builder in HQ. The new cross-Campaign path has not been live-tested in a model conversation. Existing Content Genius/category-order changes remain intact. No website published or real site content edited.
