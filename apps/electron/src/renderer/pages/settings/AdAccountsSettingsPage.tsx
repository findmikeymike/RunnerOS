import * as React from 'react'
import { useSetAtom } from 'jotai'
import {
  BadgeDollarSign,
  CheckCircle2,
  Copy,
  ExternalLink,
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
import { SettingsCard, SettingsCardContent, SettingsSection } from '@/components/settings'
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
import { navigate, routes } from '@/lib/navigate'
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
        <div className="space-y-6 p-6">
          <SettingsSection
            title="Ad Accounts"
            description="Saved, isolated dashboard logins for Ad Runner. API keys and OAuth connections remain in Services."
            action={(
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="ghost" className="border border-white/10 bg-white/[0.04] text-white/68 hover:bg-white/[0.08] hover:text-white" onClick={() => navigate(routes.view.settings('secrets'))}>
                  <ExternalLink className="h-3.5 w-3.5" /> Services
                </Button>
                <Button type="button" size="sm" variant="secondary" className="border border-white/10 bg-white/[0.05] text-white/72 hover:bg-white/[0.09] hover:text-white" onClick={load} disabled={busy === 'load'}>
                  {busy === 'load' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />} Refresh
                </Button>
              </div>
            )}
          >
            <div className="space-y-3">
              {accounts.length === 0 && busy !== 'load' ? (
                <SettingsCard>
                  <SettingsCardContent>
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-400/12 text-orange-200"><BadgeDollarSign className="h-4 w-4" /></span>
                      <div>
                        <p className="text-sm font-semibold text-white/86">No ad dashboard accounts connected</p>
                        <p className="mt-1 text-xs leading-5 text-white/42">Add Meta or Google Ads, then log in once through the controlled browser. Spotify Ads Manager is connected under Spotify.</p>
                      </div>
                    </div>
                  </SettingsCardContent>
                </SettingsCard>
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

          <SettingsSection title="Add Ad Account" description="Use one isolated profile per dashboard account selection. Create another profile when the same login manages a different client account.">
            <SettingsCard>
              <SettingsCardContent>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Provider">
                    <select value={provider} onChange={(event) => setProvider(event.target.value as AdBrowserProvider)} className={inputClass}>
                      <option value="meta-ads">Meta Ads</option>
                      <option value="google-ads">Google Ads</option>
                    </select>
                  </Field>
                  <Field label="Local Account Name">
                    <input value={profile} placeholder={PROVIDERS[provider].defaultProfile} onChange={(event) => setProfile(event.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Display Label">
                    <input value={label} placeholder={PROVIDERS[provider].label} onChange={(event) => setLabel(event.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Account ID (optional)">
                    <input value={accountId} placeholder="Auto-detected when possible" onChange={(event) => setAccountId(event.target.value)} className={inputClass} />
                  </Field>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-[11px] leading-4 text-white/32">Agents attach this login with <span className="font-mono text-white/50">{provider}/{profile.trim() || PROVIDERS[provider].defaultProfile}</span>.</p>
                  <Button type="button" onClick={addAccount} disabled={busy === 'add'} className="shrink-0 bg-white text-black hover:bg-white/90">
                    {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Account
                  </Button>
                </div>
              </SettingsCardContent>
            </SettingsCard>
          </SettingsSection>

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
    <SettingsCard divided={false}>
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-400/12 text-orange-200"><BadgeDollarSign className="h-4 w-4" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-white/86">{account.label}</p>
              <StatusPill account={account} />
            </div>
            <p className="mt-0.5 text-[11px] text-white/38">{provider.purpose}</p>
            <p className="mt-1 font-mono text-[11px] text-white/38">{account.provider}/{account.profile}{account.accountId ? ` · ${formatAccountId(account.provider, account.accountId)}` : ''}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" className="border border-white/15 bg-white text-black hover:bg-white/90" onClick={onOpen} disabled={accountBusy}>
            {busy === accountKey(account, 'login') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />} {account.ready ? 'Open' : 'Connect'}
          </Button>
          <Button type="button" size="sm" variant="secondary" className="border border-amber-300/25 bg-amber-400/10 text-amber-100 hover:bg-amber-400/16 hover:text-amber-50" onClick={onVerify} disabled={accountBusy}>
            {busy === accountKey(account, 'verify') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Verify
          </Button>
          <Button type="button" size="sm" variant="ghost" className="border border-white/10 bg-white/[0.04] text-white/68 hover:bg-white/[0.08] hover:text-white" onClick={copyRef}><Copy className="h-3.5 w-3.5" /> Copy Ref</Button>
          <Button type="button" size="sm" variant="ghost" className="border border-red-300/15 bg-red-400/[0.06] text-red-200/75 hover:bg-red-400/12 hover:text-red-100" onClick={onDelete} disabled={accountBusy}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
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
