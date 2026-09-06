const { execFileSync } = require('node:child_process')
const { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const appRoot = resolve(__dirname, '..')
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('Artist OS Moonshine release preparation currently supports macOS arm64 only')
}

const required = name => {
  const value = process.env[name]
  if (!value) throw new Error(`Set ${name} before packaging Artist OS for macOS`)
  return resolve(value)
}

const temporary = mkdtempSync(join(tmpdir(), 'artist-os-voice-core-release-'))
const stagedRoot = join(temporary, 'resources', 'voice-core')
const helper = join(stagedRoot, 'bin', 'VoiceCoreMoonshineHost.app')
mkdirSync(join(stagedRoot, 'bin'), { recursive: true })
const signIdentity = process.env.VOICECORE_MOONSHINE_SIGN_IDENTITY || process.env.CSC_NAME
if (!signIdentity) throw new Error('Set VOICECORE_MOONSHINE_SIGN_IDENTITY or CSC_NAME before packaging Artist OS')

execFileSync(process.execPath, [
  join(appRoot, '..', '..', 'vendor', 'voice-core-electron', 'tools', 'package-macos-moonshine-helper.mjs'),
  '--host', required('VOICECORE_MOONSHINE_HOST'),
  '--native-library', required('VOICECORE_MOONSHINE_NATIVE_LIBRARY'),
  '--ort-library', required('VOICECORE_MOONSHINE_ORT_LIBRARY'),
  '--profile', required('VOICECORE_MOONSHINE_PROVISIONING_PROFILE'),
  '--bundle-id', 'com.findmikeymike.artistos.voicecore.moonshine',
  '--identity', signIdentity,
  '--output', helper,
], { stdio: 'inherit' })

const catalog = join(appRoot, '..', '..', 'vendor', 'voice-core-electron', 'resources', 'voice-core', 'moonshine-release-catalog-v1.json')
if (!existsSync(catalog)) throw new Error('Vendored Moonshine release catalog is missing')
cpSync(catalog, join(stagedRoot, 'moonshine-release-catalog-v1.json'))

const destination = join(appRoot, '.voice-core-release')
rmSync(destination, { recursive: true, force: true })
renameSync(temporary, destination)
console.log(`Prepared signed Artist OS Voice Core resources at ${destination}`)
