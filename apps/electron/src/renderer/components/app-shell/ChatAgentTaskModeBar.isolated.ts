import * as React from 'react'
import { describe, expect, test, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentTaskModeDefinition } from '@craft-agent/shared/agent-definitions/types'
import * as tooltips from '../../../../../../packages/ui/src/components/tooltip'
// Preserve the real tooltip components while excluding the UI barrel's Vite-only PDF import.
mock.module('@craft-agent/ui', () => tooltips)
const { ChatAgentTaskModeBar } = await import('./ChatAgentTaskModeBar')

type ElementProps = { children?: React.ReactNode; [key: string]: unknown }

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  return React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement<ElementProps>(child)) return []
    return [child, ...elements(child.props.children)]
  })
}

const modes: AgentTaskModeDefinition[] = [
  { id: 'story', label: 'Story World', description: 'Focus on the story.', kind: 'focus', primarySkillSlugs: ['story'] },
  { id: 'full', label: 'Full World', description: 'Explore the whole world.', kind: 'bundle', primarySkillSlugs: ['story'], fullMode: true },
]

function controls(props: Partial<Parameters<typeof ChatAgentTaskModeBar>[0]> = {}) {
  const tree = ChatAgentTaskModeBar({ modes, onSelect: () => undefined, ...props })
  return elements(tree).filter((element) => element.type === 'button')
}

function option(id: string, props: Partial<Parameters<typeof ChatAgentTaskModeBar>[0]> = {}) {
  return controls(props).find((button) => elements(button.props.children).some((child) => child.type === 'span' && child.props.children === id))!
}

describe('Agent focus controls', () => {
  test('General is visibly and accessibly selected before any focus is chosen', () => {
    expect(option('General').props['aria-pressed']).toBe(true)
    expect(option('Story World').props['aria-pressed']).toBe(false)
    const html = renderToStaticMarkup(React.createElement(ChatAgentTaskModeBar, { modes, onSelect: () => undefined }))
    expect(html).toContain('General selected. Send a message or choose a focus.')
    expect(html).toContain('aria-label="How skill focus works"')
    expect(html).toContain('aria-haspopup="dialog"')
  })

  test('clicking a focus reports only the selection, including return to General', () => {
    const selected: string[] = []
    const onSelect = (id: string) => selected.push(id)
    ;(option('Story World', { onSelect }).props.onClick as () => void)()
    ;(option('General', { onSelect, selectedModeId: 'story' }).props.onClick as () => void)()
    expect(selected).toEqual(['story', 'general'])
  })

  test('explicit selection replaces General and unknown legacy selection is not misrepresented', () => {
    expect(option('General', { selectedModeId: 'story' }).props['aria-pressed']).toBe(false)
    expect(option('Story World', { selectedModeId: 'story' }).props['aria-pressed']).toBe(true)
    expect(controls({ selectedModeId: 'retired-mode' }).some((button) => button.props['aria-pressed'])).toBe(false)
  })

  test('a custom General definition is preserved without a duplicate', () => {
    const custom = { ...modes[0]!, id: 'general', label: 'General', description: 'Custom general context.' }
    const html = renderToStaticMarkup(React.createElement(ChatAgentTaskModeBar, { modes: [custom, ...modes], onSelect: () => undefined }))
    expect(controls({ modes: [custom, ...modes] })).toHaveLength(4)
    expect(html.match(/>General<\/span>/g)).toHaveLength(1)
  })

  test('Manager shows one General first and retains the selection for old chats', () => {
    const legacy: AgentTaskModeDefinition = { id: 'just-talk', label: 'Just Talk', description: 'Conversation', kind: 'focus', primarySkillSlugs: ['artist-manager-operating-system'] }
    for (const managerModes of [[...modes, legacy], [...modes, { ...legacy, id: 'general', label: 'General' }], [...modes, legacy, { ...legacy, id: 'general', label: 'General' }]]) {
      const props = { modes: managerModes, selectedModeId: 'just-talk' }
      expect(option('General', props).props['aria-pressed']).toBe(true)
      expect(elements(controls(props)[0]!.props.children).some(child => child.type === 'span' && child.props.children === 'General')).toBe(true)
      const html = renderToStaticMarkup(React.createElement(ChatAgentTaskModeBar, { ...props, onSelect: () => undefined }))
      expect(html.match(/>General<\/span>/g)).toHaveLength(1)
      expect(html).not.toContain('Just Talk')
    }
  })

  test('busy controls are disabled and refuse selection while help remains available', () => {
    let calls = 0
    for (const busy of [{ applyingModeId: 'story' }, { openingConversation: true }]) {
      const props = { ...busy, onSelect: () => { calls++ } }
      const button = option('General', props)
      expect(button.props.disabled).toBe(true)
      ;(button.props.onClick as () => void)()
      const help = controls(props).find((entry) => entry.props['aria-label'] === 'How skill focus works')!
      expect(help.props.disabled).toBeUndefined()
      expect(renderToStaticMarkup(React.createElement(ChatAgentTaskModeBar, { modes, ...props }))).toContain('Updating focus…')
    }
    expect(calls).toBe(0)
  })
})
