import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { MoonshineHostSupervisor } from '../../../../vendor/voice-core-electron/main/moonshineHostSupervisor'
import { launchMoonshineSidecarHost } from '../../../../vendor/voice-core-electron/main/moonshineSidecarHost'
import { MoonshineInstallCoordinator } from '../../../../vendor/voice-core-electron/main/moonshineInstallCoordinator'
import { parseMoonshineModelId } from '../../../../vendor/voice-core-electron/main/moonshineModels'

type Host = Pick<MoonshineHostSupervisor, 'ensureAvailable' | 'capabilities' | 'listTiers' | 'getTierStatus' | 'startRuntime' | 'feedRuntimeAudio' | 'pollRuntime' | 'requestRuntimeFinalization' | 'finishRuntimeTurn' | 'cancelRuntime' | 'stopRuntime' | 'installBundled' | 'shutdownAndWait'>
type Lease = { owner: number; sessionId: string; ended: boolean; pendingAudioMs: number; pendingFrames: number; polling: boolean; closing?: Promise<void> }

/** Main-process lease: late IPC from the same renderer cannot operate on its next session. */
export class ArtistManagerMoonshine {
  private lease: Lease | null = null
  private closed = false
  private installing = false
  private installs = new MoonshineInstallCoordinator()
  constructor(private host: Host) {}

  async invoke(owner: number, input: unknown): Promise<unknown> {
    if (this.closed) throw new Error('Moonshine is shutting down')
    if (!input || typeof input !== 'object') throw new Error('Invalid Moonshine request')
    const request = input as Record<string, unknown>
    if (request.method === 'status') {
      try {
        await this.host.ensureAvailable()
        const capabilities = await this.host.capabilities()
        const tiers = await this.host.listTiers()
        // An asset-only helper can install packs but cannot transcribe. Missing
        // models, conversely, do not make an otherwise usable runtime absent.
        const available = capabilities.moonshineCompiled && capabilities.moonshineRuntimeAvailable
        return available ? { available: true, tiers } : {
          available: false, tiers, error: 'This Moonshine helper does not include the native speech runtime.',
        }
      } catch {
        return { available: false, tiers: [], error: 'Moonshine native resources are unavailable. Install the Artist OS native voice resources.' }
      }
    }
    if (request.method === 'install') {
      const modelId = parseMoonshineModelId(request.modelId)
      if (this.lease || this.installing) throw new Error('Stop voice before installing a model')
      this.installing = true
      try {
        return await this.installs.run(modelId, async () => {
          await this.host.ensureAvailable()
          if (this.closed) throw new Error('Moonshine is shutting down')
          return this.host.installBundled(modelId)
        })
      } finally { this.installing = false }
    }
    if (typeof request.sessionId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(request.sessionId)) {
      throw new Error('Invalid Moonshine session ID')
    }
    if (request.method === 'start') {
      const modelId = parseMoonshineModelId(request.modelId)
      if (this.lease || this.installing) throw new Error('Moonshine is already in use')
      const lease: Lease = { owner, sessionId: request.sessionId, ended: false, pendingAudioMs: 0, pendingFrames: 0, polling: false }
      this.lease = lease
      try {
        await this.host.ensureAvailable()
        this.assertCurrent(lease)
        const tier = await this.host.getTierStatus(modelId)
        this.assertCurrent(lease)
        if (tier.modelId !== modelId || !tier.registered || tier.installState !== 'ready' || tier.hasError) {
          throw new Error('The selected Moonshine model is not installed and ready')
        }
        const started = await this.host.startRuntime(modelId)
        this.assertCurrent(lease)
        return started
      } catch (error) {
        await this.release(lease)
        throw error
      }
    }
    const lease = this.lease
    // Transport teardown invokes cancel then stop, including after a failed
    // start. Idempotence applies only to an empty slot, never another lease.
    if (!lease && (request.method === 'stop' || request.method === 'cancel')) return
    if (!lease || lease.owner !== owner || lease.sessionId !== request.sessionId) throw new Error('Moonshine session is not owned by this request')
    if (request.method === 'stop' || request.method === 'cancel') return this.release(lease)
    this.assertCurrent(lease)
    let result: unknown
    switch (request.method) {
      case 'feed': {
        const { audio, sampleRateHz, channels } = request
        if (!(audio instanceof Uint8Array) || typeof sampleRateHz !== 'number' || !Number.isInteger(sampleRateHz)
          || sampleRateHz < 8000 || sampleRateHz > 48000 || channels !== 1
          || audio.byteLength === 0 || audio.byteLength % 2 !== 0 || audio.byteLength > sampleRateHz * 0.1 * 2) {
          throw new Error('Moonshine audio must be mono PCM16, 8–48 kHz, at most 100 ms')
        }
        const audioMs = audio.byteLength / 2 / sampleRateHz * 1000
        if (lease.pendingFrames >= 128 || lease.pendingAudioMs + audioMs > 2000) throw new Error('Moonshine audio delivery is backlogged')
        lease.pendingAudioMs += audioMs
        lease.pendingFrames++
        try { result = await this.host.feedRuntimeAudio(audio, sampleRateHz, channels) }
        finally { lease.pendingAudioMs -= audioMs; lease.pendingFrames-- }
        break
      }
      case 'poll':
        if (lease.polling) throw new Error('Moonshine poll is already pending')
        lease.polling = true
        try { result = await this.host.pollRuntime() }
        finally { lease.polling = false }
        break
      case 'finalize':
      case 'finish':
        if (typeof request.turn !== 'number' || !Number.isSafeInteger(request.turn) || request.turn < 1) throw new Error('Invalid Moonshine turn')
        result = request.method === 'finalize'
          ? await this.host.requestRuntimeFinalization(request.turn)
          : await this.host.finishRuntimeTurn(request.turn)
        break
      default: throw new Error('Unknown Moonshine method')
    }
    this.assertCurrent(lease)
    return result
  }

  private assertCurrent(lease: Lease) {
    if (this.closed || lease.ended || this.lease !== lease) throw new Error('Moonshine session ended')
  }

  private release(lease: Lease): Promise<void> {
    if (lease.closing) return lease.closing
    lease.ended = true
    lease.closing = this.host.stopRuntime().finally(() => {
      if (this.lease === lease) this.lease = null
    })
    return lease.closing
  }

  releaseOwner(owner: number): Promise<void> {
    return this.lease?.owner === owner ? this.release(this.lease) : Promise.resolve()
  }

  async close() {
    this.closed = true
    if (this.lease) this.lease.ended = true
    await this.host.shutdownAndWait()
  }
}

export function createArtistManagerMoonshine(options: { isPackaged: boolean; resourcesDirectory: string; userDataDirectory: string }) {
  const host = new MoonshineHostSupervisor(async () => {
    mkdirSync(options.userDataDirectory, { recursive: true, mode: 0o700 })
    return launchMoonshineSidecarHost({
      ...options,
      mainModuleDirectory: options.resourcesDirectory,
      executablePath: join(options.resourcesDirectory, 'voice-core', 'bin', 'voice-core-moonshine-host'),
      expectedAppIdentifier: options.isPackaged
        ? 'com.findmikeymike.artistos.voicecore.moonshine'
        : 'com.voicecore.electron.development',
    })
  })
  return new ArtistManagerMoonshine(host)
}
