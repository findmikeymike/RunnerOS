# Readiness and setup

No new Spotify integration, browser Spotify login, paid data vendor, cloud database, OAuth app, or permanent custom agent is required for this upgrade.

| Setup | Owner and proof | Earliest dependency |
| --- | --- | --- |
| S01 Existing research tool route | Implementer verifies selected configured model plus safe public search/open capability, authenticates only if existing source requires it, records actual tool IDs and response receipts. Tool visibility alone is insufficient. | T02 live thin slice |
| S02 Intended artist seed fixture | Product owner provides or designates one artist name and official links for live acceptance; no private credentials in packet. Local synthetic same-name fixtures are independent. | T06 live acceptance |
| S03 Canonical app acceptance | Implementer builds verified Artist OS checkout; user authorizes restart only if needed under standing rule. Record build/commit/profile identity. Disposable profile is default for destructive/ambiguity tests. | T06 live UI check |

S01 is planned, not verified: repo confirms runner interfaces, but this specification did not run paid research or sign into a source. A missing source cannot be solved by silently installing/buying another provider. Continue local schema/UI tests meanwhile. Ask for only the existing connection repair needed when implementation reaches live verification.

Implementation staffing: main implementer owns integration; a bounded available agent can map data/UI; a separate available reviewer checks plan and completed changes. The existing activation_ui and activation_storage agents successfully performed read-only code mapping for this packet; role-specific model availability is not assumed. Use the build-specs skill for planning, repository test tools for execution, and available browser/Electron tooling for live acceptance. No plugin installation is planned.

Research evidence and integration decisions are in source-decisions.md. New enrichment excludes Spotify content retrieval; using its URL as an identity seed is distinct from downloading analytics. Existing Pulse integration is retained, not re-audited for provider terms here. Dates/figures from independent press remain attributed historical claims. Do not present historical milestone coverage as current monthly listeners.

Proposed latency acceptance: START returns persisted run acknowledgment within 2 seconds on a local fixture without waiting for the model; navigation/editing remain usable throughout. Research completion has a 15-minute bounded deadline, not a guaranteed provider response time. Measure bytes, page counts and model usage; don't publish invented dollar estimates. Model/source charges use existing configuration and allowances; a click does not authorize unrelated spending or external writes.
