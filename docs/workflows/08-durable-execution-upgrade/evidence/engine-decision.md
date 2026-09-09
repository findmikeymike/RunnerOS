# ADR P-01 — embedded SQLite and recorded continuations

Revision r2 · 2026-09-09 · Isolated prototype only. Current source `6c631f8ad35cd954641905b14e077bdd3fbf60e9`. SHA-256 of sorted prototype relative paths + NUL + file bytes: `480f400254395a3ae9c0e36511539963b371f6b3def5c45785292a47776aa8ce`.

## Decision

Select **embedded SQLite** for the P-02 foundation behind a narrow transaction/continuation API. Retain WorkflowRunner and existing model bridges. P-01 proves the local protocol on Bun and packaged Electron; it is not a production engine. Do not import the synthetic interpreter into the app.

Measured runtimes: Bun 1.3.13; Electron 44.2.0 / Node 24.20.0 / SQLite 3.53.4. Use the existing Bun/Node constructor selection. No dependency/service installed.

## DBOS comparison

Official TypeScript guide explicitly requires Postgres: https://docs.dbos.dev/typescript/programming-guide (checked 2026-09-09). This fails the amended embedded-desktop prerequisite. Python DBOS remains a separate optional lane. Rejection is documentation/prerequisite-based, NOT executable comparison or failed correctness testing. No Postgres installation or Python rewrite is warranted.

SQLite leaves identity, durable model/tool barriers, permission/cancel fences, retries, migrations/backup and provider reconciliation as our correctness responsibilities. It does not make external actions exactly once.

## D-02 / D-03

Production location must be a versioned private directory under the Artist OS config root via existing identity helpers, never synced workspace content. Prototype accepts only marked temporary artist-os-durability directories. Final basename/schema is T-04 work; no production DB exists.

First candidate product route: Pi awaited **core-agent subscriber**, with prefetch disabled or journaled, and explicit model-turn restoration. Current AgentSession forwarding is not an awaited storage barrier. Exact source evidence is in T-01. Claude/Codex SDK loops, dynamic/opaque tools and Python paths stay unsupported until instrumented/certified. This proof uses a synthetic turn.

## D-05 early payload contract

Require authenticated encryption bound to workspace/run/schema, immutable payload versions and separately protected keys. Key loss/unavailability pauses recovery: no replacement key or regenerated transcript. Events/logs carry minimal nonprivate metadata. Retain replay-critical payloads while descendants can resume; expire eligibility before pruning bytes.

P-01 proves AES-GCM round-trip/key-loss behavior using externally supplied disposable keys. T-04 must implement a secure key-provider boundary backed by existing OS-secure-storage facilities where available; a runtime lacking adequate key protection cannot admit sensitive v2 work. Existing credential hardware fallback is not automatically certified for replay payloads. Product key integration/retention enforcement must be tested before production schema acceptance. P-05 audits these decisions, rather than first designing them.

## Next integration constraints

Preserve required budget/child guarantees even with combined tables. Paid calls need persistent reservations first; children need stable admission first. Certify each dispatch including dynamic tools and child paths. Never switch admitted v2 work to legacy. A safe real provider proof belongs in P-03; production integration and broad release certification remain later gates.
