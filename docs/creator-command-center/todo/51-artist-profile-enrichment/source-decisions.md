# Source decisions and authority

The latest user direction governs. These are faithful summaries of conversation decisions, not invented implementation approval.

| ID | Decision | Authority |
| --- | --- | --- |
| U1 | Artist input remains necessary for branding, themes, and fuzzy creative direction. Research belongs below those inputs, separately. | User, September 12–13 conversation |
| U2 | One enrichment button uses the stored Spotify link or asks when missing; supporting press/website links establish the exact person. | User; accepted flow clarified to make press optional |
| U3 | Avoid overlap: existing Spotify browser/Pulse capture already serves analytics. Verify agent consumption and reuse it. Spotify URL remains useful without browser login. | Latest user correction |
| U4 | Deep Research owns enrichment; browser supports it. Bounded pass, no extra plan approval. | Assistant proposal accepted by user continuing specification |
| U5 | Thorough spec, phased build, commit completed work; no new blanket approvals or blockers. | Standing explicit user instructions |

Derived proposals (not separately user-approved numbers): caps, stale thresholds, schema/RPC names, exact section label, and phase ownership below. They are concrete V1 defaults to review during implementation, not observed current behavior. Career & public context is the narrower label replacing the earlier brainstorm Career & audience research, because analytics ownership is now explicit.

Existing source files are pinned by SHA-256 in plan.json. Paths there refer to this repository baseline. Code describes what exists; older specs express intent and cannot establish implementation.

Research checked September 12, 2026:
- [Spotify Get Artist](https://developer.spotify.com/documentation/web-api/reference/get-an-artist): no monthly-listener field is documented. Do not infer public monthly listeners from streams, followers, or arbitrary reporting windows.
- [Spotify Developer Policy](https://developer.spotify.com/policy), III.13–14: restricts analysis and AI ingestion of Spotify Content. This upgrade does not add Spotify scraping/API ingestion into its research pass. Existing analytics behavior is a separate pre-existing integration, not certified by this spec.

The user-supplied Spotify URL can be normalized as an identity locator without fetching Spotify. Search the artist's supplied name, official site, and independent sources. A URL alone is not authorization to bypass a source's access controls. Source capability and permitted use must be verified for live retrieval; unavailable sources produce partial research rather than blocking unrelated career research.
