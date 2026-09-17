# Content Genius as the content starting point

## Product behavior

- Content Genius is the visible entry for general content ideas, refinement, captions, and specialist collaboration. Scriptwriter remains visible for direct script work.
- Scroll Stopper and Anticipation Director retain their separate definitions, skills, histories, and normal permission boundaries. Their stock cards move out of the default HQ/Campaign Workers display, while Manage library can add either back.
- Content Genius suggests a specialist while exploring or invokes one for a useful bounded task when asked to develop the work. It sends the agreed context and locked choices, waits when its answer depends on the result, and brings the result back into the same conversation. No automatic multi-agent brainstorming or forced handoff.
- Scroll Stopper handles visually absurd, instantly readable AI-video premises. Anticipation Director handles credible approaching outcomes and payoff. These approaches remain distinct.
- A presentation flag keeps grouped specialists available to existing delegation, schedules and workflows without displaying extra cards. Explicitly disabled agents stay disabled; customized specialists stay as arranged. Re-adding a specialist clears the flag, and the one-time grouping does not hide it again.
- The release-board viral-clips entry now opens Content Genius. Existing specialist conversations and explicit workflows remain valid.

## Verification

- 228 focused tests pass across prompt composition, activation/storage, visibility, release-board routing, and agent messaging; 5 isolated RPC tests pass separately.
- Full repository typecheck, main and renderer builds, changed UI lint, and diff whitespace checks pass. No preload API change was required.
- Independent review found stale HQ default expectations after adding Content Genius; corrected and rerun. No remaining concrete regression found in that review.
- Live canonical Artist OS relaunch with the existing profile: HQ and Homebody Campaign show four Creative cards, including Content Genius and Scriptwriter, with neither stock specialist card. Manage library exposes both specialists as addable.
- Actual Content Genius session `260916-lucid-dune` discovered and invoked both grouped specialists through `message_agent`; both successful tool results returned to the same conversation (`SCROLL_READY`, `ANTICIPATION_READY`, zero child tools). This proves connectivity and result return, not artistic quality across arbitrary requests.
- Re-add persistence, explicit disable, custom/missing definitions, and new workspace behavior are covered by fixtures; the user's live library preferences were not toggled for testing.
- App was left open on Homebody Workers during verification. Included in the September 17 main commit; this is not public release certification.
