// Lightweight runtime entry point. Local Electron STT can be injected through
// setTransports without importing optional browser model inference libraries.
export { VoiceCoreWeb } from "./VoiceCoreWeb";
export { AgentActivitySpeechController } from "./agentActivitySpeech";
export { createAssemblyAiSttTransport } from "./transport/assemblyai";
export { createInworldTtsTransport } from "./transport/inworld";
//# sourceMappingURL=cloud.js.map