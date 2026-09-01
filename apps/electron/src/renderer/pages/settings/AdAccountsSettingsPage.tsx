import * as React from 'react'
import { useSetAtom } from 'jotai'
import {
  BadgeDollarSign,
  CheckCircle2,
  Copy,
  Loader2,
  LogIn,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { openBrowserSidecarAtom, setBrowserInstancesAtom } from '@/atoms/browser-pane'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type {
  AdBrowserAccountStatus,
  AdBrowserProvider,
} from '../../../shared/types'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'ad-accounts',
}

const PROVIDERS: Record<AdBrowserProvider, { label: string; purpose: string; defaultProfile: string }> = {
  'meta-ads': { label: 'Meta Ads Manager', purpose: 'Facebook and Instagram paid campaigns', defaultProfile: 'meta-main' },
  'google-ads': { label: 'Google Ads', purpose: 'Search, display, and YouTube paid campaigns', defaultProfile: 'google-main' },
}

export default function AdAccountsSettingsPage() {
  const openBrowserSidecar = useSetAtom(openBrowserSidecarAtom)
  const setBrowserInstances = useSetAtom(setBrowserInstancesAtom)
  const [accounts, setAccounts] = React.useState<AdBrowserAccountStatus[]>([])
  const [provider, setProvider] = React.useState<AdBrowserProvider>('meta-ads')
  const [profile, setProfile] = React.useState('')
  const [label, setLabel] = React.useState('')
  const [accountId, setAccountId] = React.useState('')
  const [addOpen, setAddOpen] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState<AdBrowserAccountStatus | null>(null)
  const [busy, setBusy] = React.useState<string | null>('load')

  const load = React.useCallback(async () => {
    setBusy('load')
    try {
      setAccounts(await window.electronAPI.listAdBrowserAccounts())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load ad accounts')
    } finally {
      setBusy(null)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const addAccount = async () => {
    const nextProfile = profile.trim() || PROVIDERS[provider].defaultProfile
    if (accounts.some((account) => account.provider === provider && account.profile === nextProfile)) {
      toast.error('That saved ad account already exists')
      return
    }
    setBusy('add')
    try {
      await window.electronAPI.saveAdBrowserAccount({
        provider,
        profile: nextProfile,
        label: label.trim() || PROVIDERS[provider].label,
        accountId: accountId.trim() || null,
      })
      setProfile('')
      setLabel('')
      setAccountId('')
      setAddOpen(false)
      await load()
      toast.success('Ad account added')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add ad account')
    } finally {
      setBusy(null)
    }
  }

  const openLogin = async (account: AdBrowserAccountStatus) => {
    const key = accountKey(account, 'login')
    setBusy(key)
    try {
      const result = await window.electronAPI.loginAdBrowserAccount(account)
      if (result.browserInstanceId) {
        const instances = await window.electronAPI.browserPane.list()
        setBrowserInstances(instances)
        openBrowserSidecar(result.browserInstanceId)
      }
      toast.success('Dashboard opened. Sign in if needed, then click Verify.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open ad dashboard')
    } finally {
      setBusy(null)
    }
  }

  const verify = async (account: AdBrowserAccountStatus) => {
    const key = accountKey(account, 'verify')
    setBusy(key)
    try {
      const result = await window.electronAPI.getAdBrowserAccountStatus(account)
      setAccounts((current) => current.map((item) => sameAccount(item, result) ? result : item))
      if (result.browserInstanceId) {
        const instances = await window.electronAPI.browserPane.list()
        setBrowserInstances(instances)
        openBrowserSidecar(result.browserInstanceId)
      }
      if (result.ready) toast.success(`${result.label} verified`)
      else toast.warning(result.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not verify ad account')
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!pendingDelete) return
    const account = pendingDelete
    setBusy(accountKey(account, 'delete'))
    try {
      await window.electronAPI.deleteAdBrowserAccount(account)
      setPendingDelete(null)
      await load()
      toast.success('Ad account and saved browser login removed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove ad account')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader />
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-6">
          <SettingsSection
            title="Ad Accounts"
            description="Connect the ad dashboards your team uses."
            action={(
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Refresh ad accounts"
                title="Refresh"
                className="h-8 w-8 p-0 text-white/42 hover:bg-white/[0.06] hover:text-white/76"
                onClick={load}
                disabled={busy === 'load'}
              >
                {busy === 'load' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
              </Button>
            )}
          >
            <div className="space-y-2">
              {accounts.length === 0 && busy !== 'load' ? (
                <p className="rounded-xl bg-white/[0.025] px-4 py-5 text-sm text-white/46">Add Meta Ads or Google Ads to connect its dashboard.</p>
              ) : null}

              {accounts.map((account) => (
                <AdAccountCard
                  key={`${account.provider}/${account.profile}`}
                  account={account}
                  busy={busy}
                  onOpen={() => openLogin(account)}
                  onVerify={() => verify(account)}
                  onDelete={() => setPendingDelete(account)}
                />
              ))}
            </div>
          </SettingsSection>

          {accounts.length > 0 && !addOpen ? (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-xs font-medium text-white/42 transition-colors hover:bg-white/[0.04] hover:text-white/72"
            >
              <Plus className="h-3.5 w-3.5" />
              Add ad account
            </button>
          ) : null}

          {accounts.length === 0 || addOpen ? (
            <SettingsSection title="Add Ad Account">
              <SettingsCard className="!border-0 shadow-none">
                <div className="grid gap-3 p-3 md:grid-cols-2">
                  <Field label="Provider">
                    <select value={provider} onChange={(event) => setProvider(event.target.value as AdBrowserProvider)} className={inputClass}>
                      <option value="meta-ads">Meta Ads</option>
                      <option value="google-ads">Google Ads</option>
                    </select>
                  </Field>
                  <Field label="Local Account Name">
                    <input value={profile} placeholder={PROVIDERS[provider].defaultProfile} onChange={(event) => setProfile(event.target.value)} className={inputClass} />
                  </Field>
                </div>
                <details className="mx-3 border-t border-white/[0.055] py-2 text-xs text-white/40">
                  <summary className="cursor-pointer select-none py-1 hover:text-white/68">Optional details</summary>
                  <div className="grid gap-3 pb-2 pt-2 md:grid-cols-2">
                    <Field label="Display Label">
                      <input value={label} placeholder={PROVIDERS[provider].label} onChange={(event) => setLabel(event.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Account ID">
                      <input value={accountId} placeholder="Auto-detected when possible" onChange={(event) => setAccountId(event.target.value)} className={inputClass} />
                    </Field>
                  </div>
                </details>
                <div className="flex items-center justify-end gap-2 px-3 pb-3 pt-1">
                  {accounts.length > 0 ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setAddOpen(false)} className="text-white/42 hover:text-white/72">Cancel</Button>
                  ) : null}
                  <Button type="button" onClick={addAccount} disabled={busy === 'add'} className="bg-white text-black hover:bg-white/90">
                    {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add Account
                  </Button>
                </div>
              </SettingsCard>
            </SettingsSection>
          ) : null}

          <DeleteAdAccountDialog account={pendingDelete} busy={Boolean(pendingDelete && busy === accountKey(pendingDelete, 'delete'))} onCancel={() => setPendingDelete(null)} onConfirm={remove} />
        </div>
      </ScrollArea>
    </div>
  )
}

function AdAccountCard({ account, busy, onOpen, onVerify, onDelete }: { account: AdBrowserAccountStatus; busy: string | null; onOpen: () => void; onVerify: () => void; onDelete: () => void }) {
  const provider = PROVIDERS[account.provider]
  const accountBusy = Boolean(busy?.startsWith(`${account.provider}/${account.profile}:`))
  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(`${account.provider}/${account.profile}`)
      toast.success('Ad account reference copied')
    } catch {
      toast.error('Could not copy account reference')
    }
  }
  return (
    <SettingsCard divided={false} className="!border-0 bg-[#0d0d0f] shadow-none">
      <div className="flex min-h-[68px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#e65320]/32 text-[#ffc0a3]"><BadgeDollarSign className="h-3.5 w-3.5" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-white/86">{account.label}</p>
              <StatusPill account={account} />
            </div>
            <p className="mt-0.5 truncate text-xs text-white/34">{provider.purpose}{account.accountId ? ` · ${formatAccountId(account.provider, account.accountId)}` : ''}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
          <Button type="button" size="sm" variant="secondary" className="h-8 min-w-[92px] border-0 bg-white text-black hover:bg-white/90" onClick={onOpen} disabled={accountBusy}>
            {busy === accountKey(account, 'login') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />} {account.ready ? 'Open' : 'Connect'}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2.5 text-xs text-white/48 hover:bg-white/[0.055] hover:text-white/76" onClick={onVerify} disabled={accountBusy}>
            {busy === accountKey(account, 'verify') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Verify
          </Button>
          <Button type="button" size="sm" variant="ghost" aria-label="Copy ad account reference" title="Copy account reference" className="h-8 w-8 p-0 text-white/30 hover:bg-white/[0.055] hover:text-white/68" onClick={copyRef}><Copy className="h-3.5 w-3.5" /></Button>
          <Button type="button" size="sm" variant="ghost" aria-label="Delete ad account" title="Delete account" className="h-8 w-8 p-0 text-white/26 hover:bg-red-400/[0.08] hover:text-red-200/80" onClick={onDelete} disabled={accountBusy}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    </SettingsCard>
  )
}

function StatusPill({ account }: { account: AdBrowserAccountStatus }) {
  const ready = account.ready
  return (
    <span className={ready ? 'inline-flex items-center gap-1 rounded-full bg-emerald-400/12 px-2 py-1 text-[11px] font-medium text-emerald-200' : 'inline-flex items-center gap-1 rounded-full bg-amber-400/12 px-2 py-1 text-[11px] font-medium text-amber-200'} title={account.message}>
      {ready ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {ready ? 'Ready' : account.status === 'wrong_account' ? 'Wrong account' : account.status === 'identity_unverified' ? 'Verify identity' : account.status === 'login_needed' ? 'Login needed' : 'Not checked'}
    </span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1"><span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/34">{label}</span>{children}</label>
}

function DeleteAdAccountDialog({ account, busy, onCancel, onConfirm }: { account: AdBrowserAccountStatus | null; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={Boolean(account)} onOpenChange={(open) => { if (!open && !busy) onCancel() }}>
      <DialogContent className="dark border-white/10 bg-[#111] text-white sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Delete saved ad account?</DialogTitle>
          <DialogDescription>This removes <span className="font-mono text-white/72">{account?.provider}/{account?.profile}</span> and clears its isolated browser cookies. It does not alter the external ad account.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" className="border-white/12 bg-white/[0.04] text-white/78 hover:bg-white/[0.08] hover:text-white" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="button" variant="destructive" className="bg-red-500 text-white hover:bg-red-400" onClick={onConfirm} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function sameAccount(a: AdBrowserAccountStatus, b: AdBrowserAccountStatus) {
  return a.provider === b.provider && a.profile === b.profile
}

function accountKey(account: Pick<AdBrowserAccountStatus, 'provider' | 'profile'>, action: string) {
  return `${account.provider}/${account.profile}:${action}`
}

function formatAccountId(provider: AdBrowserProvider, accountId: string) {
  const digits = accountId.replace(/\D/g, '')
  if (provider === 'google-ads' && digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  return digits || accountId
}

const inputClass = 'h-9 w-full rounded-md border border-white/10 bg-white/[0.035] px-3 text-sm text-white outline-none placeholder:text-white/22'
