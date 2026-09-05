---
status: draft
owner: agent
last_verified: 2026-09-05
source_of_truth: true
---

# Memory And Context Upgrade — Survive Real Usage

What it takes to turn today's memory + context layer into one that stays accurate
when a working artist has years of catalog, dozens of campaigns, hundreds of
contacts, and thousands of sessions in it.

Every claim in §1–§3 was verified by reading the cited symbol or by measuring a
real profile on disk. Where a number is an estimate it says so.

Read [`README.md`](./README.md) first for why memory is markdown. This spec does
not overturn that decision — it extends it.

## Implementation status (2026-09-05)

| Slice | Status | Commit |
|---|---|---|
| A — on-demand context delivery, `deliveryAlwaysFor`, slug-pinned system policy | **shipped** | `fb9337ea3` |
| B — memory/context injection caps, `recall_memory` excerpts, event-log rotation | **shipped** | `b21be6665` |
| C — `SESSIONS.md` end to end: store, write trigger, prompt injection, `recall_session` | **shipped**; UI "Past" tab still pending | `a52aa419b`, `5429b7158`, `bc7048f95`, `56201255f` |
| D — campaign provenance on memory | **shipped** | `c01f90427` |
| E — stemming (step 1) | **shipped**; FTS5 (step 2) still gated on entry counts | `70356dd14` |
| F — entity links + join | not started | |
| G — semantic recall (gated) | not started | |

Review fixes landed alongside (see §7): the chat-launch path now passes
`artistWorkspaceScope` — Slice A had made the heuristic fallback unreliable, so
a chat-launched campaign worker could lose the asset contract; both stores now
refuse to write back a file that did not fully parse, closing a silent-data-loss
path on hand-edited files that predates this work; and a zero memory budget
still reports that memory exists. A second review pass (`5429b7158`) then found
the sessions-log serializer writing files its own parser could not read — a
markdown rule in a summary truncated the entry, and a crafted summary could
inject a phantom one — plus an archive path that silently dropped unparseable
entries; all closed, with the parser now mirroring memory's fence tracking and
frontmatter check rather than merely claiming to.

Corrections to earlier assumptions, found while building: `compact_boundary`
carries no summary text, so [`05-sessions-log.md`](./05-sessions-log.md)'s "capture
the compaction summary" trigger does not exist — session titles, already
model-generated, are the cheap source to reuse instead. And `trustedWorkerTools`
is an auto-approval list, not an availability gate; both context tools are
available to every agent without approval, which is what makes Slice A safe.

## 1. Problem

The memory *store* is fine. The **injection policy** is what breaks at scale, and
it is already breaking.

### 1.1 Context is 25× memory and uncapped

Measured on the `~/.artist-os-dev` profile — a development profile with almost no
real artist data:

| Workspace | Context docs | Tokens injected **every turn** |
|---|---:|---:|
| `my-workspace` | 11 | **~18,895** |
| `boop` | 7 | ~9,793 |
| `cnady` | 6 | ~4,170 |

One `CONTEXT.md` in that profile is 43,507 bytes — **~10,876 tokens on its own**.
Total memory across all agents in the same profile is ~750 tokens.

The cause is one default. `shouldInjectContextDoc`
(`packages/shared/src/workspace-context/storage.ts:436-447`) resolves delivery to
`'always'` for every agent **except the Concierge**:

```ts
const delivery = doc.slug === 'artist-network'
  ? 'on-demand'
  : doc.metadata.delivery
    ?? (normalizedAgentSlug === CONCIERGE_SLUG ? 'on-demand' : 'always');
```

Its own doc comment says the Concierge is exempted *"to prevent context bloat."*
The diagnosis is already in the codebase; only one agent got the cure. Of 11
generated artist-context slugs, exactly **one** (`artist-network`) is `on-demand`.

### 1.2 Nothing caps memory injection either

`buildMemorySectionsText` (`packages/shared/src/memory/render.ts:79-91`) renders
every active entry in full — no count cap, no token budget, no truncation. The
"inject the most recent 50" strategy in
[`04-implementation-plan.md`](./04-implementation-plan.md) is **not implemented**.

So at the Tier-2 trigger this project already set for itself (200 entries / 25k
tokens per agent) **no code path changes behavior**. The system keeps growing the
system prompt until the model's context window truncates it — silently, from
whichever end the provider chooses.

### 1.3 Projection

Estimate, flagged as such. A working artist with a full profile, 4–6 live
campaigns, recurring Spotify/Instagram snapshots, and a populated release board
plausibly reaches 20+ context docs. At today's average that is 35–60k tokens of
context, plus up to 30k of memory at the Tier-2 trigger. That is most or all of a
context window consumed before the artist types anything.

**The first thing that fails at scale is not recall accuracy. It is prompt
budget.** Recall accuracy is the fourth problem (§1.4), behind prompt bloat,
missing session history, and scope bleed.

### 1.4 Recall has a real defect today, independent of scale

Recall is lexical (`packages/shared/src/memory/recall.ts:100-144`): field-weighted
token hits, a phrase bonus, and a recency step. There is no stemming, so an
inflected query returns **zero results**, not merely worse ranking — `scoreEntry`
returns `null` when nothing matches (`recall.ts:132`).

Probed against the real `rankMemoryEntries`:

```
"playlist"   -> playlist-strategy(26)     "playlists"  -> *** NO RESULTS ***
"release"    -> release-cadence(24)       "releases"   -> *** NO RESULTS ***
"ships"      -> release-cadence(15)       "shipping"   -> *** NO RESULTS ***
```

An artist asking "what are my playlists notes" gets nothing.

## 2. What memory does and does not remember today

Verified answers, because this is the question that actually gets asked.

| Question | Answer | Why |
|---|---|---|
| Does an agent remember **facts** across threads? | **Yes** | Path is `<agentsRoot>/agents/<slug>/MEMORY.md` (`memory/storage.ts:62-66`) — no session id. Injected into every future session of that agent. |
| Does it remember **what was discussed** last week? | **No** | `SESSIONS.md` is specified in [`05-sessions-log.md`](./05-sessions-log.md) and has **zero code references** anywhere in `packages/` or `apps/`. |
| Can one agent see another's memories? | **No** | `MemoryScope = 'user' \| 'agent'` (`memory/types.ts:16`). Only `USER.md` is broadcast. |
| Does memory cross HQ ↔ campaign? | **Yes — and that is a defect** | No workspace segment in the path. See Slice D. |

Consequence worth stating plainly: **the north-star demo in
[`README.md`](./README.md) cannot work today.** It promises *"You shipped
workflows phase 2 yesterday…"* drawn from `MEMORY.md` **and `SESSIONS.md`**. The
second source does not exist. Artist Manager will remember that the artist prefers
concise captions; it cannot remember that Tuesday was spent arguing about a
release date. For a *manager* persona, the second kind is most of the job.

## 3. The graph question, answered

The intuition is correct: the same person really does appear as a network contact,
a community subscriber, a job's counterparty, and the subject of past work. That
is relational, and today nothing connects those appearances.

**But a graph engine is the wrong purchase, because the relational substrate
already exists:**

| Entity | Stable identity today | Where |
|---|---|---|
| Network person | `id: "person-<base36>-<rand>"` | `artist-context/network.ts:39,179` |
| Community contact | `emailHash` + `SharedEntityMeta` id | `community/types.ts:9-13` |
| Generic records | `collection` + `entityId` addressing | `records/storage.ts:162-173` |
| Outputs / orders / campaigns | ids throughout | — |
| **Memory entry** | **no link field at all** | `memory/types.ts:32-39` |

Everything has an id except memory, and nothing indexes across them. That is a
**missing join**, not a missing graph database.

SQLite is a relational engine. A join table over ids that already exist answers
"show me everything about this person" — their network record, the community rows
sharing that email hash, jobs naming them, outputs referencing them, and memories
linked to them — without Neo4j, Kuzu, a server, or a subscription. Multi-hop
traversal is a recursive CTE, which SQLite supports natively.

**Verdict: build the join, not the graph.** Revisit a real graph engine only if a
concrete question emerges that a recursive CTE genuinely cannot answer. None has
been named yet, and a graph engine would cost the file-readability that is the
product promise.

## 4. Principles

Constraints this spec will not trade away.

1. **Markdown stays canonical.** Any index is a *derived cache* — deletable and
   rebuildable from the files at any time. If the index and the files disagree,
   the files win.
2. **No server, no daemon, no cloud, no recurring cost.** Everything runs
   in-process and offline.
3. **No LLM call per write on the read path.** Fact reconciliation (§6.1) is a
   separate, explicitly-gated product decision, because it costs money and latency
   per memory written.
4. **Relevance beats volume.** An agent handed ten documents it did not ask for is
   worse at finding the relevant fact than one handed two. Context dilution is a
   real accuracy loss, not just a token bill.
5. **Bounded by construction.** Every injected section gets a budget and a
   documented behavior on overflow. Silent truncation by the provider is not an
   overflow strategy.

## 5. Slices

Ordered by what fails first. A–D are the ones that matter at scale; E–G are
accuracy work that is wasted effort until A–D land.

### Slice A — Stop injecting everything (highest value)

Flip context-doc delivery from opt-out to opt-in.

- Change the fallback in `shouldInjectContextDoc` so `'on-demand'` is the default
  for **all** agents, and mark the small set that must always be present with an
  explicit `delivery: 'always'`.
- Everything else stays reachable through the existing `list_workspace_context` /
  `get_workspace_context` tools. No new machinery — the Concierge already works
  exactly this way.
- Every agent must keep a listing tool, or on-demand becomes invisible.

**Decided (2026-09-05).** The always-on set:

| Doc | Delivery | Note |
|---|---|---|
| `artist-profile` | `always`, every agent | who the artist is |
| `artist-voice` | `always`, every agent | how they sound |
| `mission-brief` | `always`, current workspace | what this campaign is for |
| `artist-branding` | `always` **for visual/creative agents only**, `on-demand` for the rest | see below |
| everything else | `on-demand` | reachable via `get_workspace_context` |

**`artist-branding` needs one small schema addition**, because per-agent delivery
is not expressible today:

- `ContextDocDelivery = 'always' | 'on-demand'`
  (`workspace-context/types.ts:36`) is a flat scalar — one value for all agents.
- `ContextDocRouting` (`types.ts:32-34`) *is* per-agent, but it governs **access**,
  not injection. Setting `routing: { mode: 'targeted', agents: [...] }` on branding
  would make it **invisible** to every other agent — strictly worse than the
  problem, since a writer should still be able to *ask* for branding.

Minimal, backward-compatible fix — an exception list beside the scalar:

```yaml
delivery: on-demand          # default for everyone
deliveryAlwaysFor:           # …except these, who get it injected
  - art-director
  - video-director
  - hypermotion-agent
  - lottie-animation-agent
  - scroll-stopper
```

A missing `deliveryAlwaysFor` behaves exactly as today, so no existing doc
changes. `shouldInjectContextDoc` gains one membership check. The agent list above
is a starting guess and should be confirmed against the real visual roster before
implementation — the *mechanism* is the decision here, not the membership.

Expected effect on the measured profile: ~18,895 → roughly 2–4k tokens per turn,
with the rest one tool call away.

### Slice B — Budget every injected section

- Memory: implement the planned "most recent N" cap, N configurable, default 50.
  On overflow, inject the newest N and state in-section that older memories exist
  and are reachable via `recall_memory`. Never truncate silently.
- Context: per-doc and total byte caps for `'always'` docs, with the same explicit
  overflow note.
- Fix the related honesty bug: `recall_memory`'s description says *"Search durable
  memory without bloating the prompt"* (`tool-defs.ts:1655`), but the handler
  returns full bodies for up to 25 entries **plus** a duplicate 220-char excerpt
  (`SessionManager.ts:701-712`). Return the excerpt by default and full bodies only
  on request.
- Rotate `.memory-events.jsonl` (`memory/storage.ts:565-589`). It is append-only
  with no pruning and now writes one line per recalled entry per call plus one per
  injected entry per launch — the busiest writer in the system.

### Slice C — `SESSIONS.md`, the missing half of memory

Build what [`05-sessions-log.md`](./05-sessions-log.md) already specifies: a
per-agent chronological log of session summaries, written on compaction or session
end, separate from `MEMORY.md` (durable facts).

This is what "remember our past sessions" actually means, and it is the difference
between an assistant that knows facts about the artist and one that knows the
story so far. Inject only a bounded recent slice; the rest is searchable.

### Slice D — Campaign provenance on memory

Agent memory is global per agent, so a fact saved while working Campaign A appears
verbatim in Campaign B and in HQ, with nothing marking where it came from. Some
memories genuinely are career-wide ("the artist's voice is dry and understated");
others are release-specific ("this single's rollout leads with the B-side"). Today
there is no way to tell them apart.

**Decided (2026-09-05): stay career-wide, add provenance.** Memory remains global
so an agent never looks forgetful — a fact learned in a campaign is still there in
HQ. But a memory written inside a campaign records *where and when*, and the agent
judges currency from that:

> If this reads as artist ethos or core preference, treat it as current. If it
> looks scoped to one campaign or to a moment, be aware it may no longer hold.

Rejected alternative: campaign-scoped-by-default with promotion. It prevents
pollution but makes the agent appear to forget things the artist just told it,
which is a worse trust failure than staleness.

**Provenance must be structured, not prose.** A free-text hint only reaches the
model, and "the model will notice" is exactly the silent-drift failure
[`README.md`](./README.md) rejects when it rules out implicit memory. Structured
origin can also drive Slice B's cap and Slice E's ranking:

```yaml
origin:
  scope: campaign          # or: hq | lab
  workspaceId: <id>
  label: Neon Nights       # human-readable, for the rendered hint
  writtenAt: 2026-03-14
```

Rendered into the prompt as a short provenance line on campaign-origin entries
only — HQ-origin memories read exactly as they do today, so nothing gets noisier
for the common case.

Two pieces of machinery already exist and should be used rather than rebuilt:

1. **`expires` is fully built** — settable through `save_memory`, validated as
   `YYYY-MM-DD` (`handlers/memory.ts:97-100`), and filtered before injection
   (`memory/render.ts:39`). Genuinely momentary facts ("holding the announce until
   the master lands") should set it at write time and disappear on their own.
2. **`MemoryEntryType` already separates ethos from work** — `user` and `feedback`
   are almost always career-wide; `project` is where release-scoped facts live
   (`memory/types.ts:18`). Combining `type` with `origin.scope` gives a strong
   currency signal with **no new classifier and no LLM call**.

**Honest consequence:** this is the accumulating option. Provenance makes old
facts *legible*, not absent — after six campaigns the store still holds six
campaigns of detail. That makes Slice B's injection cap load-bearing rather than
optional, and the cap must rank on more than recency: career-wide `user`/`feedback`
entries should outrank `project` entries whose origin campaign is finished. Those
stay fully reachable through `recall_memory`; they just stop consuming the
always-injected budget.

Migration: entries without `origin` are treated as HQ-scoped, which is what they
effectively are today. No backfill required.

### Slice E — Fix recall accuracy (cheap, do with A–D)

Two steps, in order:

1. **Stemming in `tokenize()`** — ~20 lines, no dependency, no index. Fixes the
   §1.4 zero-result bug immediately.
2. **SQLite FTS5 index over the markdown**, when entry counts justify it. Verified
   working: with `tokenize='porter unicode61'`, all eight probe queries resolve,
   including `shipping` → `release-cadence`, which today's recall misses entirely.
   Cost is **0 MB** — `bun:sqlite` ships it, and the repo already has the
   dual-runtime pattern (`bun:sqlite` in Bun, `node:sqlite` in Electron/Node) at
   `packages/shared/src/agent/escalation-store.ts:11`.

Files stay canonical; the index is derived (§4.1).

### Slice F — The join (the useful part of "graph")

Add optional `links: string[]` to `MemoryEntry` (`memory/types.ts:32-39`) holding
qualified entity references — `person:person-abc123`, `campaign:<id>`,
`output:<id>`, `contact:<emailHash>`. Absent field = today's behavior, so this is
backward compatible.

Index those links in the same SQLite database as Slice E, as a join table. That
enables one genuinely new capability: **"everything we know about this person"** —
network record, community rows on that email hash, jobs naming them, outputs
referencing them, and every memory linked to them, in one query. Multi-hop is a
recursive CTE.

Ship the links and the join before considering any graph engine. This is the
relational payoff at near-zero cost.

### Slice G — Semantic recall, gated

Only when FTS5 + stemming demonstrably misses real queries — paraphrase, not
morphology. "streaming numbers" failing to find a note that says "Spotify plays"
is the failure mode that justifies it.

`sqlite-vec` (~1–2 MB per platform) over the same index, vectors pointing back to
file + line, embeddings from a local quantized MiniLM (~23 MB of weights). The
real cost is the ONNX runtime — **but the app already bundles 254 MB of
`onnxruntime-node` for hypermotion**
([size audit](../size-and-performance/01-app-size-audit.md)). Sharing that runtime
rather than adding a second one is the difference between ~25 MB and ~300 MB, and
should be checked before committing to this slice.

Still offline, still no server, still no recurring cost.

## 6. Rejected, with reasons

Evaluated against this app's constraints: local-first, offline-capable, bundled
desktop, no Python runtime, no recurring cost, memory readable and editable by the
artist. Data fetched 2026-09-05; all five are actively maintained.

| Project | Stars | Blocker here |
|---|---:|---|
| **mem0** | 64.7k | Python core; an LLM + embedding call per write; memory becomes opaque vector rows |
| **cognee** | 30.5k | Python 3.10–3.14 — ruled out; defaults to an OpenAI key |
| **agentmemory** | 28k | Node-native and offline, but ships a pinned auto-downloaded native binary (hostile to a signed/notarized bundle); memory not editable files; 6 months old, 564 open issues |
| **hindsight** | 22.7k | Python; wants PostgreSQL + pgvector and a server process *even in embedded mode* |
| **MemOS** | 11.2k | Full stack is Docker + Neo4j + Qdrant; the offline path requires adopting another agent harness |

mem0, cognee, and hindsight are all open-source funnels to paid managed tiers —
exactly the "enterprise connection / extra cost" shape to avoid.

**Two ideas worth stealing rather than installing:** hindsight's "project onto disk
as markdown" stance (already the position here), and mem0's fact-level
reconciliation — see §6.1, which is deliberately *not* bundled into recall.

### 6.1 Reconciliation — named, not scheduled

Today memory is append-only: a contradicting fact is added beside the old one
rather than resolving it. Over years that is a real accuracy decay, and it is the
one capability mem0 has that markdown does not.

It is deliberately excluded from the slices in §5 because it requires an LLM call
per write — real money and latency on every memory — which is a product decision
about cost, not a retrieval improvement. Note also that `MemoryEventAction`
already carries a vestigial `'consolidate'` member and `MemoryEventSource` a
`'consolidation'` member (`memory/types.ts:109,116`) that nothing emits: the seam
was anticipated and left unbuilt.

Cheaper interim: surface *candidate* contradictions in the existing review queue
for the artist to resolve, rather than resolving them automatically.

## 7. Verification

- **Prompt-size regression test.** Assert a bounded token budget for a synthetic
  workspace with N context docs and M memory entries. This is the test that would
  have caught §1.1 and §1.2, and its absence is why both exist.
- **Prompt-path parity test.** `SessionManager.resolveAgentSessionOptions` passes
  `artistWorkspaceScope`; the renderer chat path does not
  (`apps/electron/src/renderer/lib/run-agent.ts:55-99`), so a chat-launched agent
  can silently lose its asset-contract section. A comment at
  `SessionManager.ts:2859-2863` explicitly claims the two paths produce the same
  prompt. **They do not.** Add a test asserting equality for identical inputs, then
  fix the drift.
- Recall: table-driven cases for singular/plural/inflected forms — the §1.4 probes
  become assertions.
- Index: a test proving a deleted index rebuilds from markdown with identical
  results (§4.1).
- Scope: a memory saved in Campaign A must not appear in Campaign B once Slice D
  lands.

## 8. Open decisions

1. ~~Which context docs stay `always`?~~ **Decided 2026-09-05** — see Slice A.
   Profile, voice, and mission-brief for everyone; branding for visual/creative
   agents only, which requires the `deliveryAlwaysFor` addition.
2. ~~Default memory scope inside a campaign?~~ **Decided 2026-09-05** — career-wide
   with structured campaign provenance; see Slice D. Follow-on, smaller: should the
   sidecar *suggest* an `expires` date when a fact reads as momentary, or only ever
   set it when the artist says so?
3. **Is `SESSIONS.md` per-agent or per-workspace?**
   [`05-sessions-log.md`](./05-sessions-log.md) assumes per-agent; the HQ/campaign
   split may argue otherwise. (Slice C)
4. **Is fact reconciliation worth an LLM call per write?** (§6.1)
5. **Can the hypermotion ONNX runtime be shared** if Slice G ever ships, or does a
   second one get bundled? Decides whether semantic recall costs ~25 MB or ~300 MB.
