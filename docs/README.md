---
status: current
owner: agent
last_verified: 2026-07-04
source_of_truth: true
---

# Docs Map

Start here when you need project context without reading the whole repo.

## Read First

1. [CURRENT.md](./CURRENT.md) - live branch/status notes.
2. [HANDOFF-2026-07-04.md](./HANDOFF-2026-07-04.md) - zero-context takeover brief for the current build.
3. [creator-command-center](./creator-command-center/) - Artist HQ / campaign workspace specs.
4. [workflows](./workflows/) - workflow runtime, UX, examples, and recovery notes.

Current active feature spec:

- [HQ State Of Play / Proactive Routing](./creator-command-center/09-hq-state-of-play-proactive-routing.md) - generated HQ operating brief, route hint contract, proactive toggle, launch guards, and key files.
- [Work Products / Output Architecture](./creator-command-center/10-work-products-output-architecture-spec.md) - minimal Output-based layer for HQ/campaign widgets, approvals, drawer preview, and agent awareness.

## Main Areas

- [specs](./specs/) - standalone specs that do not belong to a larger feature folder.
- [backlog](./backlog/) - accepted future work, deferred integrations, and cleanup ideas.
- [audits](./audits/) - security, runtime, and technical debt reports.
- [development](./development/) - local commands, CLI docs, setup-adjacent references.
  - [Local Smoke Profile](./development/local-smoke-profile.md) - private local artist/campaign context and service-key setup for repeatable smoke tests without shipping user data.
- [system-map](./system-map/) - generated map of workers, skills, sources, launch surfaces, and approval boundaries.
- [archive](./archive/) - historical docs that should not guide current decisions.

## Feature Docs

Feature folders stay in place to avoid breaking existing links:

- `agent-messaging/`
- `commerce/`
- `creator-command-center/`
- `creator-skills/`
- `deep-research/`
- `global-sources/`
- `llm-connections/`
- `memory/`
- `messaging-gateway/`
- `project-spaces/`
- `pulses/`
- `skill-recipes/`
- `tts-agent/`
- `video-studio/`
- `visual-agent-os/`
- `workflows/`
- `zero-secrets/`

## Where New Docs Go

- New active feature spec: `docs/<feature>/`.
- Cross-feature standalone spec: `docs/specs/`.
- Future work or deferred idea: `docs/backlog/`.
- Audit or review report: `docs/audits/<YYYY-MM-DD>/`.
- Local command/setup reference: `docs/development/`.
- Superseded historical doc: `docs/archive/<YYYY-MM-DD>/`.
