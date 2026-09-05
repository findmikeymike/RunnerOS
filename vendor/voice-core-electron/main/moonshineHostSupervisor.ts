import {
  parseMoonshineModelId,
  type ElectronMoonshineHost,
  type MoonshineModelId,
} from "./moonshineModels.js";
import { MoonshineSidecarTerminationError } from "./moonshineSidecarHost.js";

export interface ManagedMoonshineHost extends ElectronMoonshineHost {
  isAvailable(): boolean;
  shutdownAndWait(): Promise<void>;
}

/** Recreates a failed helper only at an explicit validation/start boundary.
 * Audio, model writes and controls are never retried against a new process.
 */
export class MoonshineHostSupervisor implements ElectronMoonshineHost {
  #host: ManagedMoonshineHost | null = null;
  #retired: ManagedMoonshineHost | null = null;
  #launching: Promise<void> | null = null;
  #retiring: Promise<void> | null = null;
  #closed = false;
  #runtimeEpoch = 0;
  #cancelEpoch = 0;
  #controls = new Set<Promise<void>>();
  #runtimeActive = false;
  #starting = false;
  #stageHosts = new Map<MoonshineModelId, ManagedMoonshineHost>();

  constructor(private readonly launch: () => Promise<ManagedMoonshineHost>) {}

  ensureAvailable(): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("Moonshine native host supervisor is shut down"));
    if (this.#launching) return this.#launching;
    if (this.#host?.isAvailable()) return Promise.resolve();
    this.#launching = this.#ensure().finally(() => { this.#launching = null; });
    return this.#launching;
  }

  async #ensure(): Promise<void> {
    if (this.#host) await this.#retire(this.#host);
    if (this.#retired) await this.#retire(this.#retired);
    if (this.#closed) throw new Error("Moonshine native host supervisor is shut down");
    // One launch per explicit attempt. Failed initialization must reap its child
    // before rejecting; launchMoonshineSidecarHost enforces that contract.
    let host: ManagedMoonshineHost;
    try { host = await this.launch(); }
    catch (error) {
      if (error instanceof MoonshineSidecarTerminationError) this.#retired = error.host;
      throw error;
    }
    if (this.#closed) {
      await this.#retire(host);
      throw new Error("Moonshine native host supervisor is shut down");
    }
    this.#host = host;
  }

  #requireHost(): ManagedMoonshineHost {
    if (this.#closed || !this.#host?.isAvailable()) {
      throw new Error("Moonshine native host is unavailable; start again to recover");
    }
    return this.#host;
  }

  async #call<T>(operation: (host: ManagedMoonshineHost) => Promise<T>, runtime = false): Promise<T> {
    const host = this.#requireHost();
    const epoch = this.#runtimeEpoch;
    if (runtime && !this.#runtimeActive) throw new Error("Moonshine runtime is not active");
    try {
      const result = await operation(host);
      if (this.#closed || host !== this.#host || (runtime && epoch !== this.#runtimeEpoch)) {
        throw new Error("Moonshine native request belongs to an ended session");
      }
      return result;
    } catch (error) {
      if (!host.isAvailable()) void this.#retire(host).catch(() => undefined);
      throw error;
    }
  }

  #retire(host: ManagedMoonshineHost): Promise<void> {
    if (this.#host && this.#host !== host) return Promise.resolve();
    if (this.#host === host) {
      this.#host = null;
      this.#runtimeActive = false;
      this.#runtimeEpoch += 1;
    }
    // The retired reference survives termination failure: never launch a second
    // helper until the previous process is positively known to have exited.
    if (this.#retired && this.#retired !== host) {
      return Promise.reject(new Error("Moonshine native host retirement is already pending"));
    }
    this.#retired = host;
    if (this.#retiring) return this.#retiring;
    host.shutdown();
    this.#retiring = host.shutdownAndWait().then(() => {
      if (this.#retired === host) this.#retired = null;
    }).finally(() => { this.#retiring = null; });
    return this.#retiring;
  }

  capabilities() { return this.#call((host) => host.capabilities()); }
  listTiers() { return this.#call((host) => host.listTiers()); }
  getTierStatus(modelId: unknown) { return this.#call((host) => host.getTierStatus(modelId)); }
  installBundled(modelId: unknown) { return this.#call((host) => host.installBundled(modelId)); }
  installStaged(modelId: unknown) {
    return this.#stagedCall(modelId, (host, parsed) => host.installStaged(parsed));
  }
  async beginStaged(modelId: unknown) {
    const parsed = parseMoonshineModelId(modelId);
    const host = this.#requireHost();
    this.#stageHosts.set(parsed, host);
    await this.#call((current) => current.beginStaged(parsed));
  }
  writeStaged(modelId: unknown, asset: "manifest" | "archive", chunk: Uint8Array) {
    return this.#stagedCall(modelId, (host, parsed) => host.writeStaged(parsed, asset, chunk));
  }
  finishStaged(modelId: unknown) { return this.#stagedCall(modelId, (host, parsed) => host.finishStaged(parsed)); }
  async cleanupStaged(modelId: unknown) {
    const parsed = parseMoonshineModelId(modelId);
    this.#stageHosts.delete(parsed);
    return this.#call((host) => host.cleanupStaged(parsed));
  }
  async #stagedCall<T>(modelId: unknown, operation: (host: ManagedMoonshineHost, parsed: MoonshineModelId) => Promise<T>) {
    const parsed = parseMoonshineModelId(modelId);
    if (this.#stageHosts.get(parsed) !== this.#requireHost()) {
      throw new Error("Moonshine model download belongs to an ended host; retry the download");
    }
    return this.#call((host) => operation(host, parsed));
  }
  cancelInstall(modelId: unknown) { return this.#call((host) => host.cancelInstall(modelId)); }
  remove(modelId: unknown) { return this.#call((host) => host.remove(modelId)); }

  async startRuntime(modelId: unknown) {
    const parsed = parseMoonshineModelId(modelId);
    if (this.#starting || (this.#runtimeActive && this.#host?.isAvailable())) {
      throw new Error("Moonshine runtime is already active");
    }
    this.#starting = true;
    const cancellation = this.#cancelEpoch;
    try {
      await Promise.allSettled([...this.#controls]);
      await this.ensureAvailable();
      if (cancellation !== this.#cancelEpoch) throw new Error("Moonshine runtime start was cancelled");
      const epoch = ++this.#runtimeEpoch;
      const host = this.#requireHost();
      let result;
      try { result = await this.#call((current) => current.startRuntime(parsed)); }
      catch (error) {
        await this.#retire(host);
        throw error;
      }
      if (epoch !== this.#runtimeEpoch || this.#closed) throw new Error("Moonshine runtime start was cancelled");
      this.#runtimeActive = true;
      return result;
    } finally {
      this.#starting = false;
    }
  }

  feedRuntimeAudio(audio: Uint8Array, sampleRateHz: number, channels: number) {
    return this.#call((host) => host.feedRuntimeAudio(audio, sampleRateHz, channels), true);
  }
  async pollRuntime() {
    const host = this.#requireHost();
    const result = await this.#call((current) => current.pollRuntime(), true);
    if (result.hasError || result.preparationState === "failed") {
      void this.#retire(host).catch(() => undefined);
      throw new Error("Moonshine native STT runtime failed; start again to recover");
    }
    return result;
  }
  requestRuntimeFinalization(turn: number) { return this.#call((host) => host.requestRuntimeFinalization(turn), true); }
  finishRuntimeTurn(turn: number) { return this.#call((host) => host.finishRuntimeTurn(turn), true); }
  #trackControl(operation: Promise<void>): Promise<void> {
    this.#controls.add(operation);
    void operation.then(() => this.#controls.delete(operation), () => this.#controls.delete(operation));
    return operation;
  }
  cancelRuntime(): Promise<void> { return this.#trackControl(this.#cancel()); }
  async #cancel(): Promise<void> {
    const host = this.#host;
    this.#runtimeActive = false;
    this.#runtimeEpoch += 1;
    this.#cancelEpoch += 1;
    if (!host || !host.isAvailable()) return;
    try { await host.cancelRuntime(); }
    catch (error) {
      if (host === this.#host) await this.#retire(host);
      throw error;
    }
  }
  stopRuntime(): Promise<void> { return this.#trackControl(this.#stop()); }
  async #stop(): Promise<void> {
    const host = this.#host;
    this.#runtimeActive = false;
    this.#runtimeEpoch += 1;
    this.#cancelEpoch += 1;
    if (!host) {
      if (this.#retired) await this.#retire(this.#retired);
      return;
    }
    try { await host.stopRuntime(); }
    catch {
      // Native Stop may time out while model preparation is noninterruptible.
      // Process exit is an equally valid, definitive release of the session.
      await this.#retire(host);
    }
  }
  acceptsModel(modelId: MoonshineModelId): boolean {
    return !this.#closed && Boolean(this.#host?.isAvailable() && this.#host.acceptsModel(modelId));
  }
  shutdown(): void {
    this.#closed = true;
    this.#runtimeActive = false;
    this.#runtimeEpoch += 1;
    this.#cancelEpoch += 1;
    if (this.#host) void this.#retire(this.#host).catch(() => undefined);
  }

  async shutdownAndWait(): Promise<void> {
    this.shutdown();
    if (this.#launching) await this.#launching.catch(() => undefined);
    if (this.#retired) await this.#retire(this.#retired);
  }
}
