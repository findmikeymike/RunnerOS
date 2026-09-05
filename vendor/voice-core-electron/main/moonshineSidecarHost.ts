import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, constants, lstatSync, openSync } from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import {
  MOONSHINE_MODEL_REGISTRY,
  parseMoonshineModelId,
  type ElectronMoonshineCapabilities,
  type ElectronMoonshineHost,
  type ElectronMoonshineRuntimePoll,
  type ElectronMoonshineRuntimeStarted,
  type ElectronMoonshineTierStatus,
  type MoonshineInstallState,
  type MoonshineModelId,
} from "./moonshineModels.js";

const APP_IDENTIFIER = "com.voicecore.electron";
const HOST_EXECUTABLE = "voice-core-moonshine-host";
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_PENDING_REQUESTS = 64;
const DEFAULT_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const MAX_STAGING_CHUNK_BYTES = 192 * 1024;
const MAX_AUDIO_MILLISECONDS = 100;
const INSTALL_STATES = new Set<MoonshineInstallState>([
  "unavailable",
  "not_installed",
  "checking",
  "downloading",
  "verifying",
  "installing",
  "ready",
  "update_available",
  "failed",
  "revoked",
  "incompatible",
]);
const SAFE_HOST_ERRORS = new Set([
  "Moonshine model ID is required",
  "Unsupported Moonshine model ID",
  "Moonshine model ID is not valid for this request",
  "Bundled Moonshine pack is unavailable",
  "Staged Moonshine pack is unavailable",
  "Moonshine staged pack cleanup failed",
  "Moonshine staged pack write failed",
  "Moonshine staged pack state failed",
  "Moonshine signed pack installation failed",
  "Moonshine protected model storage is unavailable; this app needs a signed native host",
  "Moonshine install cancellation failed",
  "Moonshine model removal failed",
  "Requested Moonshine tier is unavailable",
  "Moonshine model status validation failed",
  "candidate registry storage failed",
  "candidate registry rollback validation failed",
  "candidate registry contract failed",
  "candidate registry integrity failed",
  "candidate registry trust failed",
  "candidate registry state failed",
  "Moonshine native runtime is unavailable",
  "Moonshine runtime is already active",
  "Moonshine runtime is not active",
  "Moonshine runtime state failed",
  "Moonshine runtime generation failed",
  "Moonshine verified runtime creation failed",
  "Moonshine runtime preparation failed",
  "Moonshine runtime stream failed",
  "Moonshine audio payload is required",
  "Moonshine audio sample rate is required",
  "Moonshine audio channel count is required",
  "Moonshine audio payload is invalid",
  "Moonshine audio payload exceeds its limit",
  "Moonshine audio format is unsupported",
  "Moonshine audio format changed during an active stream",
  "Moonshine audio normalizer failed",
  "Moonshine audio normalization failed",
  "Moonshine audio input was rejected",
  "Moonshine runtime polling failed",
  "Moonshine transcript collection failed",
  "Moonshine runtime generation mismatch",
  "Moonshine transcript exceeded its limit",
  "Moonshine turn is required",
  "Moonshine turn 0 is reserved",
  "Moonshine finalization request failed",
  "Moonshine turn completion failed",
  "Moonshine runtime cancellation failed",
  "Moonshine runtime shutdown failed",
  "Moonshine request parameters are invalid",
]);
const INSTALL_STATE_PRIORITY: readonly MoonshineInstallState[] = [
  "installing",
  "verifying",
  "downloading",
  "checking",
  "failed",
  "revoked",
  "incompatible",
  "update_available",
  "ready",
  "not_installed",
  "unavailable",
];

type SidecarMethod =
  | "hello"
  | "listTiers"
  | "getTierStatus"
  | "installBundled"
  | "installStaged"
  | "beginStaged"
  | "writeStaged"
  | "finishStaged"
  | "cleanupStaged"
  | "cancelInstall"
  | "removeModel"
  | "startRuntime"
  | "feedAudio"
  | "pollRuntime"
  | "requestFinalization"
  | "finishTurn"
  | "cancelRuntime"
  | "stopRuntime";

type SidecarRequestParameters = {
  modelId?: MoonshineModelId;
  audioBase64?: string;
  sampleRateHz?: number;
  channels?: number;
  turn?: number;
  stageAsset?: "manifest" | "archive";
  chunkBase64?: string;
};

type SidecarHello = {
  protocolVersion: 1;
  appIdentifier: typeof APP_IDENTIFIER;
  protectedStorageAvailable: boolean;
} & (
  | { mode: "candidate-assets-only"; runtimeAvailable: false }
  | { mode: "candidate-native"; runtimeAvailable: true }
);

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

type SidecarProcess = ChildProcess & {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
};

export type MoonshineSidecarLaunchOptions = {
  isPackaged: boolean;
  mainModuleDirectory: string;
  resourcesDirectory: string;
  userDataDirectory: string;
  /** Trusted main-process configuration only, never renderer input. */
  executablePath?: string;
};

export class MoonshineSidecarTerminationError extends Error {
  constructor(readonly host: ElectronMoonshineHost & {
    isAvailable(): boolean;
    shutdownAndWait(): Promise<void>;
  }) {
    super("Moonshine native host termination could not be confirmed");
  }
}

export function resolveMoonshineSidecarExecutable(
  options: Pick<MoonshineSidecarLaunchOptions, "isPackaged" | "mainModuleDirectory" | "resourcesDirectory" | "executablePath">,
): string {
  // Production always uses the packaged helper. Consumers may locate their
  // development helper without depending on this example app's folder layout.
  if (!options.isPackaged && options.executablePath !== undefined) {
    if (!path.isAbsolute(options.executablePath)) throw new Error("Moonshine helper path must be absolute");
    return options.executablePath;
  }
  return options.isPackaged
    ? path.join(options.resourcesDirectory, "voice-core", "bin", HOST_EXECUTABLE)
    : path.resolve(options.mainModuleDirectory, "../../../../target/debug", HOST_EXECUTABLE);
}

export async function launchMoonshineSidecarHost(
  options: MoonshineSidecarLaunchOptions,
): Promise<ElectronMoonshineSidecarHost> {
  if (process.platform !== "darwin") {
    throw new Error("Moonshine Electron native host is unavailable on this platform");
  }
  const executable = resolveMoonshineSidecarExecutable(options);
  assertRegularExecutable(executable);

  const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  const appDataFd = openSync(options.userDataDirectory, directoryFlags);
  let resourcesFd: number | undefined;
  let child: SidecarProcess;
  try {
    resourcesFd = openSync(options.resourcesDirectory, directoryFlags);
    const spawned = spawn(executable, [], {
      stdio: ["pipe", "pipe", "pipe", appDataFd, resourcesFd],
      windowsHide: true,
    });
    if (!spawned.stdin || !spawned.stdout || !spawned.stderr) {
      spawned.kill();
      throw new Error("Moonshine Electron native host pipes are unavailable");
    }
    child = spawned as SidecarProcess;
  } finally {
    closeSync(appDataFd);
    if (resourcesFd !== undefined) closeSync(resourcesFd);
  }

  const host = new ElectronMoonshineSidecarHost(child);
  try {
    await host.initialize();
    return host;
  } catch {
    try { await host.shutdownAndWait(); }
    catch { throw new MoonshineSidecarTerminationError(host); }
    throw new Error("Moonshine Electron native host failed to initialize");
  }
}

function assertRegularExecutable(executable: string): void {
  const metadata = lstatSync(executable);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o111) === 0) {
    throw new Error("Moonshine Electron native host is not a trusted executable");
  }
}

export class ElectronMoonshineSidecarHost implements ElectronMoonshineHost {
  readonly #child: SidecarProcess;
  readonly #pending = new Map<number, PendingRequest>();
  #buffer = Buffer.alloc(0);
  #hello: SidecarHello | null = null;
  #nextId = 1;
  #closed = false;
  #termination: Promise<void> | null = null;

  constructor(child: SidecarProcess) {
    this.#child = child;
    child.stdout.on("data", (chunk: Buffer) => this.#acceptOutput(chunk));
    child.stderr.on("data", () => {
      // Drain fixed native diagnostics without forwarding them to the renderer.
    });
    child.once("error", () => this.#fail("Moonshine native host process failed"));
    child.once("exit", () => this.#fail("Moonshine native host process exited"));
  }

  async initialize(): Promise<void> {
    const hello = parseHello(await this.#request("hello"));
    if (this.#closed) throw new Error("Moonshine native host is unavailable");
    this.#hello = hello;
  }

  async capabilities(): Promise<ElectronMoonshineCapabilities> {
    const hello = this.#requireHello();
    const statuses = await this.listTiers();
    const installState = INSTALL_STATE_PRIORITY.find((state) =>
      statuses.some((status) => status.installState === state)) ?? "unavailable";
    const modelReady = statuses.some((status) => status.registered && status.installState === "ready");
    return {
      localStt: hello.runtimeAvailable && modelReady,
      moonshineCompiled: hello.runtimeAvailable,
      moonshineRuntimeAvailable: hello.runtimeAvailable,
      moonshineModelReady: modelReady,
      moonshineModelInstall: hello.protectedStorageAvailable
        && statuses.some((status) => status.registered),
      moonshineRuntimeMode: "candidate",
      moonshineInstallState: installState,
      moonshinePreparationState: "idle",
      moonshineSupportStatus: hello.runtimeAvailable ? "experimental" : "unavailable",
    };
  }

  async listTiers(): Promise<ElectronMoonshineTierStatus[]> {
    this.#requireHello();
    const value = await this.#request("listTiers");
    if (!Array.isArray(value) || value.length !== MOONSHINE_MODEL_REGISTRY.length) {
      throw new Error("Moonshine native host returned an invalid tier registry");
    }
    const statuses = value.map(parseTierStatus);
    if (statuses.some((status, index) => status.modelId !== MOONSHINE_MODEL_REGISTRY[index].modelId)) {
      throw new Error("Moonshine native host returned an invalid tier registry");
    }
    return statuses;
  }

  async getTierStatus(modelId: unknown): Promise<ElectronMoonshineTierStatus> {
    return parseTierStatus(await this.#request("getTierStatus", {
      modelId: parseMoonshineModelId(modelId),
    }));
  }

  async installBundled(modelId: unknown): Promise<ElectronMoonshineTierStatus> {
    this.#requireProtectedStorage();
    return parseTierStatus(await this.#request(
      "installBundled",
      { modelId: parseMoonshineModelId(modelId) },
      INSTALL_TIMEOUT_MS,
    ));
  }

  async installStaged(modelId: unknown): Promise<ElectronMoonshineTierStatus> {
    this.#requireProtectedStorage();
    return parseTierStatus(await this.#request(
      "installStaged",
      { modelId: parseMoonshineModelId(modelId) },
      INSTALL_TIMEOUT_MS,
    ));
  }

  async cleanupStaged(modelId: unknown): Promise<void> {
    this.#requireProtectedStorage();
    parseAccepted(await this.#request("cleanupStaged", {
      modelId: parseMoonshineModelId(modelId),
    }));
  }

  async beginStaged(modelId: unknown): Promise<void> {
    this.#requireProtectedStorage();
    parseAccepted(await this.#request("beginStaged", {
      modelId: parseMoonshineModelId(modelId),
    }));
  }

  async writeStaged(
    modelId: unknown,
    stageAsset: "manifest" | "archive",
    chunk: Uint8Array,
  ): Promise<void> {
    this.#requireProtectedStorage();
    if ((stageAsset !== "manifest" && stageAsset !== "archive")
      || !(chunk instanceof Uint8Array) || chunk.byteLength === 0
      || chunk.byteLength > MAX_STAGING_CHUNK_BYTES) {
      throw new Error("Moonshine staged pack chunk is invalid");
    }
    const chunkBase64 = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString("base64");
    parseAccepted(await this.#request("writeStaged", {
      modelId: parseMoonshineModelId(modelId),
      stageAsset,
      chunkBase64,
    }));
  }

  async finishStaged(modelId: unknown): Promise<void> {
    this.#requireProtectedStorage();
    parseAccepted(await this.#request("finishStaged", {
      modelId: parseMoonshineModelId(modelId),
    }));
  }

  async cancelInstall(modelId: unknown): Promise<ElectronMoonshineTierStatus> {
    this.#requireProtectedStorage();
    return parseTierStatus(await this.#request("cancelInstall", {
      modelId: parseMoonshineModelId(modelId),
    }));
  }

  async remove(modelId: unknown): Promise<ElectronMoonshineTierStatus> {
    this.#requireProtectedStorage();
    return parseTierStatus(await this.#request("removeModel", {
      modelId: parseMoonshineModelId(modelId),
    }));
  }

  async startRuntime(modelId: unknown): Promise<ElectronMoonshineRuntimeStarted> {
    this.#requireRuntime();
    return parseRuntimeStarted(await this.#request("startRuntime", {
      modelId: parseMoonshineModelId(modelId),
    }));
  }

  async feedRuntimeAudio(
    audio: Uint8Array,
    sampleRateHz: number,
    channels: number,
  ): Promise<void> {
    this.#requireRuntime();
    assertAudioRequest(audio, sampleRateHz, channels);
    const audioBase64 = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength).toString("base64");
    parseAccepted(await this.#request("feedAudio", { audioBase64, sampleRateHz, channels }));
  }

  async pollRuntime(): Promise<ElectronMoonshineRuntimePoll> {
    this.#requireRuntime();
    return parseRuntimePoll(await this.#request("pollRuntime"));
  }

  async requestRuntimeFinalization(turn: number): Promise<void> {
    this.#requireRuntime();
    assertTurn(turn);
    parseAccepted(await this.#request("requestFinalization", { turn }));
  }

  async finishRuntimeTurn(turn: number): Promise<void> {
    this.#requireRuntime();
    assertTurn(turn);
    parseAccepted(await this.#request("finishTurn", { turn }));
  }

  async cancelRuntime(): Promise<void> {
    this.#requireRuntime();
    parseAccepted(await this.#request("cancelRuntime"));
  }

  async stopRuntime(): Promise<void> {
    this.#requireRuntime();
    const value = await this.#request("stopRuntime");
    if (!isRecord(value) || value.stopped !== true) {
      throw new Error("Moonshine native host returned invalid runtime state");
    }
    parseMoonshineModelId(value.modelId);
  }

  acceptsModel(_modelId: MoonshineModelId): boolean {
    return this.#hello?.runtimeAvailable === true && !this.#closed;
  }

  shutdown(): void {
    this.#closed = true;
    this.#rejectPending("Moonshine native host shut down");
    this.#child.stdin.end();
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill();
    }
  }

  isAvailable(): boolean { return !this.#closed; }

  shutdownAndWait(): Promise<void> {
    if (this.#termination) return this.#termination;
    this.#termination = this.#terminate().catch((error) => {
      this.#termination = null;
      throw error;
    });
    return this.#termination;
  }

  async #terminate(): Promise<void> {
    this.shutdown();
    if (await this.#waitForExit(2_000)) return;
    this.#child.kill("SIGKILL");
    if (await this.#waitForExit(2_000)) return;
    throw new Error("Moonshine native host termination could not be confirmed");
  }

  #waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null || !this.#child.pid) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const onExit = () => { clearTimeout(timer); resolve(true); };
      const timer = setTimeout(() => {
        this.#child.removeListener("exit", onExit);
        resolve(false);
      }, timeoutMs);
      this.#child.once("exit", onExit);
    });
  }

  #requireHello(): SidecarHello {
    if (this.#closed) throw new Error("Moonshine native host is unavailable");
    if (!this.#hello) throw new Error("Moonshine native host is not initialized");
    return this.#hello;
  }

  #requireProtectedStorage(): void {
    if (!this.#requireHello().protectedStorageAvailable) {
      throw new Error("Moonshine protected model storage is unavailable");
    }
  }

  #requireRuntime(): void {
    if (!this.#requireHello().runtimeAvailable) {
      throw new Error("Moonshine native runtime is unavailable in this Electron build");
    }
  }

  #request(
    method: SidecarMethod,
    parameters: SidecarRequestParameters = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<unknown> {
    if (this.#closed || !this.#child.stdin.writable) {
      return Promise.reject(new Error("Moonshine native host is unavailable"));
    }
    if (this.#pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new Error("Moonshine native host request limit reached"));
    }
    const id = this.#nextId;
    this.#nextId = this.#nextId >= Number.MAX_SAFE_INTEGER ? 1 : this.#nextId + 1;
    const payload = JSON.stringify({ id, method, ...parameters });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#fail("Moonshine native host request timed out");
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#child.stdin.write(`${payload}\n`, (error) => {
        if (!error) return;
        const pending = this.#pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(id);
        pending.reject(new Error("Moonshine native host request failed"));
      });
    });
  }

  #acceptOutput(chunk: Buffer): void {
    if (this.#closed) return;
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    while (true) {
      const newline = this.#buffer.indexOf(0x0a);
      if (newline < 0) {
        if (this.#buffer.length > MAX_RESPONSE_BYTES) {
          this.#fail("Moonshine native host response exceeded its limit");
        }
        return;
      }
      if (newline > MAX_RESPONSE_BYTES) {
        this.#fail("Moonshine native host response exceeded its limit");
        return;
      }
      const line = this.#buffer.subarray(0, newline);
      this.#buffer = this.#buffer.subarray(newline + 1);
      this.#acceptLine(line);
      if (this.#closed) return;
    }
  }

  #acceptLine(line: Buffer): void {
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line));
    } catch {
      this.#fail("Moonshine native host returned invalid JSON");
      return;
    }
    if (!isRecord(value) || !Number.isSafeInteger(value.id) || value.id as number <= 0) {
      this.#fail("Moonshine native host returned an invalid response");
      return;
    }
    const id = value.id as number;
    const pending = this.#pending.get(id);
    if (!pending || typeof value.ok !== "boolean") {
      this.#fail("Moonshine native host returned an unexpected response");
      return;
    }
    clearTimeout(pending.timer);
    this.#pending.delete(id);
    if (value.ok) {
      pending.resolve(value.result);
    } else {
      pending.reject(new Error(typeof value.error === "string" && SAFE_HOST_ERRORS.has(value.error)
        ? value.error
        : "Moonshine native host request failed"));
    }
  }

  #fail(message: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#rejectPending(message);
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill();
    }
  }

  #rejectPending(message: string): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.#pending.clear();
  }
}

function parseHello(value: unknown): SidecarHello {
  const validMode = isRecord(value)
    && ((value.mode === "candidate-assets-only" && value.runtimeAvailable === false)
      || (value.mode === "candidate-native" && value.runtimeAvailable === true));
  if (!isRecord(value)
    || value.protocolVersion !== 1
    || value.appIdentifier !== APP_IDENTIFIER
    || !validMode
    || typeof value.protectedStorageAvailable !== "boolean") {
    throw new Error("Moonshine native host handshake is invalid");
  }
  return value as SidecarHello;
}

function parseTierStatus(value: unknown): ElectronMoonshineTierStatus {
  if (!isRecord(value)) throw new Error("Moonshine native host returned invalid model status");
  const modelId = parseMoonshineModelId(value.modelId);
  const definition = MOONSHINE_MODEL_REGISTRY.find((candidate) => candidate.modelId === modelId)!;
  if (value.productTier !== definition.productTier
    || !equalStrings(value.targetClasses, definition.targetClasses)
    || value.supportStatus !== definition.supportStatus
    || value.requiredTotalBytes !== definition.requiredTotalBytes
    || typeof value.registered !== "boolean"
    || typeof value.installState !== "string"
    || !INSTALL_STATES.has(value.installState as MoonshineInstallState)
    || typeof value.inUse !== "boolean"
    || typeof value.hasError !== "boolean") {
    throw new Error("Moonshine native host returned invalid model status");
  }
  return {
    ...definition,
    registered: value.registered,
    installState: value.installState as MoonshineInstallState,
    modelVersion: optionalString(value.modelVersion),
    completedBytes: optionalSafeInteger(value.completedBytes),
    totalBytes: optionalSafeInteger(value.totalBytes),
    activeVersion: optionalString(value.activeVersion),
    inUse: value.inUse,
    hasError: value.hasError,
  };
}

const PREPARATION_STATES = new Set(["unprepared", "preparing", "ready", "failed"]);

function parseRuntimeStarted(value: unknown): ElectronMoonshineRuntimeStarted {
  if (!isRecord(value)
    || !Number.isSafeInteger(value.generation)
    || (value.generation as number) <= 0
    || typeof value.preparationState !== "string"
    || !PREPARATION_STATES.has(value.preparationState)) {
    throw new Error("Moonshine native host returned invalid runtime state");
  }
  return {
    modelId: parseMoonshineModelId(value.modelId),
    generation: value.generation as number,
    preparationState: value.preparationState as ElectronMoonshineRuntimeStarted["preparationState"],
  };
}

function parseRuntimePoll(value: unknown): ElectronMoonshineRuntimePoll {
  const started = parseRuntimeStarted(value);
  if (!isRecord(value)
    || !Array.isArray(value.tokens)
    || typeof value.finalizedTranscript !== "string"
    || typeof value.hasError !== "boolean") {
    throw new Error("Moonshine native host returned invalid runtime poll");
  }
  const tokens = value.tokens.map((token) => {
    if (!isRecord(token)
      || typeof token.text !== "string"
      || typeof token.confidence !== "number"
      || !Number.isFinite(token.confidence)
      || token.confidence < 0
      || token.confidence > 1
      || typeof token.isFinal !== "boolean") {
      throw new Error("Moonshine native host returned invalid runtime poll");
    }
    return {
      text: token.text,
      confidence: token.confidence,
      isFinal: token.isFinal,
    };
  });
  const textBytes = tokens.reduce((total, token) => total + Buffer.byteLength(token.text),
    Buffer.byteLength(value.finalizedTranscript));
  if (textBytes > 48 * 1024) {
    throw new Error("Moonshine native host returned invalid runtime poll");
  }
  let finalizationAck: ElectronMoonshineRuntimePoll["finalizationAck"];
  if (value.finalizationAck !== null && value.finalizationAck !== undefined) {
    const ack = value.finalizationAck;
    if (!isRecord(ack)
      || !isPositiveSafeInteger(ack.generation)
      || !isPositiveSafeInteger(ack.turn)
      || !isPositiveSafeInteger(ack.providerEpoch)
      || !Number.isSafeInteger(ack.throughAudioSeq)
      || (ack.throughAudioSeq as number) < 0) {
      throw new Error("Moonshine native host returned invalid runtime poll");
    }
    finalizationAck = {
      generation: ack.generation as number,
      turn: ack.turn as number,
      providerEpoch: ack.providerEpoch as number,
      throughAudioSeq: ack.throughAudioSeq as number,
    };
  }
  return {
    ...started,
    tokens,
    finalizedTranscript: value.finalizedTranscript,
    finalizationAck,
    hasError: value.hasError,
  };
}

function parseAccepted(value: unknown): void {
  if (!isRecord(value) || value.accepted !== true || Object.keys(value).length !== 1) {
    throw new Error("Moonshine native host returned invalid runtime state");
  }
}

function assertAudioRequest(audio: Uint8Array, sampleRateHz: number, channels: number): void {
  if (!(audio instanceof Uint8Array)
    || !Number.isInteger(sampleRateHz)
    || sampleRateHz < 8_000
    || sampleRateHz > 48_000
    || !Number.isInteger(channels)
    || channels < 1
    || channels > 2
    || audio.byteLength === 0
    || audio.byteLength % (channels * 2) !== 0
    || audio.byteLength / (channels * 2) > sampleRateHz * MAX_AUDIO_MILLISECONDS / 1_000) {
    throw new TypeError("Moonshine audio request is invalid");
  }
}

function assertTurn(turn: number): void {
  if (!isPositiveSafeInteger(turn)) {
    throw new TypeError("Moonshine turn is invalid");
  }
}

function isPositiveSafeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new Error("Moonshine native host returned invalid model status");
  }
  return value;
}

function optionalSafeInteger(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value as number < 0) {
    throw new Error("Moonshine native host returned invalid model status");
  }
  return value as number;
}

function equalStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
