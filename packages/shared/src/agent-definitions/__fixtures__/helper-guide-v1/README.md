# Helper guide migration baselines

Exact source-controlled shipped content captured before the helper refresh. Runtime uses SHA256 allowlists, not keyword matching. Any whitespace or custom text changes remain untouched.

- `setup-concierge.md`: current `STARTER_AGENTS` prompt captured before parent edits on 2026-09-08; serialized body hash `9f8de9a5…` matches the installed `.artist-os` profile read-only.
- `setup-concierge-pre-monid.md`: shipped previous prompt copied from the existing `monid-routing-v1/agents.json` fixture; serialized hash matches that migration's baseline.
- `setup-concierge-450bd45c.md`: exact prompt extracted from commit `86f7340bc6f05ca118d0f31f35f63f70784340ec`; serialized hash matches the installed `.artist-os-dev` profile read-only.
- `artist-os-guide.md`: current inline `STARTER_SKILLS` guide captured before edits. Exact content verified in commit `3b357d68b7d32e0c1fe2c4a70cb54fd94d16cb36`; file hash `48b88db2…` matches installed `.artist-os` guide.
- `artist-os-guide-7cfc3032.md`: exact inline guide extracted from commit `759c6fb185a2638aae4f96e6fbd908b53dbf8b79`; file hash matches installed `.artist-os-dev` guide.

The hashes are in `baselines.json`. No profile files were changed. Skill reference files are not migration targets; normal missing-file seeding owns new references and preserves existing custom references.
