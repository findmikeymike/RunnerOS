import { existsSync, readFileSync } from 'node:fs'
import type { StoredConfig } from './storage.ts'
import {
  DEFAULT_ARTIST_MANAGER_VOICE_SETTINGS,
  parseArtistManagerVoiceSettings,
  type ArtistManagerVoiceSettings,
} from './artist-manager-voice-settings.ts'

export type ArtistManagerVoiceStorageDependencies = {
  exists(): boolean
  load(): StoredConfig | null
  save(config: StoredConfig): void
}

/** Explicit injected storage keeps tests independent from process-global config paths. */
export function createArtistManagerVoiceSettingsStore(deps: ArtistManagerVoiceStorageDependencies) {
  function readConfig(): StoredConfig | null {
    const config = deps.load()
    if (!config && deps.exists()) throw new Error('Conversation voice settings could not read the app configuration; no changes were saved')
    if (config?.artistManagerVoice !== undefined) parseArtistManagerVoiceSettings(config.artistManagerVoice)
    return config
  }
  return {
    get(): ArtistManagerVoiceSettings {
      const config = readConfig()
      return config?.artistManagerVoice === undefined
        ? { ...DEFAULT_ARTIST_MANAGER_VOICE_SETTINGS }
        : parseArtistManagerVoiceSettings(config.artistManagerVoice)
    },
    update(value: unknown): ArtistManagerVoiceSettings {
      const settings = parseArtistManagerVoiceSettings(value)
      const config = readConfig()
      if (!config) throw new Error('Set up the app before saving conversation voice settings')
      deps.save({ ...config, artistManagerVoice: settings })
      return { ...settings }
    },
  }
}

async function productionStore() {
  const { getConfigPath, loadStoredConfig, saveConfig } = await import('./storage.ts')
  return createArtistManagerVoiceSettingsStore({
    exists: () => existsSync(getConfigPath()),
    load: () => {
      // Check malformed input before loadStoredConfig can run unrelated migrations.
      if (existsSync(getConfigPath())) {
        let raw: unknown
        try { raw = JSON.parse(readFileSync(getConfigPath(), 'utf8')) } catch { throw new Error('The app configuration is unreadable; conversation voice settings were not changed') }
        if (!raw || typeof raw !== 'object' || !Array.isArray((raw as StoredConfig).workspaces)) throw new Error('The app configuration is invalid; conversation voice settings were not changed')
        if ((raw as StoredConfig).artistManagerVoice !== undefined) parseArtistManagerVoiceSettings((raw as StoredConfig).artistManagerVoice)
      }
      return loadStoredConfig()
    },
    save: saveConfig,
  })
}

export async function getArtistManagerVoiceSettings(): Promise<ArtistManagerVoiceSettings> {
  return (await productionStore()).get()
}

/** Caller validates selected model availability in addition to this strict storage schema. */
export async function updateArtistManagerVoiceSettings(value: unknown): Promise<ArtistManagerVoiceSettings> {
  return (await productionStore()).update(value)
}
