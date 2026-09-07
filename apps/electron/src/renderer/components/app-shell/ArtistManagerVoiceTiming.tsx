import { useState } from 'react'
import type { ArtistManagerVoiceState } from '@/hooks/useArtistManagerVoice'

export function ArtistManagerVoiceTiming({ voice }: { voice: ArtistManagerVoiceState }) {
  const [text, setText] = useState('Hello, how are you?')
  const [copied, setCopied] = useState(false)
  const busy = voice.running || voice.starting || voice.stopping
  return (
    <details className="relative mt-3 text-xs text-white/65">
      <summary className="cursor-pointer py-2">Response timing</summary>
      <div className="space-y-3 py-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={voice.timingEnabled} disabled={busy} onChange={event => voice.setTimingEnabled(event.target.checked)} />
          Measure this conversation
        </label>
        {voice.timingEnabled ? <>
          <p>Records timing and counts in the app log. Does not record spoken text, audio, or keys. Choose the input before starting.</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={voice.focusedTrial} disabled={busy} onChange={event => voice.setFocusedTrial(event.target.checked)} />
            Test focused conversation (no tools)
          </label>
          {voice.focusedTrial ? <p>Uses the artist brief to discuss priorities and decisions. Actions require Manager chat. This test conversation is not saved to chat.</p> : null}
          <label className="block space-y-1">
            <span>Test model (blank uses Manager setting)</span>
            <input aria-label="Voice test model" value={voice.modelTrial.model} disabled={busy} maxLength={200} onChange={event => voice.setModelTrial({ ...voice.modelTrial, model: event.target.value })} className="block w-full rounded-lg border border-white/10 bg-[#171717] p-2" />
          </label>
          <label className="block space-y-1">
            <span>Test reasoning</span>
            <select aria-label="Voice test reasoning" value={voice.modelTrial.thinking} disabled={busy} onChange={event => voice.setModelTrial({ ...voice.modelTrial, thinking: event.target.value as '' | 'off' | 'low' })} className="block w-full rounded-lg border border-white/10 bg-[#171717] p-2">
              <option value="">{voice.focusedTrial ? 'Low (focused test)' : 'Manager setting'}</option>
              <option value="low">Low</option>
              <option value="off">Off</option>
            </select>
          </label>
          <p>Applies only to this test conversation, using the Manager's connection. Saved settings stay unchanged.</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={voice.typedTrial} disabled={busy} onChange={event => voice.setTypedTrial(event.target.checked)} />
            Type instead of speaking for this test
          </label>
          {voice.typedTrial ? <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void voice.sendTyped(text) }}>
            <input aria-label="Timing test message" maxLength={2000} value={text} onChange={event => setText(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#171717] p-2" />
            <button type="submit" disabled={!voice.canSendTyped || !text.trim()} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40">Send test</button>
          </form> : null}
        </> : null}
        {voice.timingRecords.length ? <>
          <p>{voice.timingRecords.length} recent timing markers collected. Playback includes brief progress announcements; answer audio is labelled separately.</p>
          <button type="button" className="underline underline-offset-4" onClick={async () => {
            try {
              await navigator.clipboard.writeText(JSON.stringify({ schemaVersion: 1, records: voice.timingRecords }, null, 2))
              setCopied(true)
            } catch { setCopied(false) }
          }}>{copied ? 'Timing report copied' : 'Copy timing report'}</button>
        </> : null}
      </div>
    </details>
  )
}
