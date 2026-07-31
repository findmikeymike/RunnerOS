---
name: incident-recovery
description: Recover from DiscoTrader failures such as unconfirmed fills, unprotected positions, reconciliation halts, daemon outages, and broker rejections.
---

# Incident Recovery

When money may be exposed, work in this order:

1. Establish what is actually open at the broker.
2. Ensure every open position is protected.
3. Diagnose the failure.

Start with:

```
dt_status
dt_positions
```

If local state and the broker disagree, believe the broker.

## Unprotected position

1. Confirm it with `dt_positions`.
2. Place the intended absolute stop with `dt_move_stop`.
3. If protection is rejected again, ask for approval to close the position.
4. Investigate only after exposure is contained.

## Unconfirmed fill

Never retry. Check `dt_positions`, check the broker for a working order, and
engage `dt_halt` while ownership is uncertain.

## Reconciliation halt

Run `dt_reconcile_now`. Explain whether the divergence is a phantom local
position, broker orphan, size mismatch, or side mismatch. Do not close a
position merely to silence the mismatch. Resume only after the books are
confirmed square.

## Daemon outage

Existing broker positions and resting protective stops remain at the broker.
Monitoring and new signal processing are unavailable. State that plainly and
do not infer position state from stale local data.

## Kill switch

- `dt_halt` rejects new alerts and discards queued work.
- `dt_release_halt` lifts the halt only after the cause is understood.
- The halt does not close positions. `dt_flatten_all` is separate and requires
  a deliberate reason and approval.

Always lead with current exposure, not theory.
