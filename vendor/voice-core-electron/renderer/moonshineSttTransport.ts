import type {
  ElectronMoonshineRuntimePoll,
  ElectronMoonshineRuntimeStarted,
  MoonshineModelId,
} from "../main/moonshineModels.js";

type SttTranscriptEvent =
  | { type: "partial"; text: string }
  | { type: "final"; text: string };

type WebSttTransportContract = {
  keepAliveDuringAssistant?: boolean;
  start(): Promise<void>;
  cancelStart?(): void;
  stop(): Promise<void>;
  sendAudio(pcm16: Int16Array, sampleRate: number, channels: number): Promise<void>;
  onTranscript(handler: (event: SttTranscriptEvent) => void): () => void;
  onError?(handler: (error: Error) => void): () => void;
};

const POLL_INTERVAL_MS = 25;
const PREPARATION_TIMEOUT_MS = 60_000;
const LOCAL_EOU_SILENCE_MS = 500;
const LOCAL_EOU_MIN_RMS_THRESHOLD = 0.00025;
const LOCAL_EOU_MAX_RMS_THRESHOLD = 0.0015;
const LOCAL_EOU_NOISE_MULTIPLIER = 2.5;
const SPEECH_GATE_MIN_RMS_THRESHOLD = 0.0015;
const SPEECH_GATE_NOISE_MULTIPLIER = 4;
const SPEECH_GATE_CONFIRM_MS = 150;
const SPEECH_GATE_PREROLL_MS = 300;
const MAX_AUDIO_MILLISECONDS = 100;
const MAX_UTTERANCE_MS = 60_000;
const FINALIZATION_TIMEOUT_MS = 15_000;

export type MoonshineRendererApi = {
  startMoonshineRuntime(modelId: MoonshineModelId): Promise<ElectronMoonshineRuntimeStarted>;
  feedMoonshineAudio(pcm16: Int16Array, sampleRateHz: number, channels: number): Promise<void>;
  pollMoonshineRuntime(): Promise<ElectronMoonshineRuntimePoll>;
  finalizeMoonshineRuntime(turn: number): Promise<void>;
  finishMoonshineTurn(turn: number): Promise<void>;
  cancelMoonshineRuntime(): Promise<void>;
  stopMoonshineRuntime(): Promise<void>;
};

export function createElectronMoonshineSttTransport(
  api: MoonshineRendererApi,
  modelId: MoonshineModelId,
): WebSttTransportContract {
  return new ElectronMoonshineSttTransport(api, modelId);
}

export class ElectronMoonshineSttTransport implements WebSttTransportContract {
  readonly keepAliveDuringAssistant = true;
  readonly #api: MoonshineRendererApi;
  readonly #modelId: MoonshineModelId;
  readonly #handlers = new Set<(event: SttTranscriptEvent) => void>();
  readonly #errorHandlers = new Set<(error: Error) => void>();
  #startPromise: Promise<void> | null = null;
  #running = false;
  #lifecycleEpoch = 0;
  #generation = 0;
  #turn = 1;
  #pendingFinalizationTurn: number | null = null;
  #latestPartial = "";
  #silenceMs = 0;
  #noiseFloorRms: number | null = null;
  #speechGateOpen = false;
  #speechCandidateMs = 0;
  #speechGateNoiseFloorRms: number | null = null;
  #speechPreroll: Array<{ pcm16: Int16Array; sampleRate: number; channels: number; durationMs: number }> = [];
  #pollTimer: ReturnType<typeof setTimeout> | null = null;
  #utteranceTimer: ReturnType<typeof setTimeout> | null = null;
  #finalizationTimer: ReturnType<typeof setTimeout> | null = null;
  #utteranceAudioMs = 0;
  readonly #turnWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
  #fatal = false;

  constructor(api: MoonshineRendererApi, modelId: MoonshineModelId) {
    this.#api = api;
    this.#modelId = modelId;
  }

  async start(): Promise<void> {
    if (this.#running) return;
    if (this.#startPromise) return this.#startPromise;
    const epoch = ++this.#lifecycleEpoch;
    this.#fatal = false;
    this.#startPromise = this.#start(epoch);
    try {
      await this.#startPromise;
    } finally {
      this.#startPromise = null;
    }
  }

  cancelStart(): void {
    if (!this.#startPromise) return;
    this.#lifecycleEpoch += 1;
    void this.#api.cancelMoonshineRuntime().catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.#lifecycleEpoch += 1;
    this.#running = false;
    this.#clearPollTimer();
    this.#resetTurnState();
    this.#generation = 0;
    const results = await Promise.allSettled([
      this.#api.cancelMoonshineRuntime(),
      this.#api.stopMoonshineRuntime(),
    ]);
    const stop = results[1];
    if (stop.status === "rejected" && !isInactiveRuntimeError(stop.reason)) {
      throw asError(stop.reason);
    }
  }

  async sendAudio(pcm16: Int16Array, sampleRate: number, channels: number): Promise<void> {
    if (!this.#running) throw new Error("Moonshine native STT transport is not running");
    assertAudio(pcm16, sampleRate, channels);
    const epoch = this.#lifecycleEpoch;
    const turn = this.#turn;
    const samplesPerChunk = Math.max(
      channels,
      Math.floor(sampleRate * MAX_AUDIO_MILLISECONDS / 1_000) * channels,
    );
    for (let offset = 0; offset < pcm16.length; offset += samplesPerChunk) {
      if (!this.#ownsTurn(epoch, turn)) return;
      const chunk = pcm16.slice(offset, offset + samplesPerChunk);
      if (!this.#speechGateOpen) {
        await this.#observeSpeechGate(chunk, sampleRate, channels, epoch, turn);
        continue;
      }
      await this.#feedChunk(chunk, sampleRate, channels);
      if (!this.#ownsTurn(epoch, turn)) return;
      await this.#observeLocalEou(chunk, sampleRate, channels);
    }
  }

  onTranscript(handler: (event: SttTranscriptEvent) => void): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  onError(handler: (error: Error) => void): () => void {
    this.#errorHandlers.add(handler);
    return () => this.#errorHandlers.delete(handler);
  }

  async #start(epoch: number): Promise<void> {
    try {
      const started = await this.#api.startMoonshineRuntime(this.#modelId);
      if (epoch !== this.#lifecycleEpoch) {
        await this.#api.stopMoonshineRuntime().catch(() => undefined);
        throw new Error("Moonshine native STT startup was cancelled");
      }
      if (started.modelId !== this.#modelId || started.generation <= 0) {
        throw new Error("Moonshine native STT started with an invalid identity");
      }
      this.#generation = started.generation;
      const deadline = Date.now() + PREPARATION_TIMEOUT_MS;
      let preparation = started.preparationState;
      while (preparation === "preparing" || preparation === "unprepared") {
        if (epoch !== this.#lifecycleEpoch) {
          throw new Error("Moonshine native STT startup was cancelled");
        }
        if (Date.now() >= deadline) {
          throw new Error("Moonshine native STT preparation timed out");
        }
        await delay(POLL_INTERVAL_MS);
        if (epoch !== this.#lifecycleEpoch) {
          throw new Error("Moonshine native STT startup was cancelled");
        }
        const poll = await this.#api.pollMoonshineRuntime();
        if (epoch !== this.#lifecycleEpoch) {
          throw new Error("Moonshine native STT startup was cancelled");
        }
        this.#assertPollIdentity(poll);
        preparation = poll.preparationState;
        if (poll.hasError || preparation === "failed") {
          throw new Error("Moonshine native STT preparation failed");
        }
      }
      if (preparation !== "ready") {
        throw new Error("Moonshine native STT preparation failed");
      }
      if (epoch !== this.#lifecycleEpoch) {
        throw new Error("Moonshine native STT startup was cancelled");
      }
      this.#running = true;
      this.#resetTurnState();
      this.#schedulePoll(epoch);
    } catch (error) {
      await Promise.allSettled([
        this.#api.cancelMoonshineRuntime(),
        this.#api.stopMoonshineRuntime(),
      ]);
      throw asError(error);
    }
  }

  async #observeLocalEou(
    chunk: Int16Array,
    sampleRate: number,
    channels: number,
  ): Promise<void> {
    const level = rms(chunk);
    if (!this.#latestPartial) {
      this.#noiseFloorRms = this.#noiseFloorRms === null
        ? level
        : Math.min(this.#noiseFloorRms, level);
    }
    if (this.#pendingFinalizationTurn !== null) return;
    const durationMs = chunk.length / channels / sampleRate * 1_000;
    const threshold = Math.min(
      LOCAL_EOU_MAX_RMS_THRESHOLD,
      Math.max(
        LOCAL_EOU_MIN_RMS_THRESHOLD,
        (this.#noiseFloorRms ?? LOCAL_EOU_MIN_RMS_THRESHOLD) * LOCAL_EOU_NOISE_MULTIPLIER,
      ),
    );
    this.#silenceMs = level <= threshold
      ? this.#silenceMs + durationMs
      : 0;
    if (this.#silenceMs < LOCAL_EOU_SILENCE_MS) return;
    const turn = this.#turn;
    this.#pendingFinalizationTurn = turn;
    this.#armFinalizationDeadline();
    await this.#waitForTurnOperation(this.#api.finalizeMoonshineRuntime(turn));
  }

  #schedulePoll(epoch: number): void {
    this.#clearPollTimer();
    this.#pollTimer = setTimeout(() => {
      this.#pollTimer = null;
      void this.#poll(epoch);
    }, POLL_INTERVAL_MS);
  }

  async #poll(epoch: number): Promise<void> {
    if (!this.#running || epoch !== this.#lifecycleEpoch) return;
    try {
      const poll = await this.#api.pollMoonshineRuntime();
      if (!this.#running || epoch !== this.#lifecycleEpoch) return;
      this.#assertPollIdentity(poll);
      if (poll.hasError || poll.preparationState === "failed") {
        throw new Error("Moonshine native STT runtime failed");
      }
      for (const token of poll.tokens) {
        if (!this.#speechGateOpen) continue;
        if (!token.text.trim()) continue;
        if (!token.isFinal) {
          this.#latestPartial = token.text;
          this.#emit({ type: "partial", text: token.text });
        }
      }
      const nativeFinal = this.#speechGateOpen
        ? poll.finalizedTranscript.trim()
          || poll.tokens.filter((token) => token.isFinal).map((token) => token.text).join(" ").trim()
        : "";
      if (nativeFinal) {
        await this.#completeTurn(nativeFinal, epoch);
      } else if (poll.finalizationAck
        && this.#pendingFinalizationTurn !== null
        && poll.finalizationAck.generation === this.#generation
        && poll.finalizationAck.turn === this.#pendingFinalizationTurn) {
        const promoted = this.#latestPartial.trim();
        // A noise burst can open the gate without producing any words. Its
        // acknowledged boundary must still reset the native turn and the gate.
        await this.#completeTurn(promoted, epoch);
      }
    } catch (error) {
      if (!this.#running || epoch !== this.#lifecycleEpoch) return;
      this.#fail(asError(error));
      return;
    }
    if (this.#running && epoch === this.#lifecycleEpoch) this.#schedulePoll(epoch);
  }

  async #completeTurn(text: string, epoch: number): Promise<void> {
    if (!this.#running || epoch !== this.#lifecycleEpoch) return;
    const turn = this.#turn;
    this.#armFinalizationDeadline();
    await this.#waitForTurnOperation(this.#api.finishMoonshineTurn(turn));
    if (!this.#running || epoch !== this.#lifecycleEpoch) return;
    this.#turn = this.#turn >= Number.MAX_SAFE_INTEGER ? 1 : this.#turn + 1;
    this.#resetTurnState();
    if (text.trim()) this.#emit({ type: "final", text });
  }

  #assertPollIdentity(poll: ElectronMoonshineRuntimePoll): void {
    if (poll.modelId !== this.#modelId || poll.generation !== this.#generation) {
      throw new Error("Moonshine native STT runtime identity changed");
    }
  }

  #emit(event: SttTranscriptEvent): void {
    for (const handler of this.#handlers) handler(event);
  }

  #fail(error: Error): void {
    if (this.#fatal) return;
    this.#fatal = true;
    this.#running = false;
    this.#clearPollTimer();
    this.#resetTurnState(error);
    void Promise.allSettled([
      this.#api.cancelMoonshineRuntime(),
      this.#api.stopMoonshineRuntime(),
    ]);
    for (const handler of this.#errorHandlers) handler(error);
  }

  #resetTurnState(error?: Error): void {
    for (const waiter of this.#turnWaiters) {
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
    this.#turnWaiters.clear();
    if (this.#utteranceTimer !== null) clearTimeout(this.#utteranceTimer);
    if (this.#finalizationTimer !== null) clearTimeout(this.#finalizationTimer);
    this.#utteranceTimer = null;
    this.#finalizationTimer = null;
    this.#utteranceAudioMs = 0;
    this.#pendingFinalizationTurn = null;
    this.#latestPartial = "";
    this.#silenceMs = 0;
    this.#noiseFloorRms = null;
    this.#speechGateOpen = false;
    this.#speechCandidateMs = 0;
    this.#speechGateNoiseFloorRms = null;
    this.#speechPreroll = [];
  }

  async #observeSpeechGate(
    chunk: Int16Array,
    sampleRate: number,
    channels: number,
    epoch: number,
    turn: number,
  ): Promise<void> {
    const durationMs = chunk.length / channels / sampleRate * 1_000;
    const level = rms(chunk);
    this.#speechPreroll.push({ pcm16: chunk, sampleRate, channels, durationMs });
    let bufferedMs = this.#speechPreroll.reduce((total, item) => total + item.durationMs, 0);
    while (bufferedMs > SPEECH_GATE_PREROLL_MS && this.#speechPreroll.length > 1) {
      bufferedMs -= this.#speechPreroll.shift()!.durationMs;
    }

    if (level < SPEECH_GATE_MIN_RMS_THRESHOLD
      && (this.#speechGateNoiseFloorRms === null || level < this.#speechGateNoiseFloorRms)) {
      this.#speechGateNoiseFloorRms = level;
    }
    const threshold = Math.max(
      SPEECH_GATE_MIN_RMS_THRESHOLD,
      (this.#speechGateNoiseFloorRms ?? 0) * SPEECH_GATE_NOISE_MULTIPLIER,
    );
    this.#speechCandidateMs = level >= threshold
      ? this.#speechCandidateMs + durationMs
      : 0;
    if (this.#speechCandidateMs < SPEECH_GATE_CONFIRM_MS) return;

    this.#speechGateOpen = true;
    this.#utteranceTimer = setTimeout(() => {
      this.#fail(new Error("Moonshine could not find the end of speech within 60 seconds. No command was submitted. Pause background audio and press Start to retry."));
    }, MAX_UTTERANCE_MS);
    const preroll = this.#speechPreroll;
    this.#speechPreroll = [];
    for (const buffered of preroll) {
      if (!this.#ownsTurn(epoch, turn)) return;
      await this.#feedChunk(buffered.pcm16, buffered.sampleRate, buffered.channels);
      if (!this.#ownsTurn(epoch, turn)) return;
      await this.#observeLocalEou(buffered.pcm16, buffered.sampleRate, buffered.channels);
    }
  }

  #ownsTurn(epoch: number, turn: number): boolean {
    return this.#running && epoch === this.#lifecycleEpoch && turn === this.#turn;
  }

  async #feedChunk(pcm16: Int16Array, sampleRate: number, channels: number): Promise<void> {
    this.#utteranceAudioMs += pcm16.length / channels / sampleRate * 1_000;
    if (this.#utteranceAudioMs > MAX_UTTERANCE_MS) {
      const error = new Error("Moonshine speech exceeded the 60-second turn limit. No command was submitted. Use shorter phrases and press Start to retry.");
      this.#fail(error);
      throw error;
    }
    await this.#api.feedMoonshineAudio(pcm16, sampleRate, channels);
  }

  #armFinalizationDeadline(): void {
    if (this.#finalizationTimer !== null) return;
    this.#finalizationTimer = setTimeout(() => {
      this.#fail(new Error("Moonshine timed out finishing speech. No command was submitted. Press Start to reconnect."));
    }, FINALIZATION_TIMEOUT_MS);
  }

  #waitForTurnOperation(operation: Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this.#turnWaiters.add(waiter);
      operation.then(
        () => { this.#turnWaiters.delete(waiter); resolve(); },
        (error) => { this.#turnWaiters.delete(waiter); reject(asError(error)); },
      );
    });
  }

  #clearPollTimer(): void {
    if (this.#pollTimer !== null) clearTimeout(this.#pollTimer);
    this.#pollTimer = null;
  }
}

function assertAudio(pcm16: Int16Array, sampleRate: number, channels: number): void {
  if (!(pcm16 instanceof Int16Array)
    || pcm16.length === 0
    || !Number.isInteger(sampleRate)
    || sampleRate < 8_000
    || sampleRate > 48_000
    || !Number.isInteger(channels)
    || channels < 1
    || channels > 2
    || pcm16.length % channels !== 0) {
    throw new TypeError("Moonshine renderer audio is invalid");
  }
}

function rms(samples: Int16Array): number {
  let sum = 0;
  for (const sample of samples) {
    const normalized = sample / 32_768;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / samples.length);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isInactiveRuntimeError(value: unknown): boolean {
  return value instanceof Error && /runtime is not active|runtime is unavailable/.test(value.message);
}
