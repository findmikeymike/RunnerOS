import * as React from 'react'
import { Box, CheckCircle2, FileText, Image, Link2, PackageCheck, Plus, ReceiptText, Scissors, Search, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EntityRow } from '@/components/ui/entity-row'
import { Input } from '@/components/ui/input'
import { useMenuComponents } from '@/components/ui/menu-context'
import { cn } from '@/lib/utils'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../../shared/routes'
import { setPendingReleaseKitOutput } from '@/lib/release-kit-navigation'
import { OutputFinalActionDialog } from '@/components/outputs/OutputFinalActionDialog'
import { useOutputs, type OutputFinalPointerDTO, type OutputKind, type OutputSummaryDTO } from '@/hooks/useOutputs'
import { SocialVariantSetupDrawer, type SocialVariantSetupSource } from '@/components/social-variants/SocialVariantSetupDrawer'
import { Button } from '@/components/ui/button'

type TFn = (key: string, options?: Record<string, unknown>) => string

interface Props {
  workspaceId: string | null | undefined
  currentCampaignId?: string
  outputs: OutputSummaryDTO[]
  loading: boolean
  error: string | null
  selectedOutputId?: string | null
  onOutputClick: (outputId: string) => void
}

export function OutputsListPanel({
  workspaceId,
  currentCampaignId,
  outputs,
  loading,
  error,
  selectedOutputId,
  onOutputClick,
}: Props) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { promoteToFinal, removeFromFinal } = useOutputs(workspaceId)
  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState<'all' | 'variants'>('all')
  const [variantSetupOpen, setVariantSetupOpen] = React.useState(false)
  const [finalAction, setFinalAction] = React.useState<{
    output: OutputSummaryDTO
    action: 'promote' | 'primary' | 'remove'
  } | null>(null)
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    const scoped = filter === 'variants' ? outputs.filter((output) => Boolean(output.socialVariantSetSummary)) : outputs
    if (!q) return scoped
    return scoped.filter((output) => {
      const haystack = [
        output.title,
        output.summary,
        output.kind,
        output.status,
        output.origin?.workflowName,
        output.origin?.agentName,
        output.origin?.source,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [filter, outputs, query])
  const variantSources = React.useMemo<SocialVariantSetupSource[]>(() => outputs
    .filter(isOutputVideoSource)
    .map((output) => ({
      id: output.id,
      title: output.title,
      detail: 'HQ Output',
      selection: {
        origin: 'output' as const,
        sourceId: output.id,
        ...(output.primary?.id ? { assetId: output.primary.id } : {}),
      },
      absolutePath: output.primary ? displayOutputAssetPath(output.id, output.primary.path) : undefined,
      sha256: output.primary?.sha256,
      ...(!output.primary?.sha256 ? { restriction: 'This video Output needs a verified checksum before agents can use it.' } : {}),
    })), [outputs])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 py-2 border-b border-border/30">
        {!currentCampaignId ? (
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterButton>
              <FilterButton active={filter === 'variants'} onClick={() => setFilter('variants')}>
                <Scissors className="h-3 w-3" /> Variants
              </FilterButton>
            </div>
            {filter === 'variants' ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!workspaceId}
                onClick={() => setVariantSetupOpen(true)}
                className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
              >
                <Plus className="h-3 w-3" />Create variants
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('outputsList.searchPlaceholder')}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto py-1">
        {loading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t('outputsList.loading')}</div>
        ) : error ? (
          <div className="m-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center px-5 text-center text-sm text-muted-foreground">
            {query ? t('outputsList.emptySearch') : filter === 'variants' ? 'No video Variant Sets yet.' : t('outputsList.empty')}
          </div>
        ) : (
          filtered.map((output, index) => (
            <EntityRow
              key={output.id}
              icon={<OutputKindIcon kind={output.kind} />}
              title={output.title}
              subtitle={output.summary || producerLabel(output, t)}
              badges={
                <div className="flex min-w-0 items-center gap-1.5">
                  <StatusPill status={output.status} />
                  <span className="truncate text-muted-foreground">
                    {formatKind(output.kind)} · {producerLabel(output, t)}
                  </span>
                </div>
              }
              titleTrailing={<span className="text-[11px] text-muted-foreground">{formatRelativeTime(output.createdAt, t)}</span>}
              titleSuffix={!currentCampaignId && output.finals?.length ? <FinalBadge finals={output.finals} /> : undefined}
              menuContent={
                <OutputFinalsMenu
                  output={output}
                  campaignMode={Boolean(currentCampaignId)}
                  onOpenReleaseKit={() => {
                    setPendingReleaseKitOutput(output.id)
                    navigate(routes.view.campaign('release-kit'))
                  }}
                  onAction={(action) => setFinalAction({ output, action })}
                />
              }
              isSelected={selectedOutputId === output.id}
              onClick={() => onOutputClick(output.id)}
              showSeparator={index > 0}
            />
          ))
        )}
      </div>
      {!currentCampaignId ? <OutputFinalActionDialog
        open={Boolean(finalAction)}
        action={finalAction?.action ?? 'promote'}
        output={finalAction?.output ?? null}
        onOpenChange={(open) => {
          if (!open) setFinalAction(null)
        }}
        promoteToFinal={promoteToFinal}
        removeFromFinal={removeFromFinal}
        currentCampaignId={currentCampaignId}
      /> : null}
      {workspaceId && !currentCampaignId ? (
        <SocialVariantSetupDrawer
          open={variantSetupOpen}
          workspaceId={workspaceId}
          sources={variantSources}
          onOpenChange={setVariantSetupOpen}
        />
      ) : null}
    </div>
  )
}

function isOutputVideoSource(output: OutputSummaryDTO): boolean {
  const asset = output.primary
  if (!asset) return false
  return output.kind === 'video'
    || asset.mimeType?.toLowerCase().startsWith('video/') === true
    || /\.(?:mp4|mov|m4v|webm)$/i.test(asset.path)
}

function displayOutputAssetPath(outputId: string, assetPath: string): string {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(assetPath)
    ? assetPath
    : `outputs/${outputId}/${assetPath}`
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-[6px] px-2 text-[11px] transition-colors',
        active ? 'bg-white/[0.09] text-foreground' : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function OutputFinalsMenu({
  output,
  campaignMode,
  onOpenReleaseKit,
  onAction,
}: {
  output: OutputSummaryDTO
  campaignMode: boolean
  onOpenReleaseKit: () => void
  onAction: (action: 'promote' | 'primary' | 'remove') => void
}) {
  const { MenuItem, Separator } = useMenuComponents()
  const primary = output.finals?.find((entry) => entry.isPrimary)
  if (campaignMode) {
    return (
      <MenuItem onClick={onOpenReleaseKit}>
        <PackageCheck className="mr-2 h-3.5 w-3.5" />
        Approve in Release Kit
      </MenuItem>
    )
  }
  return (
    <>
      <MenuItem onClick={() => onAction('promote')}>
        <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
        Set as Final
      </MenuItem>
      {output.finals?.length ? (
        <MenuItem onClick={() => onAction('primary')}>
          <Star className="mr-2 h-3.5 w-3.5" />
          Set as Primary
        </MenuItem>
      ) : null}
      {output.finals?.length ? (
        <>
          <Separator />
          <MenuItem onClick={() => onAction('remove')}>
            Remove from Finals
          </MenuItem>
        </>
      ) : null}
      {primary ? <FinalMenuNote final={primary} /> : null}
    </>
  )
}

function FinalBadge({ finals }: { finals: OutputFinalPointerDTO[] }) {
  const primary = finals.some((entry) => entry.isPrimary)
  return (
    <span className={cn(
      'inline-flex h-5 items-center gap-1 rounded-[4px] px-1.5 text-[10px] font-medium',
      primary ? 'bg-sky-500/12 text-sky-300' : 'bg-emerald-500/10 text-emerald-300',
    )}>
      {primary ? 'Primary' : 'Final'}
    </span>
  )
}

function FinalMenuNote({ final }: { final: OutputFinalPointerDTO }) {
  return (
    <div className="max-w-[220px] px-2 py-1 text-[11px] text-muted-foreground">
      {formatSlot(final.slot)} · {final.scope === 'hq' ? 'HQ' : 'Campaign'}
    </div>
  )
}

function formatSlot(slot: string): string {
  return slot.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium capitalize',
        status === 'published' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        status === 'draft' && 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
        status === 'failed' && 'bg-destructive/10 text-destructive',
        status === 'cancelled' && 'bg-foreground/10 text-muted-foreground',
      )}
    >
      {status}
    </span>
  )
}

function OutputKindIcon({ kind }: { kind: OutputKind }) {
  const className = 'h-3.5 w-3.5 text-muted-foreground'
  if (kind === 'image' || kind === 'video' || kind === 'audio') return <Image className={className} />
  if (kind === 'model') return <Box className={className} />
  if (kind === 'receipt' || kind === 'external-action') return <ReceiptText className={className} />
  if (kind === 'other' || kind === 'collection') return <Link2 className={className} />
  return <FileText className={className} />
}

function formatKind(kind: string): string {
  return kind.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function producerLabel(output: OutputSummaryDTO, t: TFn): string {
  const origin = output.origin
  if (!origin) return t('outputsList.producerManual')
  if (origin.workflowName) return origin.workflowName
  if (origin.agentName) return origin.agentName
  if (origin.workflowSlug) return origin.workflowSlug
  if (origin.agentSlug) return origin.agentSlug
  return formatKind(origin.source)
}

function formatRelativeTime(value: string | undefined, t: TFn): string {
  if (!value) return ''
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  const diff = Date.now() - ms
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return t('common.justNow')
  if (minutes < 60) return t('time.compact.minutes', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('time.compact.hours', { count: hours })
  const days = Math.round(hours / 24)
  if (days < 7) return t('time.compact.days', { count: days })
  return new Date(ms).toLocaleDateString()
}
