import * as React from 'react'
import { AlertTriangle, Archive, Check, MessageCircleMore, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { OutputAssetDTO, OutputManifestDTO } from '@/hooks/useOutputs'
import { buildRunnerOutputAssetUrl } from '@craft-agent/shared/outputs/web-preview'

interface Props {
  workspaceId: string
  manifest: OutputManifestDTO
  compact?: boolean
  onUse?: (variantId: string) => void
  onRevise?: (variantId: string) => void
  onArchive?: (variantId: string) => void
}

export function SocialVariantSetPreview({ workspaceId, manifest, compact, onUse, onRevise, onArchive }: Props) {
  const set = manifest.socialVariantSet
  if (!set) return null
  const visible = set.variants.filter((variant) => variant.state !== 'archived')
  const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-white/[0.035] px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/34">Source</div>
          <div className="mt-1 truncate text-sm text-white/78">{set.sources.map((source) => source.title).join(' · ')}</div>
        </div>
        <div className="text-xs text-white/40">{visible.filter((variant) => variant.state === 'ready').length} / {set.request.totalRequested} ready</div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-[14px] bg-white/[0.025] px-4 py-8 text-center text-sm text-white/38">
          {set.status === 'archived' ? 'All variants archived' : 'The editor is creating your variants.'}
        </div>
      ) : (
        <div className={compact ? 'grid grid-cols-1 gap-3' : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'}>
          {visible.map((variant) => (
            <VariantCard
              key={variant.id}
              workspaceId={workspaceId}
              outputId={manifest.id}
              asset={variant.assetId ? assets.get(variant.assetId) : undefined}
              variant={variant}
              compact={compact}
              onUse={onUse}
              onRevise={onRevise}
              onArchive={onArchive}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function VariantCard({ workspaceId, outputId, asset, variant, compact, onUse, onRevise, onArchive }: {
  workspaceId: string
  outputId: string
  asset?: OutputAssetDTO
  variant: NonNullable<OutputManifestDTO['socialVariantSet']>['variants'][number]
  compact?: boolean
  onUse?: (variantId: string) => void
  onRevise?: (variantId: string) => void
  onArchive?: (variantId: string) => void
}) {
  const ready = variant.state === 'ready' && asset
  return (
    <article className="overflow-hidden rounded-[16px] bg-white/[0.035]">
      <div className={compact ? 'aspect-video bg-black' : 'aspect-[9/12] max-h-[430px] bg-black'}>
        {ready ? (
          <video
            src={buildRunnerOutputAssetUrl(workspaceId, outputId, asset.path)}
            controls
            preload="metadata"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-5 text-center text-xs text-amber-200/62">
            <AlertTriangle className="mr-2 h-4 w-4" />
            {variant.failureReason ?? 'Render in progress'}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-white/84">{variant.title}</h3>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/42">{variant.editorialIntent}</p>
          </div>
          {ready ? <span className="flex shrink-0 items-center gap-1 text-[10px] text-white/38"><Check className="h-3 w-3" /> Saved</span> : null}
        </div>
        <div className="mt-2 text-[10px] uppercase tracking-[0.12em] text-white/30">
          {variant.destination.platform} · {variant.destination.accountRole}{variant.destination.mode === 'trial' ? ' · Trial' : ''}
        </div>
        {(onUse || onRevise || onArchive) ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ready && onUse ? <Button size="sm" className="h-7 bg-[#f97316] px-2.5 text-[11px] text-black hover:bg-[#fb923c]" onClick={() => onUse(variant.id)}><Send className="mr-1 h-3 w-3" />Use this version</Button> : null}
            {onRevise ? <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-white/55 hover:bg-white/[0.06] hover:text-white/80" onClick={() => onRevise(variant.id)}><MessageCircleMore className="mr-1 h-3 w-3" />Revise</Button> : null}
            {onArchive ? <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-white/38 hover:bg-white/[0.06] hover:text-white/70" onClick={() => onArchive(variant.id)}><Archive className="mr-1 h-3 w-3" />Archive</Button> : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}
