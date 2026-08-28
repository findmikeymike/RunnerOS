import { existsSync } from 'fs';
import { join } from 'path';
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts';
import { CONFIG_DIR } from './paths.ts';
import { ensureConfigDir } from './storage.ts';

export type AdBrowserProvider = 'meta-ads' | 'google-ads';

export interface AdBrowserAccount {
  provider: AdBrowserProvider;
  profile: string;
  label: string;
  accountId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdBrowserAccountInput {
  provider: AdBrowserProvider;
  profile: string;
  label?: string;
  accountId?: string | null;
}

type AdBrowserAccountFile = {
  version: 1;
  accounts: AdBrowserAccount[];
};

const FILE_PATH = join(CONFIG_DIR, 'ad-browser-accounts.json');
const PROVIDERS = new Set<AdBrowserProvider>(['meta-ads', 'google-ads']);
const PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function listAdBrowserAccounts(): AdBrowserAccount[] {
  if (!existsSync(FILE_PATH)) return [];
  try {
    const parsed = readJsonFileSync<unknown>(FILE_PATH);
    if (!isRecord(parsed) || !Array.isArray(parsed.accounts)) return [];
    return parsed.accounts
      .map(normalizeStoredAccount)
      .filter((account): account is AdBrowserAccount => account !== null)
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.profile.localeCompare(b.profile));
  } catch {
    return [];
  }
}

export function getAdBrowserAccount(provider: AdBrowserProvider, profile: string): AdBrowserAccount | null {
  return listAdBrowserAccounts().find((account) => account.provider === provider && account.profile === profile) ?? null;
}

export function saveAdBrowserAccount(input: AdBrowserAccountInput): AdBrowserAccount {
  const provider = assertProvider(input.provider);
  const profile = assertProfile(input.profile);
  const accounts = listAdBrowserAccounts();
  const existing = accounts.find((account) => account.provider === provider && account.profile === profile);
  const now = new Date().toISOString();
  const account: AdBrowserAccount = {
    provider,
    profile,
    label: normalizeLabel(input.label) || existing?.label || defaultLabel(provider),
    accountId: normalizeAccountId(input.accountId) ?? existing?.accountId ?? null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const next = accounts.filter((item) => item.provider !== provider || item.profile !== profile);
  next.push(account);
  writeAccounts(next);
  return account;
}

export function deleteAdBrowserAccount(provider: AdBrowserProvider, profile: string): boolean {
  const normalizedProvider = assertProvider(provider);
  const normalizedProfile = assertProfile(profile);
  const accounts = listAdBrowserAccounts();
  const next = accounts.filter((account) => account.provider !== normalizedProvider || account.profile !== normalizedProfile);
  if (next.length === accounts.length) return false;
  writeAccounts(next);
  return true;
}

export function assertAdBrowserProvider(value: unknown): AdBrowserProvider {
  return assertProvider(value);
}

export function assertAdBrowserProfile(value: unknown): string {
  return assertProfile(value);
}

export function getAdBrowserAccountsPath(): string {
  return FILE_PATH;
}

function writeAccounts(accounts: AdBrowserAccount[]): void {
  ensureConfigDir();
  const payload: AdBrowserAccountFile = {
    version: 1,
    accounts: [...accounts].sort((a, b) => a.provider.localeCompare(b.provider) || a.profile.localeCompare(b.profile)),
  };
  atomicWriteFileSync(FILE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

function normalizeStoredAccount(value: unknown): AdBrowserAccount | null {
  if (!isRecord(value)) return null;
  try {
    const provider = assertProvider(value.provider);
    const profile = assertProfile(value.profile);
    const now = new Date().toISOString();
    return {
      provider,
      profile,
      label: normalizeLabel(value.label) || defaultLabel(provider),
      accountId: normalizeAccountId(value.accountId),
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
    };
  } catch {
    return null;
  }
}

function assertProvider(value: unknown): AdBrowserProvider {
  const provider = String(value || '').trim().toLowerCase() as AdBrowserProvider;
  if (!PROVIDERS.has(provider)) throw new Error(`Unsupported ad provider: ${provider || '(missing)'}`);
  return provider;
}

function assertProfile(value: unknown): string {
  const profile = String(value || '').trim();
  if (!PROFILE_RE.test(profile)) {
    throw new Error('Account name must be a short slug using letters, numbers, dashes, or underscores');
  }
  return profile;
}

function normalizeLabel(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 100) : '';
}

function normalizeAccountId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().replace(/\s+/g, '');
  return normalized ? normalized.slice(0, 100) : null;
}

function defaultLabel(provider: AdBrowserProvider): string {
  return provider === 'meta-ads' ? 'Meta Ads' : 'Google Ads';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
