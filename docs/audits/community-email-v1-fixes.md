# Community Email V1 Fixes

## Behavior

- Preflight failure leaves an approved job retryable with another explicit Send click.
- Cancellation and stale edits cannot overwrite a newer job decision.
- Each completed provider batch writes delivery evidence before the next batch starts.
- Partial sends stay in attention state. Explicit retries target confirmed rejections only.
- Timeouts, malformed acceptance receipts, and interrupted recording are uncertain, not safe to resend. Check Resend; no automatic replay.
- The website `/unsubscribe` form updates Resend's global contact status, creating a suppressed contact for locally imported addresses when necessary.
- Before each broadcast, the app verifies the unsubscribe endpoint and reads every page of provider contacts to apply opt-outs locally. Website capture drains also apply upstream opt-outs and restart pagination after a complete scan.
- Repeated signup does not reset an existing provider contact or its opt-out.

## Deployment Prerequisite

Rebuild and publish the Artist OS website with signup enabled and its Resend binding connected to the same account used by Community. Set COMMUNITY_UNSUBSCRIBE_URL to its HTTPS `/unsubscribe` page. Older deployments and arbitrary custom unsubscribe pages do not satisfy the endpoint check and cannot send until connected to this supported flow.

This is an email-address form, not RFC 8058 one-click unsubscribe. Do not claim one-click support or restore List-Unsubscribe-Post without implementing that protocol.

Provider contract: https://resend.com/docs/api-reference/contacts/update-contact

## Verification Boundary

Regression coverage uses temporary workspaces and fake providers. It covers cancellation during preflight, overlapping send calls, stale writes, preflight retry, partial-batch retry excluding accepted recipients, opt-out synchronization, malformed receipts, and unsubscribe form outcomes. Site-builder tests exercise the emitted worker bundle.

Live deployment and real-account delivery/unsubscribe smoke tests are still required. No live fan messages were sent for this change.
