import * as React from 'react'
import { Check, ChevronLeft, Clock3, Loader2, Music2, Plus, Trash2, X } from 'lucide-react'
import type {
  TrackCharacterMetadata,
  TrackIntelligence,
  TrackLyricLine,
} from '@craft-agent/shared/artist-vault'
import { cn } from '@/lib/utils'

export interface TrackIntelligenceReviewValue {
  revisionId: string
  lyrics: {
    lines: TrackLyricLine[]
    language?: string
    timingSource: 'alignment' | 'transcription' | 'manual'
    timingStatus: 'ready' | 'needs-alignment'
    artistSuppliedText?: boolean
  }
  character?: TrackCharacterMetadata
}

interface TrackIntelligenceReviewDialogProps {
  open: boolean
  title: string
  intelligence?: TrackIntelligence
  busy?: boolean
  onClose: () => void
  onSave: (value: TrackIntelligenceReviewValue) => Promise<void>
}

const FIELD_CLASS = 'h-9 w-full rounded-[9px] border border-white/[0.07] bg-black/30 px-3 text-sm text-white/78 outline-none placeholder:text-white/25 focus:border-[#f97316]/40'

export function TrackIntelligenceReviewDialog({
  open,
  title,
  intelligence,
  busy = false,
  onClose,
  onSave,
}: TrackIntelligenceReviewDialogProps) {
  const revision = intelligence?.draft ?? intelligence?.approved
  const [step, setStep] = React.useState<'lyrics' | 'details'>('lyrics')
  const [lines, setLines] = React.useState<TrackLyricLine[]>([])
  const [genre, setGenre] = React.useState('')
  const [subgenre, setSubgenre] = React.useState('')
  const [moods, setMoods] = React.useState('')
  const [themes, setThemes] = React.useState('')
  const [tempo, setTempo] = React.useState('')
  const [energy, setEnergy] = React.useState(5)
  const [notes, setNotes] = React.useState('')
  const [pasteOpen, setPasteOpen] = React.useState(false)
  const [pastedLyrics, setPastedLyrics] = React.useState('')

  React.useEffect(() => {
    if (!open || !revision) return
    setStep('lyrics')
    setLines(revision.lyrics?.lines ?? [])
    setGenre((revision.character?.genre ?? []).join(', '))
    setSubgenre((revision.character?.subgenre ?? []).join(', '))
    setMoods((revision.character?.moods ?? []).join(', '))
    setThemes((revision.character?.themes ?? []).join(', '))
    setTempo(revision.character?.tempoBpm ? String(revision.character.tempoBpm) : '')
    setEnergy(revision.character?.energy ?? 5)
    setNotes(revision.character?.notes ?? '')
    setPasteOpen(false)
    setPastedLyrics('')
  }, [open, revision])

  if (!open || !revision) return null

  const timingSource = revision.lyrics?.timingSource ?? 'manual'
  const timingStatus = lines.every((line) => line.startMs !== undefined && line.endMs !== undefined)
    ? revision.lyrics?.timingStatus ?? 'ready'
    : 'needs-alignment'

  const save = async () => {
    await onSave({
      revisionId: revision.id,
      lyrics: {
        lines,
        language: revision.lyrics?.language,
        timingSource,
        timingStatus,
        artistSuppliedText: revision.lyrics?.artistSuppliedText || timingStatus === 'needs-alignment',
      },
      character: {
        genre: splitList(genre),
        subgenre: splitList(subgenre),
        moods: splitList(moods),
        themes: splitList(themes),
        tempoBpm: parsePositiveNumber(tempo),
        tempoSource: tempo.trim() ? 'manual' : undefined,
        energy,
        notes: notes.trim() || undefined,
      },
    })
  }

  const applyPastedLyrics = () => {
    const next = pastedLyrics.split(/\r?\n/).map((text) => text.trim()).filter(Boolean)
    if (!next.length) return
    setLines(next.map((text, index) => ({ id: `manual-line-${index + 1}`, text, corrected: true })))
    setPasteOpen(false)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-[16px] border border-white/[0.08] bg-[#0a0a0a] shadow-modal-small">
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-[11px] text-[#fb923c]/80"><Music2 className="h-3.5 w-3.5" /> Track Intelligence</div>
            <h2 className="truncate text-lg font-medium text-white/90">{title}</h2>
            <p className="mt-1 text-xs text-white/40">Review the machine draft. Saving makes these lyrics and tags available to agents.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-full p-2 text-white/40 hover:bg-white/[0.06] hover:text-white"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex items-center gap-1 border-b border-white/[0.05] px-5 py-2">
          <StepButton active={step === 'lyrics'} label="Lyrics" onClick={() => setStep('lyrics')} />
          <StepButton active={step === 'details'} label="Song details" onClick={() => setStep('details')} />
          <span className={cn('ml-auto text-[11px]', timingStatus === 'ready' ? 'text-emerald-300/65' : 'text-amber-300/70')}>
            {timingStatus === 'ready' ? 'Timing ready' : 'Timing needs alignment'}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {step === 'lyrics' ? (
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs text-white/38">Edit a line without losing its line timing. Replacing all lyrics clears timing until they are aligned again.</p>
                <button type="button" onClick={() => setPasteOpen((value) => !value)} className="shrink-0 text-xs text-white/55 hover:text-white">Paste lyrics</button>
              </div>
              {pasteOpen ? (
                <div className="mb-4 rounded-[10px] bg-white/[0.025] p-3">
                  <textarea value={pastedLyrics} onChange={(event) => setPastedLyrics(event.target.value)} rows={7} placeholder="Paste the correct lyrics, one line per row" className={cn(FIELD_CLASS, 'h-auto resize-none py-2')} />
                  <div className="mt-2 flex justify-end gap-2">
                    <button type="button" onClick={() => setPasteOpen(false)} className="h-8 px-3 text-xs text-white/50">Cancel</button>
                    <button type="button" onClick={applyPastedLyrics} className="h-8 rounded-[8px] bg-white/90 px-3 text-xs font-medium text-black">Use pasted lyrics</button>
                  </div>
                </div>
              ) : null}
              <div className="space-y-1.5">
                {lines.map((line, index) => (
                  <div key={line.id} className="grid grid-cols-[64px_minmax(0,1fr)_28px] items-center gap-2 rounded-[9px] bg-white/[0.025] p-2">
                    <button type="button" className="inline-flex items-center gap-1 font-mono text-[10px] text-white/38" title="Line start time">
                      <Clock3 className="h-3 w-3" />{formatTime(line.startMs)}
                    </button>
                    <input
                      value={line.text}
                      onChange={(event) => setLines((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? {
                        ...candidate,
                        text: event.target.value,
                        corrected: true,
                        words: undefined,
                      } : candidate))}
                      className="min-w-0 bg-transparent text-sm text-white/78 outline-none"
                    />
                    <button type="button" onClick={() => setLines((current) => current.filter((_, candidateIndex) => candidateIndex !== index))} className="rounded p-1 text-white/25 hover:bg-white/[0.05] hover:text-white/60" title="Remove line"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setLines((current) => [...current, { id: `manual-line-${Date.now()}`, text: '', corrected: true }])} className="mt-3 inline-flex h-8 items-center gap-1.5 text-xs text-white/48 hover:text-white/75"><Plus className="h-3.5 w-3.5" /> Add line</button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Genre"><input value={genre} onChange={(event) => setGenre(event.target.value)} placeholder="alt-pop, r&b" className={FIELD_CLASS} /></Field>
              <Field label="Subgenre"><input value={subgenre} onChange={(event) => setSubgenre(event.target.value)} placeholder="dream pop, trap soul" className={FIELD_CLASS} /></Field>
              <Field label="Mood"><input value={moods} onChange={(event) => setMoods(event.target.value)} placeholder="melancholy, cinematic" className={FIELD_CLASS} /></Field>
              <Field label="Themes"><input value={themes} onChange={(event) => setThemes(event.target.value)} placeholder="leaving home, second chances" className={FIELD_CLASS} /></Field>
              <Field label="Tempo"><input value={tempo} onChange={(event) => setTempo(event.target.value)} inputMode="numeric" placeholder="92 BPM" className={FIELD_CLASS} /></Field>
              <Field label={`Energy · ${energy}/10`}><input type="range" min={1} max={10} value={energy} onChange={(event) => setEnergy(Number(event.target.value))} className="h-9 w-full accent-[#f97316]" /></Field>
              <Field label="Notes" className="sm:col-span-2"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} placeholder="Sync fit, sonic references, important context" className={cn(FIELD_CLASS, 'h-auto resize-none py-2')} /></Field>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-4">
          {step === 'details' ? <button type="button" onClick={() => setStep('lyrics')} className="inline-flex h-9 items-center gap-1.5 text-sm text-white/55 hover:text-white"><ChevronLeft className="h-4 w-4" /> Lyrics</button> : <span />}
          {step === 'lyrics' ? (
            <button type="button" onClick={() => setStep('details')} className="h-9 rounded-[9px] bg-white/90 px-4 text-sm font-medium text-black hover:bg-white">Next</button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-[#f97316] px-4 text-sm font-medium text-white hover:bg-[#fb7c21] disabled:opacity-55">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save and approve
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

function StepButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cn('h-7 rounded-full px-3 text-xs', active ? 'bg-white/[0.09] text-white/85' : 'text-white/38 hover:text-white/65')}>{label}</button>
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return <label className={className}><span className="mb-1.5 block text-[11px] text-white/40">{label}</span>{children}</label>
}

function splitList(value: string): string[] | undefined {
  const items = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
  return items.length ? items : undefined
}

function parsePositiveNumber(value: string): number | undefined {
  const number = Number(value.trim())
  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined
}

function formatTime(milliseconds: number | undefined): string {
  if (milliseconds === undefined) return '--:--'
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
