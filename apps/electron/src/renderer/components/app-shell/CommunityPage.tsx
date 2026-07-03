import * as React from 'react'
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
  Mail,
  Plus,
  Send,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import {
  ARTIST_COMMUNITY_CONTEXT_SLUG,
  artistCommunityMetadata,
  createCommunityContact,
  createCommunityEmailJob,
  parseArtistCommunityDocResult,
  segmentLabel,
  serializeArtistCommunityBody,
  type ArtistCommunity,
  type CommunityContact,
  type CommunitySegment,
} from '@/lib/artist-community'

type SegmentFilter = CommunitySegment | 'all'
type FanDraft = {
  name: string
  email: string
  segment: CommunitySegment
  source: string
  city: string
  notes: string
  tags: string
}
type CommunityEmailDraft = {
  from: string
  replyTo: string
  subject: string
  body: string
}

interface CommunityPageProps {
  workspaceId: string
}

const segmentFilters: Array<{ id: SegmentFilter; label: string }> = [
  { id: 'all', label: 'All Fans' },
  { id: 'vip', label: 'VIPs' },
  { id: 'local', label: 'Local' },
  { id: 'buyers', label: 'Buyers' },
  { id: 'street-team', label: 'Street Team' },
  { id: 'general', label: 'General' },
]

const emptyDraft: FanDraft = {
  name: '',
  email: '',
  segment: 'general',
  source: '',
  city: '',
  notes: '',
  tags: '',
}
const emptyEmailDraft: CommunityEmailDraft = {
  from: '',
  replyTo: '',
  subject: '',
  body: '',
}

export function CommunityPage({ workspaceId }: CommunityPageProps) {
  const [activeSegment, setActiveSegment] = React.useState<SegmentFilter>('all')
  const [draft, setDraft] = React.useState<FanDraft>(emptyDraft)
  const [emailDraft, setEmailDraft] = React.useState<CommunityEmailDraft>(emptyEmailDraft)
  const [saving, setSaving] = React.useState(false)
  const [sendingEmail, setSendingEmail] = React.useState(false)
  const { docs, loading, upsert } = useWorkspaceContext(workspaceId)

  const communityResult = React.useMemo(
    () => parseArtistCommunityDocResult(docs.find((doc) => doc.slug === ARTIST_COMMUNITY_CONTEXT_SLUG)),
    [docs],
  )
  const community = communityResult.community
  const visibleFans = React.useMemo(
    () => activeSegment === 'all'
      ? community.contacts
      : community.contacts.filter((fan) => fan.segment === activeSegment),
    [activeSegment, community.contacts],
  )
  const emailRecipients = React.useMemo(
    () => Array.from(new Set(visibleFans.map((fan) => fan.email.trim()).filter(isValidEmail))),
    [visibleFans],
  )
  const audienceLabel = activeSegment === 'all' ? 'all fans' : `${segmentLabel(activeSegment)} fans`

  const saveCommunity = React.useCallback(async (nextCommunity: ArtistCommunity) => {
    if (!communityResult.ok) {
      throw new Error(`${communityResult.error} Open Workspace Context to recover it before saving.`)
    }
    await upsert({
      slug: ARTIST_COMMUNITY_CONTEXT_SLUG,
      metadata: artistCommunityMetadata(),
      body: serializeArtistCommunityBody(nextCommunity),
    })
  }, [communityResult, upsert])

  const addFan = React.useCallback(async () => {
    if (!draft.name.trim() || !draft.email.trim()) {
      toast.error('Add a name and email first.')
      return
    }
    setSaving(true)
    try {
      const contact = createCommunityContact(draft)
      await saveCommunity({
        version: 1,
        contacts: [...community.contacts, contact],
        emailJobs: community.emailJobs,
        updatedAt: new Date().toISOString(),
      })
      setDraft(emptyDraft)
      toast.success('Fan saved to Community')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }, [community.contacts, community.emailJobs, draft, saveCommunity])

  const queueEmailJob = React.useCallback(async (audience: string) => {
    const job = createCommunityEmailJob({
      title: `${audience} email`,
      audience,
      status: 'draft',
    })
    try {
      await saveCommunity({
        version: 1,
        contacts: community.contacts,
        emailJobs: [job, ...community.emailJobs],
        updatedAt: new Date().toISOString(),
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [community.contacts, community.emailJobs, saveCommunity])

  const draftEmail = React.useCallback((audience: string) => {
    void queueEmailJob(audience)
    navigate(routes.action.newSession({
      name: 'Community email draft',
      input: `Draft a short fan email for ${audience}. Keep it warm, direct, and approval-ready.`,
    }))
  }, [queueEmailJob])

  const sendEmailViaResend = React.useCallback(async () => {
    if (emailRecipients.length === 0) {
      toast.error('No valid email recipients in this segment.')
      return
    }
    if (!emailDraft.from.trim() || !emailDraft.subject.trim() || !emailDraft.body.trim()) {
      toast.error('Add From, Subject, and Message first.')
      return
    }

    setSendingEmail(true)
    try {
      const result = await window.electronAPI.sendCommunityEmailViaResend({
        from: emailDraft.from,
        to: emailRecipients,
        subject: emailDraft.subject,
        text: emailDraft.body,
        replyTo: emailDraft.replyTo || undefined,
      })
      if (!result.ok) {
        if (result.error?.includes('Connect Resend')) {
          toast.error('Connect Resend first.')
          navigate(routes.view.settings('secrets'))
        } else {
          toast.error(result.error || 'Resend send failed.')
        }
        return
      }

      const now = new Date().toISOString()
      const recipientSet = new Set(emailRecipients)
      await saveCommunity({
        version: 1,
        contacts: community.contacts.map((contact) => (
          recipientSet.has(contact.email.trim())
            ? { ...contact, lastContacted: now, updatedAt: now }
            : contact
        )),
        emailJobs: [
          createCommunityEmailJob({
            title: emailDraft.subject,
            audience: audienceLabel,
            status: 'sent',
          }),
          ...community.emailJobs,
        ],
        updatedAt: now,
      })
      setEmailDraft((current) => ({ ...emptyEmailDraft, from: current.from, replyTo: current.replyTo }))
      toast.success(`Sent to ${result.sent ?? emailRecipients.length} recipient${emailRecipients.length === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSendingEmail(false)
    }
  }, [audienceLabel, community.contacts, community.emailJobs, emailDraft, emailRecipients, saveCommunity])

  const vipCount = community.contacts.filter((fan) => fan.segment === 'vip').length
  const emailReady = community.contacts.filter((fan) => fan.email.includes('@')).length

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="min-h-full w-full px-5 py-4 xl:px-8 xl:py-5">
        <header className="relative mb-6 overflow-hidden rounded-[24px] border border-white/[0.05] bg-[#0A0A0A] p-6 lg:p-8">
          <div className="absolute -left-[18%] -top-[50%] h-[520px] w-[520px] rounded-full bg-orange-600/10 blur-[110px]" />
          <div className="absolute -bottom-[50%] -right-[12%] h-[520px] w-[520px] rounded-full bg-orange-500/5 blur-[120px]" />
          <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1">
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1.5">
                <Users className="h-3.5 w-3.5 text-orange-300/80" />
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/65">Fan Base</span>
              </div>
              <div className="max-w-3xl">
                <h1 className="text-4xl font-medium tracking-tighter text-white/90 sm:text-5xl lg:text-[56px] lg:leading-[0.96]">
                  Community
                </h1>
                <p className="mt-3 max-w-2xl text-sm font-light leading-relaxed text-white/50">
                  Fans, segments, emails, and outreach jobs for the artist.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => navigate(routes.view.sourcesApi('gmail'))}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 text-xs font-medium text-white/68 transition-colors hover:bg-white/[0.06]"
              >
                <Mail className="h-3.5 w-3.5" />
                Connect Gmail
              </button>
              <button
                type="button"
                onClick={() => navigate(routes.view.settings('secrets'))}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 text-xs font-medium text-white/68 transition-colors hover:bg-white/[0.06]"
              >
                <Send className="h-3.5 w-3.5" />
                Connect Resend
              </button>
              <button
                type="button"
                onClick={() => toast.info('CSV import is next.')}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 text-xs font-medium text-white/68 transition-colors hover:bg-white/[0.06]"
              >
                <Upload className="h-3.5 w-3.5" />
                Import CSV
              </button>
              <button
                type="button"
                onClick={() => draftEmail(activeSegment === 'all' ? 'all fans' : `${segmentLabel(activeSegment)} fans`)}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-[#f97316]/90 px-4 text-xs font-medium text-white transition-colors hover:bg-[#f97316]"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Draft Email
              </button>
            </div>
          </div>
        </header>

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Fans" value={String(community.contacts.length)} detail={`${vipCount} VIP`} />
          <MetricCard label="Email Ready" value={String(emailReady)} detail="saved addresses" />
          <MetricCard label="Segments" value="5" detail="VIP, local, buyers, street, general" />
          <MetricCard label="Queued" value={String(community.emailJobs.length)} detail="email jobs" />
        </div>

        {!communityResult.ok ? (
          <div className="mb-4 rounded-[14px] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100/80">
            {communityResult.error} Saving is paused so existing community context is not overwritten.
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-[16px] border border-white/[0.05] bg-[#0c0c0c]/80 p-4">
            <div className="mb-4 flex flex-col gap-3 border-b border-white/[0.045] pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/50">Fan List</h2>
                <p className="mt-1 text-xs text-white/30">Email contacts saved into workspace context.</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {segmentFilters.map((segment) => (
                  <button
                    key={segment.id}
                    type="button"
                    onClick={() => setActiveSegment(segment.id)}
                    className={cn(
                      'h-7 rounded-full px-3 text-[11px] font-medium transition-colors',
                      activeSegment === segment.id
                        ? 'bg-white/[0.09] text-white/84'
                        : 'bg-white/[0.025] text-white/40 hover:bg-white/[0.05] hover:text-white/68',
                    )}
                  >
                    {segment.label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="flex h-48 items-center justify-center text-sm text-white/40">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading Community...
              </div>
            ) : visibleFans.length ? (
              <div className="space-y-1.5">
                {visibleFans.map((fan) => (
                  <FanRow key={fan.id} fan={fan} onDraft={() => draftEmail(`${fan.name} and similar ${segmentLabel(fan.segment)} fans`)} />
                ))}
              </div>
            ) : (
              <div className="flex h-48 flex-col items-center justify-center rounded-[12px] border border-dashed border-white/[0.04] bg-white/[0.01] text-center">
                <Users className="mb-2 h-5 w-5 text-white/10" />
                <p className="text-[13px] font-medium text-white/40">No fans saved yet.</p>
                <p className="mt-1 text-[11px] text-white/25">Add the first contact from the panel on the right.</p>
              </div>
            )}
          </section>

          <aside className="space-y-4">
            <section className="rounded-[16px] border border-white/[0.05] bg-[#0c0c0c]/80 p-4">
              <div className="mb-4 flex items-center gap-2 border-b border-white/[0.045] pb-3">
                <Plus className="h-3.5 w-3.5 text-white/40" />
                <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/50">Add Fan</h2>
              </div>
              <div className="space-y-1.5">
                <Input value={draft.name} placeholder="Name" onChange={(name) => setDraft((value) => ({ ...value, name }))} />
                <Input value={draft.email} placeholder="Email" onChange={(email) => setDraft((value) => ({ ...value, email }))} />
                <select
                  value={draft.segment}
                  onChange={(event) => setDraft((value) => ({ ...value, segment: event.target.value as CommunitySegment }))}
                  className="h-8 w-full rounded-[8px] border border-white/[0.04] bg-white/[0.015] px-3 text-[11px] text-white/70 outline-none focus:border-white/10"
                >
                  {segmentFilters.filter((segment) => segment.id !== 'all').map((segment) => (
                    <option key={segment.id} value={segment.id}>{segment.label}</option>
                  ))}
                </select>
                <Input value={draft.city} placeholder="City" onChange={(city) => setDraft((value) => ({ ...value, city }))} />
                <Input value={draft.source} placeholder="Source" onChange={(source) => setDraft((value) => ({ ...value, source }))} />
                <Input value={draft.tags} placeholder="Tags" onChange={(tags) => setDraft((value) => ({ ...value, tags }))} />
                <textarea
                  value={draft.notes}
                  placeholder="Notes"
                  onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))}
                  className="min-h-[64px] w-full resize-none rounded-[8px] border border-white/[0.04] bg-white/[0.015] px-3 py-2 text-[11px] text-white/70 outline-none placeholder:text-white/20 focus:border-white/10"
                />
                <button
                  type="button"
                  disabled={saving || !communityResult.ok}
                  onClick={() => void addFan()}
                  className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-orange-500/80 text-[11px] font-medium text-white transition-colors hover:bg-orange-500 disabled:cursor-wait disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  Save Fan
                </button>
              </div>
            </section>

            <section className="rounded-[16px] border border-white/[0.05] bg-[#0c0c0c]/80 p-4">
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/[0.045] pb-3">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-orange-300/70" />
                  <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/50">Send With Resend</h2>
                </div>
                <span className="text-[10px] tabular-nums text-white/28">{emailRecipients.length}</span>
              </div>
              <div className="space-y-1.5">
                <Input value={emailDraft.from} placeholder="From: artist@yourdomain.com" onChange={(from) => setEmailDraft((value) => ({ ...value, from }))} />
                <Input value={emailDraft.replyTo} placeholder="Reply-to optional" onChange={(replyTo) => setEmailDraft((value) => ({ ...value, replyTo }))} />
                <Input value={emailDraft.subject} placeholder="Subject" onChange={(subject) => setEmailDraft((value) => ({ ...value, subject }))} />
                <textarea
                  value={emailDraft.body}
                  placeholder={`Message to ${audienceLabel}`}
                  onChange={(event) => setEmailDraft((value) => ({ ...value, body: event.target.value }))}
                  className="min-h-[118px] w-full resize-none rounded-[8px] border border-white/[0.04] bg-white/[0.015] px-3 py-2 text-[11px] text-white/70 outline-none placeholder:text-white/20 focus:border-white/10"
                />
                <p className="text-[10px] leading-relaxed text-white/28">
                  Sends to the selected segment. From must be a verified Resend domain.
                </p>
                <button
                  type="button"
                  disabled={sendingEmail || emailRecipients.length === 0}
                  onClick={() => void sendEmailViaResend()}
                  className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-orange-500/80 text-[11px] font-medium text-white transition-colors hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sendingEmail ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  Send to {emailRecipients.length}
                </button>
              </div>
            </section>

            <section className="rounded-[16px] border border-white/[0.05] bg-[#0c0c0c]/80 p-4">
              <div className="mb-4 flex items-center justify-between border-b border-white/[0.045] pb-3">
                <div className="flex items-center gap-2">
                  <Send className="h-3.5 w-3.5 text-white/40" />
                  <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/50">Email Queue</h2>
                </div>
                <span className="text-[10px] tabular-nums text-white/28">{community.emailJobs.length}</span>
              </div>
              <div className="space-y-1.5">
                {community.emailJobs.length ? community.emailJobs.map((email) => (
                  <button
                    key={email.id}
                    type="button"
                    onClick={() => draftEmail(email.audience)}
                    className="group w-full rounded-[10px] border border-white/[0.03] bg-white/[0.015] px-3 py-2.5 text-left transition-colors hover:border-white/[0.06] hover:bg-white/[0.03]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="line-clamp-1 text-[13px] font-medium leading-5 text-white/70 group-hover:text-white/90">{email.title}</p>
                      <ArrowRight className="h-3.5 w-3.5 text-white/20 transition-colors group-hover:text-white/50" />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[9px] uppercase tracking-[0.1em] text-white/30">
                      <span>{email.audience}</span>
                      <span>{email.status}</span>
                    </div>
                  </button>
                )) : (
                  <div className="rounded-[12px] border border-dashed border-white/[0.04] bg-white/[0.01] px-3 py-5 text-center text-[11px] text-white/30">
                    No email jobs yet.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[16px] border border-white/[0.05] bg-[#0c0c0c]/80 p-4">
              <div className="mb-4 flex items-center gap-2 border-b border-white/[0.045] pb-3">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300/65" />
                <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/50">Next Moves</h2>
              </div>
              <div className="space-y-1.5">
                <ActionButton icon={Download} label="Export segment" onClick={() => toast.info('Segment export is next.')} />
                <ActionButton icon={Clock3} label="Schedule send" onClick={() => toast.info('Scheduling will use Gmail once connected.')} />
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[14px] border border-white/[0.04] bg-white/[0.015] px-4 py-3 transition-colors hover:bg-white/[0.025]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/40">{label}</p>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="text-2xl font-medium tracking-tight text-white/90">{value}</p>
        <p className="pb-0.5 text-right text-[11px] text-white/30">{detail}</p>
      </div>
    </div>
  )
}

function FanRow({ fan, onDraft }: { fan: CommunityContact; onDraft: () => void }) {
  return (
    <div className="group/fan grid grid-cols-1 gap-3 rounded-[12px] border border-white/[0.03] bg-white/[0.015] px-3 py-2.5 transition-colors hover:border-white/[0.06] hover:bg-white/[0.03] lg:grid-cols-[minmax(0,1.35fr)_100px_100px_minmax(0,1fr)_90px] lg:items-center">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-white/70 group-hover/fan:text-white/90 transition-colors">{fan.name}</p>
        <p className="mt-0.5 truncate text-[11px] text-white/30">{fan.email}</p>
      </div>
      <Badge>{segmentLabel(fan.segment)}</Badge>
      <p className="text-[11px] text-white/40">{fan.city ?? 'No city'}</p>
      <div className="min-w-0">
        <p className="truncate text-[11px] text-white/50">{fan.source ?? 'Manual'}</p>
        <p className="mt-0.5 truncate text-[10px] text-white/30">{fan.notes ?? 'No notes yet'}</p>
      </div>
      <button
        type="button"
        onClick={onDraft}
        className="inline-flex h-7 items-center justify-center gap-1.5 rounded-[8px] bg-white/[0.03] px-2.5 text-[11px] font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/90"
      >
        <Mail className="h-3 w-3" />
        Draft
      </button>
    </div>
  )
}

function Input({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full rounded-[8px] border border-white/[0.04] bg-white/[0.015] px-3 text-[11px] text-white/70 outline-none placeholder:text-white/20 focus:border-white/10"
    />
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 w-fit items-center rounded-full bg-white/[0.03] px-2 text-[9px] font-medium uppercase tracking-[0.12em] text-white/40">
      {children}
    </span>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-[8px] bg-white/[0.015] px-3 text-left text-[11px] font-medium text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white/80"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
