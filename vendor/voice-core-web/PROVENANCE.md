# Voice Core consumer snapshot

Source revision: 652111cefe263f6d0c60428fa9c0f30b2d58ea97
Source had SDK edits at export: true

Rebuild the upstream Web TypeScript and WASM before exporting. Run tools/export-runner-voice-sdk.mjs with this repository path. Exact imported runtime hashes are in ../voice-core-snapshot.json. Electron modules are copied unchanged from the same source tree. No credentials, native binaries or model packs are included.

The cloud entry point avoids optional WebGPU inference imports; the full SDK entry point retains its optional model-provider dependencies.
