export type VoiceConversationState = "idle" | "listening" | "thinking" | "speaking" | "interrupted" | "recovering" | "ending";
export type VoiceRuntimeStatus = "uninitialized" | "starting" | "running" | "stopping" | "stopped" | "error";
/**
 * Legacy mixed state union preserved for compatibility.
 *
 * Prefer `VoiceConversationState` for conversation flow and
 * `VoiceRuntimeStatus` for wrapper lifecycle/progress.
 */
export type VoiceState = VoiceConversationState | "starting" | "stopping" | "error";
export type BrowserCapabilities = {
    getUserMedia: boolean;
    audioContext: boolean;
    audioWorklet: boolean;
    worker: boolean;
    sharedArrayBuffer: boolean;
    crossOriginIsolated: boolean;
};
export type VoiceSdkCapabilities = {
    runtimeSetters: boolean;
    toolCalling: boolean;
    diagnostics: boolean;
    conversationItems: boolean;
    sessionUpdate: boolean;
    commercialWebGate: boolean;
    platformAudio: boolean;
    voiceAssets: boolean;
    pocketModelInstall: boolean;
    pocketLocalInference: boolean;
    pocketVoiceExport: boolean;
    pocketRuntimeMode: PocketRuntimeMode;
    localStt: boolean;
    moonshineCompiled: boolean;
    moonshineRuntimeAvailable: boolean;
    moonshineModelReady: boolean;
    moonshineModelInstall: boolean;
    moonshineRuntimeMode: "unavailable" | "native";
    moonshineInstallState: "unavailable" | "not_installed" | "checking" | "downloading" | "verifying" | "installing" | "ready" | "update_available" | "failed";
    moonshinePreparationState: "idle" | "preparing" | "ready" | "failed";
    moonshineSupportStatus: "unavailable" | "experimental" | "certified";
};
export type PocketRuntimeMode = "unavailable" | "external_http" | "managed_sidecar" | "native";
export type PocketInstallState = "unavailable" | "not_installed" | "checking" | "downloading" | "verifying" | "installing" | "ready" | "update_available" | "failed";
export type PocketInstallStatus = {
    state: PocketInstallState;
    modelVersion?: string;
    bytesDownloaded?: number;
    bytesTotal?: number;
    error?: string;
};
export type VoiceAssetKind = "builtin" | "uploaded_sample" | "exported_embedding";
export type VoiceRecord = {
    id: string;
    provider: "inworld" | "pocket_tts" | "chatterbox_turbo_webgpu";
    displayName: string;
    language?: string;
    kind: VoiceAssetKind;
    createdAt: string;
    artifactUri: string;
    sourceSha256?: string;
    modelRevision?: string;
    normalization?: {
        format: "pcm_s16le_wav";
        sampleRateHz: 24_000;
        channels: 1;
    };
    evaluationOnly?: boolean;
    consent: {
        granted: boolean;
        source: "user_upload" | "developer_seed" | "licensed_catalog" | "evaluation_fixture";
    };
};
export type InputStats = {
    frames_received: number;
    samples_received: number;
    last_sample_rate_hz: number;
    last_channels: number;
    last_rms: number;
    peak_abs_sample: number;
};
export type VoiceRuntimeConfig = {
    sttProvider?: "assembly_ai" | "moonshine";
    moonshineModelId?: string;
    sttComputePolicy?: "auto" | "cpu" | "accelerator_preferred";
    assemblyAiApiKey?: string;
    openAiApiKey?: string;
    inworldApiKey?: string;
    inworldRuntimeKey?: string;
    sessionToken?: string;
    requireCommercialAccess?: boolean;
    /** Explicit local-development opt-in. Never enable this in a shipped browser app. */
    allowInsecureBrowserProviderKeys?: boolean;
    inworldVoiceId?: string;
    /** Stable host-managed voice ID. Absolute filesystem paths are not portable IDs. */
    voiceId?: string;
    inworldModelId?: string;
    openAiModel?: string;
    openAiMaxOutputTokens?: number;
    openAiTtsModel?: string;
    openAiTtsVoice?: string;
    systemPrompt?: string;
    sampleRateHint?: number;
    outputSampleRateHz?: number;
    requireCrossOriginIsolation?: boolean;
    preferSharedArrayBuffer?: boolean;
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
    inputDeviceId?: string;
    outputDeviceId?: string;
    inputBatchFrames?: number;
    endpointing?: {
        minEndpointingDelayMs?: number;
        requiredSilenceMs?: number;
    };
};
export type VoiceCanonicalEvent = {
    type: "stateChanged";
    state: VoiceConversationState;
    from?: VoiceConversationState;
    to?: VoiceConversationState;
} | {
    type: "userSpeechStarted";
} | {
    type: "userSpeechPartial";
    text: string;
} | {
    type: "userSpeechComplete";
    text: string;
} | {
    type: "bargeInDetected";
} | {
    type: "agentSpeechStarted";
} | {
    type: "agentSpeechComplete";
} | {
    type: "captureError";
    message: string;
} | {
    type: "renderError";
    message: string;
} | {
    type: "formatChanged";
    priorSampleRateHz: number;
    priorChannels: number;
    newSampleRateHz: number;
    newChannels: number;
} | {
    type: "captureOverflow";
    streamTimeMs: number;
    samplesDropped: number;
} | {
    type: "error";
    message: string;
};
export type VoiceBrowserExtensionEvent = {
    type: "runtimeStatusChanged";
    status: VoiceRuntimeStatus;
    from?: VoiceRuntimeStatus;
    to?: VoiceRuntimeStatus;
} | {
    type: "assistantText";
    text: string;
} | {
    type: "assistantAudioStart";
} | {
    type: "assistantAudioStop";
} | {
    type: "bargeIn";
} | {
    type: "debug";
    message: string;
} | {
    type: "capabilities";
    capabilities: BrowserCapabilities;
} | {
    type: "legacyStateChanged";
    state: VoiceState;
    from?: VoiceState;
    to?: VoiceState;
};
export type VoiceEvent = VoiceCanonicalEvent | VoiceBrowserExtensionEvent;
//# sourceMappingURL=types.d.ts.map