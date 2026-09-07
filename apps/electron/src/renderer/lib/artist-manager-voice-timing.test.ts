import { describe, expect, test } from 'bun:test'
import type { WebSttTransport } from '@voice-core/web/cloud'
import { observeVoiceStt, observeVoiceTts, VoiceTimingTrace, type VoiceTimingRecord } from './artist-manager-voice-timing'

describe('Voice timing evidence', () => {
  test('a late raw final cannot advance an active answer to a phantom turn', () => {
    const records: VoiceTimingRecord[] = []
    const trace = new VoiceTimingTrace('run', r => records.push(r))
    trace.queueInput('accepted question')
    trace.event({ type: 'debug', message: '[latency] stt-final +2ms' })
    trace.queueInput('late final dropped by SDK')
    trace.mark('manager-complete')
    trace.mark('playback-start')
    expect(records.filter(r => r.stage !== 'start').map(r => r.turn)).toEqual([1, 1, 1])
    trace.queueInput('next question')
    trace.event({ type: 'debug', message: '[latency] stt-final +1ms' })
    expect(records.at(-1)).toMatchObject({ turn: 2, chars: 13 })
  })

  test('uses one monotonic clock; associates input markers with the next turn; closes stale runs', () => {
    let time = 100
    const records: VoiceTimingRecord[] = []
    const trace = new VoiceTimingTrace('run', r => records.push(r), () => time)
    time = 200; trace.mark('stt-ready')
    time = 500; trace.mark('first-partial', {}, true, true)
    trace.mark('first-partial', {}, true, true)
    time = 700; trace.input('hello there')
    time = 900; trace.mark('manager-request')
    trace.mark('first-partial', {}, true, true)
    trace.input('second turn')
    trace.stop(); trace.mark('manager-complete'); trace.input('late')
    expect(records.map(r => [r.stage, r.turn, r.elapsedMs])).toEqual([
      ['start', 0, 0], ['stt-ready', 0, 100], ['first-partial', 1, 400], ['stt-final', 1, 600],
      ['manager-request', 1, 800], ['first-partial', 2, 800], ['stt-final', 2, 800], ['stop', 2, 800],
    ])
    expect(records.find(r => r.stage === 'stt-final')).toMatchObject({ chars: 11, words: 2 })
  })

  test('does not emit arbitrary text, error bodies, or transcript contents', () => {
    const records: VoiceTimingRecord[] = []
    const trace = new VoiceTimingTrace('run', r => records.push(r))
    trace.input('private transcript canary')
    trace.mark('error', { chars: NaN, sampleRate: Infinity, text: 'secret-canary' } as never)
    trace.event({ type: 'debug', message: 'secret-canary' })
    trace.event({ type: 'debug', message: '[latency] audio-playback-start +120ms secret-canary' })
    trace.event({ type: 'assistantText', text: 'secret-canary' })
    expect(JSON.stringify(records)).not.toContain('canary')
    expect(records.at(-1)).not.toHaveProperty('chars')
    expect(records.some(r => r.stage === 'playback-start')).toBe(false)
  })

  test('only worklet onset is playback proof; queued activity is not answer audio', async () => {
    const records: VoiceTimingRecord[] = []
    const trace = new VoiceTimingTrace('run', r => records.push(r))
    trace.input('question')
    trace.event({ type: 'assistantActivity', text: 'Checking that now.' })
    trace.mark('answer-delivered') // Agent can finish while activity synthesis is queued.
    const tts = observeVoiceTts({ async synthesize() {
      return (async function* () { yield { frames: new Float32Array(2), sampleRate: 24000, channels: 1 } })()
    } }, trace)
    for (const text of ['Checking that now.', 'Here is the answer.']) {
      for await (const _ of await tts.synthesize({ text, signal: new AbortController().signal })) { /* consume */ }
    }
    trace.event({ type: 'assistantAudioStart' })
    expect(records.some(r => r.stage === 'playback-start')).toBe(false)
    trace.event({ type: 'debug', message: '[latency] audio-playback-start +120ms' })
    expect(records.filter(r => r.stage === 'tts-first-audio').map(r => r.kind)).toEqual(['activity', 'answer'])
    expect(records.filter(r => r.stage === 'playback-start')).toHaveLength(1)
  })

  test('typed trial cannot dispatch ambient transcripts, and preserves transport teardown', async () => {
    let handler!: Parameters<WebSttTransport['onTranscript']>[0]
    let fed = 0, started = 0, stopped = 0, cancelled = 0, received = 0
    const stt: WebSttTransport = {
      keepAliveDuringAssistant: true,
      async start() { started++ }, async stop() { stopped++ }, cancelStart() { cancelled++ },
      async sendAudio() { fed++ }, onTranscript(next) { handler = next; return () => {} },
    }
    const records: VoiceTimingRecord[] = []
    const wrapped = observeVoiceStt(stt, new VoiceTimingTrace('run', r => records.push(r)), true)
    wrapped.onTranscript(() => received++)
    await wrapped.start(); await wrapped.sendAudio(new Int16Array(2), 48000, 1)
    handler({ type: 'final', text: 'ambient noise' })
    wrapped.cancelStart?.(); await wrapped.stop()
    expect([fed, received, started, stopped, cancelled]).toEqual([0, 0, 1, 1, 1])
    expect(wrapped.keepAliveDuringAssistant).toBe(true)
    expect(records.some(r => r.stage === 'stt-final')).toBe(false)
  })

  test('normal microphone trial forwards exact audio and errors even if diagnostics throw', async () => {
    const failure = new Error('provider failure')
    const pcm = new Int16Array([1, 2])
    const trace = new VoiceTimingTrace('run', () => { throw new Error('broken logger') })
    const wrapped = observeVoiceStt({
      async start() {}, async stop() {}, onTranscript() { return () => {} },
      async sendAudio(actual, rate, channels) { expect(actual).toBe(pcm); expect([rate, channels]).toEqual([48000, 1]); throw failure },
    }, trace, false)
    await expect(wrapped.sendAudio(pcm, 48000, 1)).rejects.toBe(failure)
  })
})
