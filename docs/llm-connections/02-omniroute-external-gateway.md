---
status: active
owner: agent
last_verified: 2026-09-01
source_of_truth: true
---

# OmniRoute External Gateway

## Decision

Artist OS connects to a separately operated OmniRoute server through its
OpenAI-compatible `/v1` API. Artist OS does not install, embed, administer, or
fork OmniRoute.

Artist OS retains ownership of agents, skills, tools, memory, approvals, and
workspace routing. OmniRoute is model transport only: it selects an upstream
model or executes a user-defined fallback combo.

## V1 connection contract

- User selects `OmniRoute Gateway` in Settings > AI.
- User provides the server URL, an inference-only Bearer key, and one or more
  model/combo IDs from the OmniRoute dashboard.
- A bare server origin is normalized to `/v1`.
- Remote servers require HTTPS; HTTP is accepted only for loopback development.
- The key uses the existing encrypted LLM credential manager.
- The connection is tested through the same Pi custom-endpoint subprocess path
  used by real chats before it is saved.
- The OpenAI-compatible protocol is fixed; users are not asked to choose it.

## Deliberate boundaries

- Do not request or store an OmniRoute management key.
- Do not configure upstream providers from Artist OS.
- Do not enable OmniRoute prompt or tool-output compression by default.
- Do not add OmniRoute MCP/A2A services to the agent runtime.
- Do not add a second agent, skill, memory, or approval system.
- Do not claim the exact upstream model or cost unless OmniRoute reports it.

## Next isolated slice

Add authenticated `GET /v1/models` discovery so users can select models and
combos instead of copying IDs. This should use a dedicated main-process IPC
contract and land only after concurrent protocol/preload edits are clear.

Live release proof must cover streaming chat, tool calls, cancellation, image
input for an explicitly image-capable route, provider fallback, and sanitized
failure messages against a real OmniRoute endpoint.
