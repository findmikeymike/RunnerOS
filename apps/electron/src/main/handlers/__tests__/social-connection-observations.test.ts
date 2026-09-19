import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SocialConnectionObservations } from '../social-connection-observations'

let directory: string
let file: string
let store: SocialConnectionObservations
const row = () => ({ platform: 'instagram', profile: 'main', accountHandle: 'artist', accountUrl: null, sessionPath: '/session', ready: true, loggedIn: true, localSessionExists: true, liveChecked: true, lastCheckedAt: new Date().toISOString(), evidence: { secret: 'private-page' }, live: { cookie: 'private-cookie' } })
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'social-observations-')); file = path.join(directory, 'checks.json'); store = new SocialConnectionObservations(file) })
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }))
describe('host social connection observations', () => {
  test('survives host restart as historical status without page evidence', () => {
    const status = row(); store.remember(status, store.begin(status))
    const saved = fs.readFileSync(file, 'utf8')
    expect(saved).not.toContain('private-page'); expect(saved).not.toContain('private-cookie')
    const restored = new SocialConnectionObservations(file).merge({ ...status, ready: false, liveChecked: false })
    expect(restored.ready).toBe(true); expect(restored.liveChecked).toBe(false); expect(restored.savedVerification).toBe(true)
  })
  test('identity edits and missing sessions cannot inherit a previous check', () => {
    const status = row(); store.remember(status, store.begin(status))
    expect(store.merge({ ...status, accountHandle: 'different', ready: false }).ready).toBe(false)
    expect(store.merge({ ...status, localSessionExists: false, ready: false }).ready).toBe(false)
  })
  test('invalidation prevents a pending old verification from saving', () => {
    const status = row(); const revision = store.begin(status); store.invalidate(status)
    store.remember(status, revision)
    expect(fs.existsSync(file)).toBe(false)
  })
  test('a Spotify surface check preserves independently verified surfaces', () => {
    const capability = (ready: boolean) => ({ ready, status: ready ? 'ready' : 'login_needed', label: 'Service', message: 'Status', rawText: 'private-page' })
    const status = { ...row(), platform: 'spotify', spotifyCapabilities: { artists: capability(true), webPlayer: capability(false), adsManager: capability(false) } }
    store.remember(status, store.begin(status), 'artists')
    const player = { ...status, spotifyCapabilities: { artists: capability(false), webPlayer: capability(true), adsManager: capability(false) } }
    const saved = store.remember(player, store.begin(player), 'web-player')
    expect(saved.spotifyCapabilities.artists.ready).toBe(true); expect(saved.spotifyCapabilities.webPlayer.ready).toBe(true)
    expect(saved.ready).toBe(true); expect(fs.readFileSync(file, 'utf8')).not.toContain('private-page')
  })
  test('wrong Spotify account remains an error after merging a different service', () => {
    const capability = (ready: boolean, status: string) => ({ ready, status, label: 'Service', message: status })
    const status = { ...row(), platform: 'spotify', spotifyCapabilities: { artists: capability(true, 'ready'), webPlayer: capability(true, 'ready'), adsManager: capability(false, 'wrong_account') } }
    store.remember(status, store.begin(status), 'ads-manager')
    const artists = { ...status, spotifyCapabilities: { ...status.spotifyCapabilities, adsManager: capability(false, 'login_needed') } }
    const saved = store.remember(artists, store.begin(artists), 'artists')
    expect(saved.profileStatus).toBe('wrong_account'); expect(saved.severity).toBe('error'); expect(saved.ready).toBe(false)
  })
  test('corrupt cache does not prevent listing or saving new observations', () => {
    fs.writeFileSync(file, '{broken')
    const status = row(); expect(store.merge(status)).toEqual(status)
    store.remember(status, store.begin(status)); expect(JSON.parse(fs.readFileSync(file, 'utf8'))['instagram/main'].ready).toBe(true)
  })
})


test('posting reuses verification only for the unchanged saved account and session', () => {
  const status = { ...row(), matchesExpected: true }
  const expected = { platform: status.platform, profile: status.profile, expectedHandle: status.accountHandle, expectedAccountUrl: null }
  store.remember(status, store.begin(status))
  const current = { ...status, liveChecked: false, ready: false, loggedIn: null, matchesExpected: null }
  expect(() => new SocialConnectionObservations(file).assertVerifiedConnection(current, expected)).not.toThrow()
  for (const change of [{ accountHandle: 'other' }, { sessionPath: '/new' }, { localSessionExists: false }]) {
    expect(() => store.assertVerifiedConnection({ ...current, ...change }, expected)).toThrow(/Settings/)
  }
  expect(() => store.assertVerifiedConnection(current, { ...expected, expectedHandle: 'other' })).toThrow(/Settings/)
  store.remember({ ...status, ready: false, loggedIn: false, matchesExpected: false }, store.begin(status))
  expect(() => store.assertVerifiedConnection(current, expected)).toThrow(/Settings/)
  store.invalidate(status)
  expect(() => store.assertVerifiedConnection(current, expected)).toThrow(/Settings/)
})
