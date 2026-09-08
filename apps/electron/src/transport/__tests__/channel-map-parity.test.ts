import { describe, it, expect } from 'bun:test'
import type { ElectronAPI } from '../../shared/types'
import { CHANNEL_MAP } from '../channel-map'
import { LOCAL_ONLY_CHANNELS, REMOTE_ELIGIBLE_CHANNELS, RPC_CHANNELS } from '@craft-agent/shared/protocol'

type AnyFn = (...args: any[]) => any

type FunctionKeys<T> = {
  [K in keyof T]-?: Extract<T[K], AnyFn> extends never ? never : K
}[keyof T] & string

type BrowserPaneKeys = `browserPane.${FunctionKeys<ElectronAPI['browserPane']>}`

// Methods excluded from CHANNEL_MAP because they are implemented directly in the preload
// (no IPC round-trip to the main process). Each reads local state or orchestrates client-side.
type ApiToChannelMapKeys = Exclude<
  FunctionKeys<ElectronAPI>,
  | 'performOAuth'
  | 'getTransportConnectionState'
  | 'getRuntimeEnvironment'
  | 'onTransportConnectionStateChanged'
  | 'reconnectTransport'
  | 'isChannelAvailable'
  | 'getSystemWarnings' // reads env var set at startup — no IPC needed
  | 'relaunchApp' // direct IPC to main process — not through WS RPC
  | 'onCampaignDeleted' // direct local IPC event
  | 'previewCampaignCleanup' // direct local IPC — campaign file preservation/deletion
  | 'deleteCampaign' // direct local IPC — campaign file preservation/deletion
  | 'removeWorkspace' // direct IPC to main process — modifies local config
  | 'invokeOnServer' // direct IPC to main process — cross-server RPC
  | 'transferSessionToWorkspace' // direct IPC to main process — orchestrated remote transfer
  | 'onTransferProgress' // direct IPC listener — chunk upload progress
  | 'changeLanguage' // direct IPC to main process — syncs i18n language
  | 'captureVisualElement' // direct IPC to main process — captures the renderer window
  | 'getArtistManagerVoiceProxyInfo' // direct IPC — local authenticated voice proxy
  | 'getArtistManagerVoiceProviderStatus' // direct IPC — returns booleans, never secrets
  | 'createArtistManagerVoiceAssemblyToken' // direct IPC — mints a short-lived STT token
  | 'invokeArtistManagerMoonshine' // direct IPC — native audio stays in the local Electron host
  | 'getChatDictationAvailability' // direct IPC — checks the local packaged transcription runtime
  | 'requestChatDictationAccess' // direct IPC — local operating-system microphone permission
  | 'transcribeChatDictation' // direct IPC — local audio never crosses the workspace transport
  | 'lookupProsodyRhymes' // direct IPC to main process — local ambient rhyme engine
  | 'getLicenseState' // direct IPC to protected main-process licensing authority
  | 'activateLicense'
  | 'refreshLicense'
  | 'deactivateLicense'
  | 'onLicenseStateChanged'
  | 'onLicenseRequired'
  | 'openLicenseLink'
  | 'getFilePath' // renderer-local — webUtils.getPathForFile, no IPC round-trip
> | BrowserPaneKeys
type ChannelMapKeys = keyof typeof CHANNEL_MAP & string

type AssertNever<T extends never> = true

// Compile-time guardrails: if these fail, CHANNEL_MAP and ElectronAPI drifted.
const _missingFromMap: AssertNever<Exclude<ApiToChannelMapKeys, ChannelMapKeys>> = true
const _extraInMap: AssertNever<Exclude<ChannelMapKeys, ApiToChannelMapKeys>> = true

void _missingFromMap
void _extraInMap

describe('CHANNEL_MAP runtime contract', () => {
  it('routes saved Signals audio locally with a three-argument API', () => {
    const channel = RPC_CHANNELS.outputs.READ_SIGNAL_BRIEFING_AUDIO
    expect(CHANNEL_MAP.readSignalBriefingAudio).toMatchObject({ type: 'invoke', channel })
    expect(LOCAL_ONLY_CHANNELS.has(channel)).toBe(true)
    expect(REMOTE_ELIGIBLE_CHANNELS.has(channel)).toBe(false)
    const _args: Parameters<ElectronAPI['readSignalBriefingAudio']> = ['workspace', 'output', 'visible briefing']
    expect(_args).toHaveLength(3)
  })
  it('has valid entry kinds and channels', () => {
    for (const [method, entry] of Object.entries(CHANNEL_MAP)) {
      expect(typeof method).toBe('string')
      expect(entry.type === 'invoke' || entry.type === 'listener').toBe(true)
      expect(typeof entry.channel).toBe('string')
      expect(entry.channel.length).toBeGreaterThan(0)

      if (entry.type === 'listener') {
        expect((entry as any).transform).toBeUndefined()
      }
    }
  })

  it('contains at least one listener and one invoke entry', () => {
    const values = Object.values(CHANNEL_MAP)
    expect(values.some((entry) => entry.type === 'listener')).toBe(true)
    expect(values.some((entry) => entry.type === 'invoke')).toBe(true)
  })
})
