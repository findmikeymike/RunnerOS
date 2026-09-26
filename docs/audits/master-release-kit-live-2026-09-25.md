# Campaign master to Release Kit live acceptance

Verified canonical `main` at `c5d30de2e` on September 25, 2026. Rebuilt the Artist OS renderer and used the Electron UI with a new disposable profile; no real campaigns or saved connections were changed.

## Observed result

- Created `Master Handoff Test` through the campaign brief UI and used its Campaign Assets **Master** upload control to import a synthetic two-second WAV.
- The UI reported **Master saved to the campaign and Release Kit.** Campaign readiness advanced to 1/20, with Lyrics next.
- Release Kit showed one approved **Final Audio**, titled Master, without a separate promotion action. Playback entered Pause and reached 0:02/0:02.
- The manifest contained one ready, primary audio/master item sourced from the imported campaign asset. Original, campaign copy, and Release Kit snapshot had identical SHA-256: `f53b6da0e98cec9d3d0fc7e3b825bce730e3bafdfc8e34721aebbb41bc7e9d91`.
- Quit normally and reopened the same disposable profile. Final Audio persisted and playback again reached 0:02/0:02. Closed the test app normally afterward.
- Automatic transcription returned no lyrics for the synthetic tone; this did not prevent master promotion or playback.

## Scope and evidence

Michael subsequently reported that master replacement works in his own testing. Record this as user-tested acceptance; the agent did not independently repeat replacement. At his direction, move on from this slice. Multiple-file selection remains outside the live evidence recorded here.

This verifies a newly imported single master through the campaign brief's upload path, persistence, and UI playback progression. It does not certify multiple-master selection, replacement of scheduled audio, existing-master migration, distribution, or the entire release. Prior focused automated verification was 40 passing tests and Electron typecheck; those were not rerun during this UI acceptance pass.

Disposable profile and fixture: `/var/folders/lr/1wbdlzk56pv44s9crktlfrdm0000gn/T/artist-os-master-live-h398lv8i`.

Build and launch logs: `/tmp/artist-os-master-live-build.log`, `/tmp/artist-os-master-live-launch.log`, `/tmp/artist-os-master-live-reopen.log`.
