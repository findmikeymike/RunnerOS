---
status: implemented
owner: agent
last_verified: 2026-09-03
source_of_truth: true
related: ../07-artist-vault-architecture-spec.md, 31-catalog-royalty-reconciliation-spec.md
---

# Artist HQ Legal & Deals Agent

## Purpose

Give independent artists a strong first read of music-business agreements before
they sign or pay an attorney. The worker explains the real economics, finds
missing protections, ranks negotiation priorities, and prepares questions or
suggested language for qualified counsel.

It is an issue-spotting and preparation tool. It is not a lawyer, does not form
an attorney-client relationship, and does not decide that an agreement is safe
to sign.

## Source grounding

This implementation adapts two MIT-licensed sources:

1. SoundDeal/dealscan at commit
   `5bef272b3392f6ed11b9d758b783cce785d6ec3f`: music-deal classification,
   universal economics, and focused playbooks for producer, single-song,
   publishing administration, distribution, artist/360, sync, and
   co-publishing agreements.
2. evolsb/claude-legal-skill at commit
   `bca0d2e9d5ec81298ddfbfde78fa4f38fb4589b0`: completeness checks,
   party-position review, clause evidence, missing-provision detection,
   internal-consistency review, and negotiation prioritization.

Both upstream projects disclaim legal advice. DealScan also labels its music
prompt packs as first drafts requiring domain review. Artist OS therefore uses
them as issue-spotting checklists, not authoritative law or verified market
benchmarks. The bundled skill carries source attribution and both MIT notices.

## User promise

Drop in a contract and say which side you are on. Legal & Deals returns:

- what the deal actually is;
- the key money, term, ownership, recoupment, control, and exit mechanics;
- important missing or unclear terms;
- the clauses that deserve attention first, with exact evidence;
- a practical negotiation list and questions for a music attorney.

## Scope

V1 supports:

- producer agreements;
- single-song assignments;
- publishing administration agreements;
- distribution and label-services agreements;
- artist recording and 360 agreements;
- sync licenses;
- co-publishing agreements;
- a generic music-contract review when classification is uncertain.

## Non-goals

- No legal advice, legal opinions, clearance decisions, or enforceability claims.
- No signing, accepting terms, filing, sending to a counterparty, or submitting.
- No mutation or replacement of the original agreement.
- No invented clause, term, quote, section number, market norm, or legal rule.
- No claim that a document is complete when pages, exhibits, or scans are unclear.
- No broad injection of private contracts into unrelated agent context.

## Product flow

1. The artist uploads or attaches a contract from Artist HQ.
2. The worker checks readability, pages, blanks, exhibits, and signature state.
3. It identifies the likely deal type and the artist's position. It asks only
   for material facts it cannot infer safely.
4. It loads one focused music-deal playbook plus the shared review method.
5. It extracts terms and findings with a short exact quote and location.
6. It distinguishes present, absent, unclear, and unreadable terms.
7. It produces a concise Canvas review and optional negotiation packet.
8. The original remains private in Vault. The review is saved as an HQ Output;
   optional archived review and negotiation files stay in the legal folders.

## Review contract

Every review must:

- name the document, parties, artist position, deal type, and draft/executed state;
- flag unreadable pages, blank fields, and missing exhibits before analysis;
- cover advance/fee, royalty/share, term, territory, options, ownership,
  recoupment/deductions, reversion/exit, accounting, audit, assignment,
  approvals, warranties, indemnity, and dispute terms when relevant;
- cite each material finding to actual text and a page/section when available;
- say `not addressed` when the agreement is silent;
- show what appears acceptable, not only what is unfavorable;
- separate document facts from interpretation and from questions for counsel;
- rank negotiation items as `must resolve`, `should improve`, or `understand`;
- provide an opening ask and, when useful, a fallback position;
- state uncertainty where text, law, jurisdiction, or market practice is unclear.

## Private storage

```text
vault/business/contracts/
vault/business/legal/reviews/
vault/business/legal/negotiation-packets/
```

All three Vault locations are private by default and omitted from broad agent
context. The canonical readable review is a workspace-local HQ Canvas Output,
not a file automatically written into the legal folders. The worker may archive
a review or negotiation packet there only when the user requests a file copy.

## Agent architecture

- Agent slug: `legal-agent`
- Display name: `Legal & Deals`
- Workspace: Artist HQ only
- Skill: `music-contract-review`
- Internal write capability: `create_output`
- External mutation capability: none

Artist Manager discovers the worker through the normal live agent catalog and
delegates agreement review when the user asks about a deal or attaches a
contract. Campaign and Lab workspaces do not activate it by default.

## Acceptance criteria

- The worker and skill are seeded and activated for new and existing Artist HQs.
- The worker is visible under a Legal & Deals category in HQ Workers.
- The skill bundles seven music-deal playbooks and the shared review method.
- Source provenance and MIT notices ship in the bundle.
- Contract and optional legal-archive folders are created and remain private in
  Vault context; the canonical review is an HQ Canvas Output.
- The attachment picker exposes Legal & Deals.
- Tests prove HQ-only activation, source files, evidence rules, and privacy.
- Shared typecheck and Electron renderer build pass.
- A cold rival review finds no unresolved high-impact issue.

## Delivery slices

1. Source inventory, provenance, and this implementation contract.
2. Shared review method and seven music-deal playbooks.
3. Legal & Deals worker, HQ activation, UI category, and private storage.
4. Focused tests, typecheck/build, rival review, and confirmed fixes.
