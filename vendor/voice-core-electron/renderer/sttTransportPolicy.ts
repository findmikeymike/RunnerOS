type RendererSttConfiguration =
  | { provider: "assembly_ai" }
  | { provider: "moonshine"; modelId: string; computePolicy: "cpu" };

type MoonshineTierStatus = {
  modelId: string;
  registered: boolean;
  installState: string;
};

const DESKTOP_MOONSHINE_PRIORITY = [
  "moonshine-small-streaming-en",
  "moonshine-tiny-streaming-en",
  "moonshine-medium-streaming-en",
] as const;

export function selectReadyMoonshineModel(
  selectedModelId: string | null,
  tiers: MoonshineTierStatus[],
): string | null {
  const ready = (modelId: string) => tiers.some((tier) =>
    tier.modelId === modelId && tier.registered && tier.installState === "ready");
  if (selectedModelId && ready(selectedModelId)) return selectedModelId;
  return DESKTOP_MOONSHINE_PRIORITY.find(ready) ?? null;
}

/** Exhaustively assert that a validated selection has a renderer transport route. */
export function assertRendererSttTransportReady(config: RendererSttConfiguration): void {
  if (config.provider !== "assembly_ai" && config.provider !== "moonshine") {
    const neverProvider: never = config;
    throw new Error(`Unsupported renderer STT transport: ${String(neverProvider)}`);
  }
}

/**
 * Moonshine is implemented by Electron's native transport. Do not pass that
 * provider identity into VoiceCoreWeb, where Moonshine is intentionally
 * rejected for ordinary browser consumers.
 */
export function webRuntimeSttConfig(
  config: RendererSttConfiguration,
): { sttProvider?: "assembly_ai" } {
  return config.provider === "assembly_ai" ? { sttProvider: "assembly_ai" } : {};
}
