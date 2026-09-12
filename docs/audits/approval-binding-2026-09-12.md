# Phase 3: approvals surviving edits

Scope: existing approval boundaries in community email, social/browser handoffs,
website publishing, Gmail sends, and durable workflows. This work does not add
approval requirements to autonomous or trusted execution.

## Confirmed and repaired

1. **Community email could approve a newer draft than the one on screen.**
   The send RPC previously accepted a job ID alone. It now requires the reviewed
   revision and, where present, record hash. Save-before-send carries the exact
   record returned by that save. Stale saves also refuse to overwrite a newer
   revision. Commit: `dfeb8e65c`.
2. **Community sender/footer could change behind an open review.** The send
   request now includes the sender and footer values loaded into email setup.
   The server compares them with the resolved provider before approval. Existing
   setup controls refresh these values; the number of approval clicks is unchanged.
   Commit: `002526d6e`.
3. **Social dry-run action IDs did not bind most platforms' action content.**
   X, Instagram, TikTok, and YouTube now use the same externally captured action
   digest check as Spotify. Media contracts include file byte fingerprints and
   are verified before delegation. Captions, recipients, browser plans, or media
   cannot be changed while reusing the old approval digest. The scheduled caller
   translates its already-verified legacy contract into this format without
   requiring renewed user approval. Commit: `f24db55c5`.
4. **Website publish requests could replay a captured approval.** Publishing now
   matches the persisted approval under the existing publish lock, rechecks after
   adapter resolution, and consumes it before deployment. Older requests cannot
   clear newer approvals. Newly issued approvals have a nonce; existing approvals
   without one remain compatible. Trusted content publishing and previews retain
   their existing autonomous behavior. Commit: `9c8d40c73`.
5. **Gmail approval could refer only to a mutable remote draft ID.** The existing
   approval now displays a captured message and sends its exact MIME bytes via
   `drafts.send`, retaining draft-consumption semantics. The mailbox is pinned
   to the connected profile. Full/raw versions must agree before the preview is
   produced. Source aliases and JSON raw request bodies remain supported. Stop
   and handoff invalidate in-progress preparation; Pi can no longer interpret a
   missing send-approval handler as consent. Commit: `a545eaac1`.

   Google documents updating and sending a draft in the same `drafts.send`
   request in its [draft guide](https://developers.google.com/workspace/gmail/api/guides/drafts#send_drafts).
   The [profile endpoint](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile)
   supports the existing `gmail.compose` scope; this introduces no new OAuth scope.
6. **Printify file imports could change under an approved command.** Approval
   packets now capture the explicit import file's SHA256. Execution verifies
   that digest and passes a private, read-only snapshot to the native CLI,
   removing it afterward even if the child fails. Native global flags and input
   flag variants are covered. Stdin, dry runs, and private draft permissions keep
   their existing behavior. Commit: `d38f9bb50`.

## Healthy paths

- Workflow inputs and run definitions are captured before asynchronous admission.
  Durable approvals bind inputs, principal, policy revision, and credential
  identity and are validated again at dispatch. Targeted workflow and approval
  suites passed: 115 tests, 534 assertions. No workflow production changes needed.
- Scheduled social already binds its approved action, profile, caption, and media
  digest and avoids fallback after a possibly live submission. This audit retained
  those checks while repairing the downstream CLI contract.
- Website builds are checked against their artifact hash and deployed from a
  verified snapshot. Caller-supplied change classification cannot make a design
  change eligible for trusted content publishing.
- Shell-hook consent intentionally trusts the script identity and contents for
  an event across repeated invocations. Argument changes are not an exact-action
  approval defect under that documented policy. Adding argument-level prompts
  would change the autonomy contract, so this path was left unchanged.
- Ads operator is read-only and rejects attempts to claim a write-executed
  receipt; no executable approval-replay defect was found in that package.

## Limits and follow-up

- Hidden connection credentials and account replacement remain Phase 4 scope.
  The email fixes bind the displayed sender/footer, not an undisplayed provider
  API key identity.
- Website target approval currently stores a human target string rather than a
  canonical account/site identity. Resolving this belongs with connection and
  destination lifecycle work; this patch does not retroactively invent such an
  identity for existing approvals.
- Fixture verification is not live publishing acceptance. No real email, social
  post, or website deployment was made, and the running app was not restarted.
- The Printify fix covers explicitly named import files. It does not redefine
  stdin approval or claim to pin every setting loaded by the native CLI.

## Verification

- All six CI-style Bun shards passed: 9,898 tests, 10 skips, zero failures.
- All 36 isolated files passed in separate processes: 417 tests, zero failures.
- All package typechecks and dependency containment passed.
- Artist OS main-process and renderer builds passed in the isolated worktree.
- The social CLI's own Node test runner passed in addition to the Bun suite.
- Gmail regressions exercise the real Claude pre-tool hook and Pi approval
  response path with provider execution substituted. Private API/pool fixtures
  cover source aliases, changed remote drafts, and account/token changes.
- Printify fixtures prove the native child receives reviewed snapshot bytes even
  when the original is modified after verification, and that both successful and
  failed child execution remove the snapshot.

Code was verified at `d38f9bb50`, after merging the current `origin/main` (already
up to date). The subsequent audit commit changes this document only.
