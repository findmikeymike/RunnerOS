---
status: active
owner: agent
last_verified: 2026-09-01
source_of_truth: true
---

# Embedded OmniRoute Gateway

## Decision

Artist OS bundles and owns an isolated OmniRoute process through its
OpenAI-compatible `/v1` API. Users do not install a CLI, enter a server URL, or
create an OmniRoute inference key.

Artist OS retains ownership of agents, skills, tools, memory, approvals, and
workspace routing. OmniRoute is model transport only: it selects an upstream
model or executes a user-defined fallback combo.

## V1 connection contract

- Artist OS starts OmniRoute on loopback at app launch and stops its owned
  process at app quit.
- A fresh Artist OS profile receives a keyless `OmniRoute Auto` connection.
- Its default model is `auto/best-free`, which fails closed instead of selecting
  a paid model.
- Users can open the local provider manager to add OpenRouter or other paid
  provider credentials and may then explicitly select broader auto routes.
- Artist OS loads the server's model and route catalog through authenticated
  `GET /v1/models`; manual model IDs remain available as a fallback.
- A bare server origin is normalized to `/v1`.
- Remote servers require HTTPS; HTTP is accepted only for loopback development.
- The key uses the existing encrypted LLM credential manager.
- Connection setup states plainly that the configured server receives prompts,
  context, and files sent through it.
- The connection is tested through the same Pi custom-endpoint subprocess path
  used by real chats before it is saved.
- The OpenAI-compatible protocol is fixed; users are not asked to choose it.

## Deliberate boundaries

- Do not expose the internal endpoint or generated storage key in routine setup.
- Provider credentials stay inside the isolated OmniRoute data directory.
- Do not enable OmniRoute prompt or tool-output compression by default.
- Do not add OmniRoute MCP/A2A services to the agent runtime.
- Do not add a second agent, skill, memory, or approval system.
- Do not claim the exact upstream model or cost unless OmniRoute reports it.

## Discovery boundary

Model discovery uses a dedicated main-process RPC contract with an eight-second
timeout, redirect rejection, streamed byte and item caps, bounded display names,
and no credential logging.
Artist OS intentionally does not infer image support from combo metadata because
that metadata is not reliable enough to grant a capability safely.

Live release proof must cover streaming chat, tool calls, cancellation, image
input for an explicitly image-capable route, provider fallback, and sanitized
failure messages against a real OmniRoute endpoint.
