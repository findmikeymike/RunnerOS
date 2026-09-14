# Vault usability integration

Integrated into canonical main from the uncommitted work in `codex/vault-smoke-fixes`. Source worktree was left untouched.

Included: import names and notes, readable filename defaults, selected/removable tags, simplified asset rows, image/audio/video previews through a registered-asset local RPC.

Review adjustments:
- Restored the explicitly requested internal-only model: new business assets and saved Vault assets allow agent work; list results omit internal paths until an exact record is requested. Final/working purpose remains independent. Existing explicitly agent-disabled records remain disabled until saved with the new settings. Release Kit and website checks continue to restrict external use. Tool guidance prohibits sending/posting internal material; this is not a universal filesystem-level outbound firewall.
- Bounded preview reads to 32 MiB, both before reading and while streaming into the response. Larger files still import but show an explicit inline-preview limitation. Large-file streaming playback remains future work.

Verification: 65 Vault storage, UI wiring, Release Kit, and website tests passed after restoring internal-only access; website tests required local network binding outside the sandbox. Electron typecheck passed. Live Vault smoke is pending a full app restart because this slice adds a backend RPC. No user data was imported or changed by tests.
