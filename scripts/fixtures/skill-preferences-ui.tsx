import React from 'react'
import { createRoot } from 'react-dom/client'
import { SkillPersonalInstructions } from '../../apps/electron/src/renderer/components/skills/SkillPersonalInstructions'
import { ImportPersonalInstructions } from '../../apps/electron/src/renderer/components/skills/ImportPersonalInstructions'
const w = window as any
const root = createRoot(document.getElementById('root')!)
w.records = [{ id: 'shared', parentManagedId: 'artist-os:skill:zero', scope: 'shared', text: 'Shared preference', enabled: true }]
w.calls = []
w.electronAPI = {
  getSkillPersonalInstructions: async () => { if (w.failLoad) throw new Error('Offline'); return structuredClone(w.records) },
  saveSkillPersonalInstructions: async (_workspace: string, _slug: string, input: any) => {
    w.calls.push(input)
    if (w.holdSave) await new Promise(resolve => { w.releaseSave = resolve })
    w.records = w.records.filter((record: any) => record.scope !== input.scope)
    if (input.text.trim()) w.records.push({ ...input, id: input.scope })
  },
  deleteSkillPersonalInstructions: async (_workspace: string, _slug: string, scope: string) => { w.records = w.records.filter((record: any) => record.scope !== scope) },
  importSkillPersonalInstructions: async (_workspace: string, input: any, scope: string) => {
    w.calls.push({ ...input, scope })
    if (w.failImport) throw new Error('Import failed. Try again.')
    return { ...input, scope, enabled: false }
  },
}
w.renderPreferences = (available = true) => root.render(<SkillPersonalInstructions workspaceId="test" skillSlug="zero" available={available} />)
w.renderImport = () => root.render(<ImportPersonalInstructions workspaceId="test" />)
