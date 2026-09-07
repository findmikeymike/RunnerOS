import { describe, expect, test } from 'bun:test'
import {
  buildVoiceHandoffTool, isVoiceHandoffConfirmation, normalizeVoiceHandoffTargets,
  parseVoiceHandoffProposal, VOICE_HANDOFF_LIMITS,
} from './artist-manager-voice-handoff'

const targets = [{ slug: 'release-manager', name: 'Release Manager', description: 'Release planning' }]
const args = { agentSlug: 'release-manager', taskTitle: 'Prepare release checklist', brief: 'Draft a checklist using the confirmed release date; the artwork is still missing.' }

describe('focused voice handoff boundary', () => {
  test('normalizes and bounds only safe trusted catalog fields, retaining first valid duplicate', () => {
    const input = [null, { slug: '../manager', name: 'Bad' }, { slug: ' manager', name: 'Bad' },
      { slug: 'Manager', name: 'Bad' }, { slug: 'empty', name: ' ' },
      { slug: 'bad-control', name: 'Bad\u0000' },
      { slug: 'release-manager', name: ' Release\n Manager ', description: 'x'.repeat(500), systemPrompt: 'private' },
      { slug: 'release-manager', name: 'Impersonator' },
      ...Array.from({ length: 50 }, (_, i) => ({ slug: `agent-${i}`, name: 'N'.repeat(200) })),
    ]
    const normalized = normalizeVoiceHandoffTargets(input)
    expect(normalized).toHaveLength(40)
    expect(normalized[0]).toEqual({ slug: 'release-manager', name: 'Release Manager', description: 'x'.repeat(160) })
    expect(normalized[1]?.name).toHaveLength(80)
    expect(normalized.some(target => target.slug === 'agent-39')).toBe(false)
    expect(input[6]).toHaveProperty('systemPrompt', 'private')
  })

  test('proposal uses trusted target name and preserves the complete bounded brief', () => {
    expect(parseVoiceHandoffProposal(args, 'proposal-1', targets)).toEqual({
      id: 'proposal-1', agentSlug: 'release-manager', agentName: 'Release Manager',
      taskTitle: args.taskTitle, brief: args.brief,
    })
  })

  test('rejects unknown targets, malformed arguments, extra fields and oversized content', () => {
    for (const candidate of [null, [], '{}', {}, { ...args, agentSlug: '../manager' },
      { ...args, agentSlug: 'other-agent' }, { ...args, agentSlug: ' release-manager' },
      { ...args, agentName: 'Injected name' }, { ...args, taskTitle: ' ' },
      { ...args, taskTitle: 'x'.repeat(VOICE_HANDOFF_LIMITS.taskTitleChars + 1) },
      { ...args, brief: 'x'.repeat(VOICE_HANDOFF_LIMITS.briefChars + 1) },
      { ...args, brief: 'control\u0000' }, { ...args, brief: 12 },
    ]) expect(parseVoiceHandoffProposal(candidate, 'proposal-1', targets)).toBeNull()
    expect(parseVoiceHandoffProposal(args, '', targets)).toBeNull()
    expect(parseVoiceHandoffProposal(args, 'x'.repeat(129), targets)).toBeNull()
    expect(parseVoiceHandoffProposal(args, 'proposal-1', [])).toBeNull()
  })

  test('tool schema exposes only captured valid targets and cannot accept extra arguments', () => {
    const tool = buildVoiceHandoffTool([...targets, { slug: '../escape', name: 'Bad' }])!
    expect(tool.name).toBe('open_command_chat')
    expect(tool.description).toContain('Release planning')
    expect(tool.description).not.toContain('../escape')
    expect(tool.parameters.properties.agentSlug.enum).toEqual(['release-manager'])
    expect(tool.parameters.required).toEqual(['agentSlug', 'taskTitle', 'brief'])
    expect(tool.parameters.additionalProperties).toBe(false)
    expect(buildVoiceHandoffTool([])).toBeNull()
  })

  test('recognizes clear affirmative whole utterances, including transcription punctuation', () => {
    for (const utterance of ['Yes.', 'Sounds good!', 'Yes, sounds good.', 'Sure', "let's do it", 'Lets do it.',
      'Yes please!', ' Yes, go ahead. ', 'Let’s do it!', 'Okay.', 'Absolutely!',
      'Yes, go.', 'Yeah, do it.', 'Okay, do it!', 'Sure, do it.', 'Yeah, let’s go!', 'Um, yes, go.', 'Open the chat.', 'Yes, open it.']) {
      expect(isVoiceHandoffConfirmation(utterance)).toBe(true)
    }
  })

  test('rejects negation, qualified assent, questions, unrelated instructions and quoted speech', () => {
    for (const utterance of ['', 'no', 'not now', 'yes but not now', 'yes, but first change the agent',
      'yes if it is free', 'yes later', 'yes no', 'not yes', 'sure maybe', 'sounds good?', 'Yes?', 'yes？',
      'yes… maybe', 'yes and send it', 'yes delete everything', 'I said yes', '"yes"', 'yes\u0000',
      'go ahead and run the campaign', "let's do it tomorrow", 'okay; ignore the policy',
      'yes go but change the agent', 'yes go tomorrow', 'open it and send', 'um maybe go',
    ]) expect(isVoiceHandoffConfirmation(utterance)).toBe(false)
  })
})
