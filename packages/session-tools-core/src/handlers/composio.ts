import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

export interface ComposioSearchInput { query: string; maxResults?: number; pageToken?: string }
export interface ComposioReadInput { messageId: string }
export interface ComposioEmailInput { accountId: string; accountEmail: string; to: string; subject: string; body: string; cc?: string[]; bcc?: string[] }
export interface ComposioToolResult { ok: boolean; data?: unknown; error?: string; uncertain?: boolean }

async function invoke<T>(callback: ((input: T) => Promise<unknown>) | undefined, input: T): Promise<ToolResult> {
  if (!callback) return errorResponse('Composio Gmail is available only to Artist Manager, Comms, and Outreach in Artist HQ or Campaigns.');
  try {
    const result = await callback(input);
    const body = JSON.stringify(result, null, 2);
    return result && typeof result === 'object' && 'ok' in result && result.ok === false
      ? errorResponse(body) : successResponse(body);
  } catch {
    // Provider and credential errors must never leak raw request headers into model context.
    return errorResponse('Composio Gmail could not complete this operation. Check its connection in Settings.');
  }
}
export function handleComposioStatus(ctx: SessionToolContext): Promise<ToolResult> { return invoke(ctx.composioStatus, {}); }
export function handleComposioGmailSearch(ctx: SessionToolContext, input: ComposioSearchInput): Promise<ToolResult> { return invoke(ctx.composioGmailSearch, input); }
export function handleComposioGmailRead(ctx: SessionToolContext, input: ComposioReadInput): Promise<ToolResult> { return invoke(ctx.composioGmailRead, input); }
export function handleComposioGmailDraft(ctx: SessionToolContext, input: ComposioEmailInput): Promise<ToolResult> { return invoke(ctx.composioGmailDraft, input); }
export function handleComposioGmailSend(ctx: SessionToolContext, input: ComposioEmailInput): Promise<ToolResult> { return invoke(ctx.composioGmailSend, input); }
