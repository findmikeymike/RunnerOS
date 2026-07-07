import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { defaultFinalSlotForOutput, finalPointerLabel, removeInputForFinal, resolveCampaignFinalId } from '@/lib/output-finals-actions'
import type {
  OutputFinalPointerDTO,
  OutputManifestDTO,
  OutputSummaryDTO,
  PromoteOutputToFinalInputDTO,
  RemoveOutputFromFinalInputDTO,
} from '@/hooks/useOutputs'

type OutputLike = OutputSummaryDTO | OutputManifestDTO
type FinalAction = 'promote' | 'primary' | 'remove'
const EMPTY_FINALS: OutputFinalPointerDTO[] = []

interface OutputFinalActionDialogProps {
  open: boolean
  action: FinalAction
  output: OutputLike | null
  currentCampaignId?: string
  onOpenChange: (open: boolean) => void
  promoteToFinal: (input: PromoteOutputToFinalInputDTO) => Promise<OutputFinalPointerDTO>
  removeFromFinal: (input: RemoveOutputFromFinalInputDTO) => Promise<number>
}

export function OutputFinalActionDialog({
  open,
  action,
  output,
  currentCampaignId,
  onOpenChange,
  promoteToFinal,
  removeFromFinal,
}: OutputFinalActionDialogProps) {
  const finals = output?.finals ?? EMPTY_FINALS
  const [scope, setScope] = React.useState<'hq' | 'campaign'>('campaign')
  const [campaignId, setCampaignId] = React.useState('')
  const [slot, setSlot] = React.useState('')
  const [finalId, setFinalId] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open || !output) return
    const existing = finals.find((entry) => entry.isPrimary) ?? finals[0]
    const nextScope = action === 'promote'
      ? output.context?.scope ?? existing?.scope ?? 'campaign'
      : existing?.scope ?? 'campaign'
    setScope(nextScope)
    setCampaignId(resolveCampaignFinalId({
      existing: action === 'promote' ? undefined : existing,
      output,
      currentCampaignId,
    }) ?? '')
    setSlot(formatSlot(existing?.slot ?? defaultFinalSlotForOutput(output)))
    setFinalId(existing?.id ?? '')
    setSaving(false)
  }, [action, currentCampaignId, finals, open, output])

  if (!output) return null
  const selectedFinal = finals.find((entry) => entry.id === finalId) ?? finals[0]
  const isRemove = action === 'remove'
  const isPrimary = action === 'primary'
  const title = isRemove ? 'Remove from Finals' : isPrimary ? 'Set as Primary' : 'Set as Final'
  const needsCampaignId = !isRemove && (isPrimary ? selectedFinal?.scope === 'campaign' : scope === 'campaign')
  const canResolveCampaignId = Boolean(resolveCampaignFinalId({
    existing: isPrimary ? selectedFinal : undefined,
    output,
    currentCampaignId,
  })?.trim())
  const showCampaignIdFallback = needsCampaignId && !canResolveCampaignId

  async function submit() {
    if (!output) return
    if ((isRemove || isPrimary) && !selectedFinal) {
      toast.error('Choose a Final first.')
      return
    }
    const resolvedCampaignId = resolveCampaignFinalId({
      existing: isPrimary ? selectedFinal : undefined,
      output,
      currentCampaignId,
      fallbackCampaignId: campaignId,
    })
    if (needsCampaignId && !resolvedCampaignId) {
      toast.error('Campaign context is required for Campaign Finals.')
      return
    }
    if (!isRemove && !slot.trim()) {
      toast.error('Finals slot is required.')
      return
    }
    setSaving(true)
    try {
      if (isRemove) {
        const removed = await removeFromFinal(removeInputForFinal(selectedFinal!))
        toast.success(removed > 0 ? 'Removed from Finals' : 'No Finals removed')
      } else {
        const finalScope = isPrimary ? selectedFinal!.scope : scope
        await promoteToFinal({
          outputId: output.id,
          scope: finalScope,
          campaignId: finalScope === 'campaign' ? resolvedCampaignId : undefined,
          slot: isPrimary ? selectedFinal!.slot : slot.trim(),
          assetId: isPrimary ? selectedFinal!.assetId : output.primary?.id,
          makePrimary: isPrimary,
        })
        toast.success(isPrimary ? 'Set as Primary' : 'Set as Final')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error('Finals update failed', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{output.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {(isRemove || isPrimary) && (
            <label className="block space-y-1.5 text-xs text-muted-foreground">
              <span>Final</span>
              <select
                value={selectedFinal?.id ?? ''}
                onChange={(event) => {
                  const next = finals.find((entry) => entry.id === event.target.value)
                  setFinalId(event.target.value)
                  setCampaignId(next?.campaignId ?? '')
                }}
                className="h-9 w-full rounded-md border border-foreground/15 bg-background px-2 text-sm text-foreground"
              >
                {finals.map((final) => (
                  <option key={final.id} value={final.id}>{finalPointerLabel(final)}</option>
                ))}
              </select>
            </label>
          )}
          {!isRemove && !isPrimary && (
            <label className="block space-y-1.5 text-xs text-muted-foreground">
              <span>Scope</span>
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value === 'hq' ? 'hq' : 'campaign')}
                className="h-9 w-full rounded-md border border-foreground/15 bg-background px-2 text-sm text-foreground"
              >
                <option value="campaign">Campaign</option>
                <option value="hq">HQ</option>
              </select>
            </label>
          )}
          {showCampaignIdFallback && (
            <label className="block space-y-1.5 text-xs text-muted-foreground">
              <span>Campaign</span>
              <input
                value={campaignId}
                onChange={(event) => setCampaignId(event.target.value)}
                className="h-9 w-full rounded-md border border-foreground/15 bg-background px-2 text-sm text-foreground"
              />
            </label>
          )}
          {!isRemove && (
            <label className="block space-y-1.5 text-xs text-muted-foreground">
              <span>Slot</span>
              <input
                value={isPrimary ? formatSlot(selectedFinal?.slot ?? '') : slot}
                onChange={(event) => setSlot(event.target.value)}
                disabled={isPrimary}
                className="h-9 w-full rounded-md border border-foreground/15 bg-background px-2 text-sm text-foreground disabled:opacity-60"
              />
            </label>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving' : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatSlot(slot: string): string {
  return slot.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}
