# Voice Core consumer snapshot

Source revision: a2abae999d8bf7802cd9b507aa53f1c84d8f3136
Source had SDK edits at export: false

Rebuild the upstream Web TypeScript and WASM before exporting. Run tools/export-runner-voice-sdk.mjs with this repository path. Exact imported runtime hashes are in ../voice-core-snapshot.json. Electron modules are copied unchanged from the same source tree. No credentials, native binaries or model packs are included.

The cloud entry point avoids optional WebGPU inference imports; the full SDK entry point retains its optional model-provider dependencies.
