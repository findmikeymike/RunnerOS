import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFileSync } from '../utils/files.ts';
import { BRANDING_FIELDS, type BrandingState } from './branding-state.ts';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown, max = 20000): v is string => typeof v === 'string' && v.length <= max;
const date = (v: unknown) => string(v, 100) && Number.isFinite(Date.parse(v));
const attachment = (v: unknown): boolean => record(v) && string(v.id, 200) && !!v.id && string(v.title, 200) && string(v.body, 11000) && date(v.createdAt) && (v.sourceOutputId === undefined || string(v.sourceOutputId, 200));
export function isBrandingState(value: unknown): value is BrandingState {
  if (!record(value) || !string(value.revision, 200) || !Array.isArray(value.proposals) || !Array.isArray(value.attachments) || !Array.isArray(value.history)) return false;
  if (!value.attachments.every(attachment) || new Set(value.attachments.map(a => a.id)).size !== value.attachments.length) return false;
  if (!value.proposals.every(p => record(p) && string(p.id, 200) && string(p.title, 200) && date(p.createdAt) && ['pending', 'applied', 'dismissed'].includes(p.status as string) && Array.isArray(p.patches) && p.patches.length <= 8 && p.patches.every(c => record(c) && BRANDING_FIELDS.includes(c.field as never) && string(c.before) && string(c.after)) && new Set(p.patches.map(c => c.field)).size === p.patches.length && Array.isArray(p.additions) && p.additions.length <= 5 && p.additions.every(attachment) && (p.sourceSessionId === undefined || string(p.sourceSessionId, 200)))) return false;
  if (new Set(value.proposals.map(p => p.id)).size !== value.proposals.length) return false;
  return value.history.every(h => record(h) && string(h.id, 200) && date(h.createdAt) && ['applied', 'dismissed', 'attachment-added', 'attachment-removed'].includes(h.action as string) && (h.attachment === undefined || attachment(h.attachment)) && (h.proposalId === undefined || string(h.proposalId, 200)) && (h.previousBody === undefined || h.previousBody === null || string(h.previousBody, 1000000)));
}
export function readBrandingState(rootPath: string): BrandingState {
  const path = join(rootPath, 'branding', 'state.json');
  if (!existsSync(path)) return { revision: '0', proposals: [], attachments: [], history: [] };
  const state: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isBrandingState(state)) throw new Error('Branding state is damaged; existing data was preserved.');
  return state;
}
export function writeBrandingState(rootPath: string, state: BrandingState): void {
  if (!isBrandingState(state)) throw new Error('Invalid Branding state; existing data was preserved.');
  mkdirSync(join(rootPath, 'branding'), { recursive: true });
  atomicWriteFileSync(join(rootPath, 'branding', 'state.json'), JSON.stringify(state, null, 2) + '\n');
}
