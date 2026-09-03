---
status: review
owner: fable
reviewed: 2026-09-02
target: commits 5c140bcfd..cc2ea5b52 (merge-base 4ce41b857), merged at 0c39638e3 on codex/artist-os-licensing
spec: ../creator-command-center/35-social-video-repurposing-spec.md
---

# Fable Review — Guided Social Variant Sets (Spec 35)

## Verdict

**Do not ship yet. The middle is strong; both ends leak.** The host-owned
Variant Set is genuinely well built — revision fencing under a cross-process
lock, a TOCTOU-hardened import (`O_NOFOLLOW`, dev/inode recheck, `O_EXCL`,
temp+rename), source re-hashing at three points, a hard render ceiling with a
parser backstop, host-minted `requestedBy`, and tools gated by agent slug and
bound to the set's editor session. The user's Create click really is the only
authorization to render, and I found **no path that posts without the exact
host-minted approval**.

What is not yet true is the spec's own integrity promise. Six findings block:
two are rights/identity holes on the human "Use this version" path, two are
scope holes in what the agent may record or read, and two are the editorial
gate not actually gating. None is large.

| Check | Result |
| --- | --- |
| Tests (outputs, release-kit, social-variant tools, rpc, launch helpers) | 130 pass / 0 fail |
| Typecheck (shared, server-core, session-tools-core, electron) | 0 errors in all four |
| Mutation probes | render ceiling removed → **no test fails** (parser backstop still holds); Trial filter removed → **no test fails**; source-drift check removed → 1 test fails (start path only) |
| Merge integrity | `0c39638e3` preserves both the automations hardening and this feature; verified at HEAD |

Note on method: the two-dot range across the branch fork shows unrelated
removals. Everything below uses the merge-base diff and files at HEAD.

## Blocking

### V1. Revoked source rights do not reach "Use this version"
`apps/electron/src/renderer/components/app-shell/ReleaseKitPage.tsx:195-227`
`packages/server-core/src/handlers/rpc/scheduled-work.ts` (authorize checks the snapshot only)

The agent path fails closed: `listUsable` calls `assertPinnedSourceCurrent`,
which refuses `blockedFromUse` / `needsRightsClearance` /
`artistLikenessRestricted` sources. The human path does not. "Use this
version" checks state, asset id, and hash, then calls `promoteToReleaseKit`,
which creates a snapshot with **clean default restrictions**. Every downstream
gate reads that snapshot. Scenario: sample clearance falls through, the artist
flags the final "Needs rights clearance", Social Publisher correctly refuses,
the artist clicks "Use this version" in the Variants tab, and the post goes out
with a real receipt.

Fix: one host RPC owns the ordered operation the spec describes — re-hash,
`assertPinnedSourceCurrent`, snapshot, copy the source's restrictions onto
the snapshot, then authorize. The renderer should not compose these steps.

### V2. Destination intent (exact profile, role, Trial) lives only in renderer state
`ReleaseKitPage.tsx:115, :857-860, :876-882, :905-908`

`selectedVariantPostIntent` is set by the "Use this version" effect and cleared
when the drawer closes. The snapshot is an ordinary `video` Release Kit item
that also appears under **Finals**; opening it from there constructs the
drawer with `initialPostIntent = null`, so the profile filter is unfiltered
(a fan-page variant can be scheduled to the primary account) and the Trial
refusal is skipped (an Instagram Trial variant publishes as a normal Reel).
Nothing host-side checks intent at authorization — `scheduled-work.ts` has no
reference to trial, role, or intent.

Fix: persist `socialVariantIntent` on the Release Kit snapshot at promote
time and enforce platform, exact profile, and Trial at
`AUTHORIZE_RELEASE_KIT_SOCIAL`.

### V3. `record_social_variant_result` accepts any in-workspace video, including restricted media
`packages/server-core/src/outputs/SocialVariantSetService.ts:282, :575-584`

Containment is to `workspace.rootPath`, which contains the Vault (`vault/`)
and the Release Kit. Source selection refuses `usableByAgents: false` Vault
assets and restricted finals; recording applies neither. The editor agent can
point `filePath` at a private Vault video or a blocked final; the host copies
it into the set, stamps it with the lineage of an unrelated cleared source,
shows it in Canvas, and `listUsable` hands it to Social Publisher (the
restriction recheck validates the pinned source, never the recorded bytes).
The copy mechanics are excellent; the scope is wrong.

Fix: require `filePath` under the set's own output directory or the editor's
render directory, and reject anything under `vault/` or the Release Kit.

### V4. `list_usable_social_variants` is not bound to the session's workspace
`packages/server-core/src/sessions/SessionManager.ts:8585-8598`
`SocialVariantSetService.ts:466-470`

The agent-supplied `campaignId` is used as the workspace id and only checked
for self-consistency. The repo already has the correct gate
(`resolveCampaignReadTarget`, :8379) and Social Publisher is not in its
allowlist, yet this tool bypasses it. A Social Publisher session in Campaign A
can enumerate Campaign B's variant titles, hooks, hashes, asset ids, and bound
profile ids.

Fix: `if (input.campaignId !== managed.workspace.id) throw` unless the
caller is HNIC, mirroring the existing helper.

### V5. The editorial gate passes near-full-source and near-duplicate edits
`tools/raw-video-editor/bin/repurpose.mjs:60-71, :316-320`

`hasMeaningfulTimelineChange` ORs three checks. For any source over 15 s the
opening-shift threshold is a fixed 1.5 s, so a single segment `[1.5, 60]`
— 97.5 % of a 60 s source — sets `openingShift = true` and the ≤85 % check is
never consulted. Returns `ready`, no warning. Separately, the duplicate
signature uses `toFixed(2)`, so shifting both endpoints by 0.01 s turns the
hard-duplicate error into a warning while overlap stays at 0.9998. Both
reproduced by execution against the real exported validator. The README this
commit rewrote claims the opposite.

Fix: require the ≤85 % reduction (or a reorder) *in addition to* an opening
shift; compare segment sets by overlap ratio, not string signature.

### V6. The host never sees the editorial gate at all
`SocialVariantSetService.ts:257-300` vs the tool's `variant-manifest.json`

The tool's `meaningfulDifference`, `assessmentBasis`, `sourceSegments`,
`transformations`, and `renderStatus` are never read by any host code — grep
finds zero production hits. Slice 1's "map the manifest into the typed host
contract" is satisfied only by asking the agent, in prose, to re-type fields
into `record_social_variant_result`. The host's own integrity test is three
checks: inside workspace, hash ≠ source, hash ≠ another ready variant. **A
one-byte-different re-encode of the full source passes all three.** Combined
with V5 the "refuses cosmetic-only copies" promise has no enforcement point.

Fix: have `record` accept the manifest path (or its fields), verify the
render came from the tool, and refuse unless `meaningfulDifference` passed.

## Should fix

- **Kickoff prompt interpolates source titles and `labelSnapshot` raw**
  (`release-kit-repurpose.ts:79-91`). The older, now-dead builder in the same
  file used `JSON.stringify`; the live one does not. `labelSnapshot` derives
  from a scraped account handle and `promote_to_release_kit` titles are
  agent-writable. Use the house envelope.
- **Kickoff wording grants too much on a Trial set.** "Do not publish,
  schedule, spend money, or use Instagram Trial unless the exact intent above
  explicitly requests it" — for a Trial set the intent *does* request Trial,
  and the sentence groups publish/schedule/spend under the same "unless". The
  Continue prompt gets it right; make this one unconditional.
- **Snapshot fires on the "Use this version" click, not at confirmation.**
  If the artist backs out, or scheduling fails, an unused `social-variant`
  item is left in Finals with only a toast — the spec's "Not scheduled"
  state is never reported.
- **`setPendingReleaseKitOutput` carries no target campaign id** and is set
  before the awaited workspace switch, so a racing Release Kit page can
  snapshot into the wrong campaign.
- **Archive-while-scheduled guard is dead code.** `scheduledWorkOrderIds` is
  only ever written as `[]` (`:329-331`); `releaseKitItemId` is never written.
  So the guard at `:392` cannot fire, the Variants tab can never show
  Scheduled or Posted from the record, and Revise cannot find a snapshot. The
  spec says these are references derived fresh — but they still have to be
  written.
- **Duplicate-schedule protection fails open** when the snapshot join is
  sha-only and the item is missing (`:507-516`): `uses = []` → "ready to use".
- **A successful record erases a durable `source-unavailable` attention**
  (`:227`, `:350`), and drift found at record time throws to the agent without
  marking the set `needs-attention` (`:275`).
- **Replacing an archived variant overwrites its record** and orphans the old
  asset, which is still promotable by asset id (`:360` filters on the new id).
- **Orphaned editor session on failed creation.** `SocialVariantSetupDrawer`
  opens the Raw Video Editor session (`:145`) before creating the set
  (`:156`); any throw leaves an empty session behind.
- **The drawer resets all input when `sources` changes**, and
  `OutputsListPanel` memoizes on `[outputs]`, which refreshes on every
  `outputs:updated` broadcast — a background agent creating any Output wipes
  the form mid-setup.
- **`hasMeaningfulTimelineChange` crashes the CLI** on a brief where one of
  several variants has `segments: []` (`:316-317` dereference outside the
  try/catch); no manifest is written.
- **Reimplemented security helper, weaker than the original.**
  `assertWorkspaceFile` / `copyVerifiedWorkspaceFile` duplicate
  `packages/shared/src/workspaces/verified-copy.ts` (`verifiedCopyFileSync`,
  `assertPathWithinRealRoot`), which additionally rejects symlink components
  below the root, fsyncs, and re-verifies after copy. Use the shared one.
- Third `hashFileSha256` in the repo; `ReleaseKitService.ts:322` now calls the
  sync one on video assets (whole file in memory) while the new path streams.
- Drawer hardcodes `12` and `5`; the exported `SOCIAL_VARIANT_MAX_*`
  constants exist and `MAX_PER_SOURCE` has zero usages.
- `list_usable_social_variants` has no `mode` filter, so Trial variants come
  back in a standard query, distinguishable only per row.
- `buildReleaseKitRepurposeKickoff` / `buildVaultRepurposeKickoff` and their
  helper (~49 lines) have no non-test callers; two tests exercise only dead
  code, and one of them is the only test mapped to "existence of a variant
  never authorizes publication."
- `tools/raw-video-editor/package.json` has no `test` script and
  `repurpose.test.mjs` imports `bun:test` — confirm CI actually runs it.

## Spec deviations worth a decision

- **Account roles are per-request, not per-profile.** The drawer asks the
  user to choose a role each time (an explicit select, never inferred — good).
  The spec says connected profiles gain one editable, persisted role. Every
  set re-asks, and nothing stops the same profile being "fan page" in one set
  and "primary" in the next.
- `list_usable_social_variants` only ever yields `ready-to-use` under the
  default `unscheduledOnly`; the scheduled/posted branches are unreachable
  from the tool.

## Verified correct

- No unapproved-post path. Keep, Archive, Revise never touch posting state.
  Every social order still needs the host-minted `ScheduledSocialApproval`.
- The agent has no create/start/archive/rebind tool; those are RPC-only with
  `requestedBy` minted from the client id. The user's click is the
  authorization.
- Tools gated by slug at both filter and callback: get/record →
  raw-video-editor only, bound to the set's `editorSessionId` and the session's
  own workspace; list → concierge or social-publisher.
- Render ceiling holds through `replaceVariantId`, repeated
  `destinationIndex`, and `ready` sets; the parser also bounds per-source
  counts.
- Every mutation under the workspace lock with a revision fence; concurrent
  start test proves the lost-update case; writes are temp+rename.
- ffmpeg is invoked with argument arrays only; overlay text goes through
  `textfile=`; aspect, grade, crop, and threshold are allow-listed or clamped;
  the source is only ever an `-i` input.
- Trial is never preselected and is explicit in the intent; `listUsable`
  requires `trialRequested === true` for trial variants.
- Kickoff prompts say "Do not publish, schedule, spend money, or use
  Instagram Trial unless the exact intent above explicitly requests it" and
  contain no completion-implying language.
- Scheduled and Posted state is derived from canonical orders and receipts,
  never copied.

## Tests: what 130 green proves

Acceptance criteria: 6 of 20 verified, 9 partial, 5 with no test. The whole
renderer layer (drawer, preview, Variants tab, detail handoff) is covered
only by source-string greps in `artist-os-chrome.test.ts:379-405`, which pass
with the components logically broken. The three most consequential guards
are untested on the paths that matter: the render ceiling via `recordResult`,
the Trial filter in `listUsable`, and source re-hash at record and list time
(only `start` is covered).

## Suggested order

1. V3 and V4 (scope) — two small guards, both one-line shape.
2. V1 and V2 together — one host RPC for "Use this version" that re-checks
   rights, snapshots with inherited restrictions, persists intent, and
   enforces it at authorize.
3. V5 and V6 together — fix the gate math, then make the host actually
   consume the gate's verdict.
4. Write `scheduledWorkOrderIds` / `releaseKitItemId` so the dead guards and
   the Variants tab states come alive.
5. Replace the duplicated copy helper with the shared one.
6. Tests for the three untested guards and one render-level drawer test.
