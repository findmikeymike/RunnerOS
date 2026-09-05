import type { ElectronMoonshineTierStatus, MoonshineModelId } from "./moonshineModels.js";

/** Owns the entire install transaction, including preflight and final cleanup.
 * The acquirer's download-only lock ends before native installation starts.
 */
export class MoonshineInstallCoordinator {
  readonly #active = new Map<MoonshineModelId, {
    promise: Promise<ElectronMoonshineTierStatus>;
    canceled: boolean;
  }>();

  run(modelId: MoonshineModelId, install: (isCanceled: () => boolean) => Promise<ElectronMoonshineTierStatus>): Promise<ElectronMoonshineTierStatus> {
    const active = this.#active.get(modelId);
    if (active) return active.promise;
    const state = { canceled: false, promise: null! as Promise<ElectronMoonshineTierStatus> };
    const transaction = Promise.resolve().then(() => install(() => state.canceled)).finally(() => {
      if (this.#active.get(modelId) === state) this.#active.delete(modelId);
    });
    state.promise = transaction;
    this.#active.set(modelId, state);
    return transaction;
  }

  cancel(modelId: MoonshineModelId): void {
    const active = this.#active.get(modelId);
    if (active) active.canceled = true;
  }
}
