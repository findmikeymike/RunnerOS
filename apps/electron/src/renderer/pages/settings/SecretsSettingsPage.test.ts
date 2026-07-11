import { describe, expect, mock, test } from 'bun:test'
import { getBuiltinSources } from '@craft-agent/shared/sources'
import { STARTER_AGENTS } from '@craft-agent/shared/agent-definitions'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.js' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

const { SECRET_PRESETS, SERVICES } = await import('./SecretsSettingsPage')

describe('Keys settings registry', () => {
  test('services reference valid unique presets', () => {
    const presetNames = SECRET_PRESETS.map((preset) => preset.name)
    const serviceIds = SERVICES.map((service) => service.id)

    expect(new Set(presetNames).size).toBe(presetNames.length)
    expect(new Set(serviceIds).size).toBe(serviceIds.length)

    const knownPresets = new Set(presetNames)
    for (const service of SERVICES) {
      for (const name of [
        ...service.presetNames,
        ...(service.optionalPresetNames ?? []),
        ...(service.requiredAnyPresetNames ?? []),
      ]) {
        expect(knownPresets.has(name), `${service.id} references missing preset ${name}`).toBe(true)
      }
    }
  })

  test('managed source cards point to real built-in sources', () => {
    const sourceSlugs = new Set(getBuiltinSources('settings-test', '/tmp/settings-test').map((source) => source.config.slug))
    const managed = SECRET_PRESETS.filter((preset) => preset.storage === 'managed-source')

    for (const preset of managed) {
      expect(preset.sourceSlug, `${preset.name} is missing sourceSlug`).toBeTruthy()
      expect(sourceSlugs.has(preset.sourceSlug!), `${preset.name} points to missing source ${preset.sourceSlug}`).toBe(true)
    }
  })

  test('provider publishing agents have visible managed connection cards', () => {
    const managedSlugs = new Set(
      SECRET_PRESETS
        .filter((preset) => preset.storage === 'managed-source')
        .map((preset) => preset.sourceSlug),
    )

    for (const agentSlug of ['trypost-agent', 'postiz-agent']) {
      const agent = STARTER_AGENTS.find((candidate) => candidate.slug === agentSlug)
      expect(agent, `missing built-in agent ${agentSlug}`).toBeDefined()
      for (const sourceSlug of agent?.metadata.sources ?? []) {
        expect(managedSlugs.has(sourceSlug), `${agentSlug} has no Keys setup path for ${sourceSlug}`).toBe(true)
      }
    }
  })
})
