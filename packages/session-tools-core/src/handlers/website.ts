import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

export interface GetWebsiteManifestInput { includeHistory?: boolean }

export interface CreateWebsiteInput { artistName: string; template?: string }

export interface SetWebsiteContentInput {
  /** Structured edits against the content contract. See SiteContentOperation. */
  operations: unknown[];
}

export interface BuildWebsiteInput { audit?: boolean }

export interface DeployWebsiteInput {
  target?: 'preview' | 'production';
  summary?: string;
  why?: string[];
  changes?: string[];
}

export interface RollbackWebsiteInput { deployId?: string; reason?: string }
export interface WebsiteHistoryInput { limit?: number }
export type WebsiteStatusInput = Record<string, never>;
export interface WebsiteCaptureSyncInput { limit?: number }
export interface WebsiteDomainSetInput { domain: string }
export type WebsiteDomainCheckInput = Record<string, never>;
export interface WebsiteInspectExternalInput {
  /** Omit to re-read whatever site is already on file. */
  url?: string;
  /** Crawl again instead of answering from the stored reading. */
  refresh?: boolean;
  /** False when reading somebody else's site rather than the artist's. */
  remember?: boolean;
}
export interface PreviewWebsiteInput { build?: boolean }
export interface AuditWebsiteInput { url?: string }

export type WebsiteToolResult = { ok: boolean; error?: string; [key: string]: unknown };

async function invoke(
  callback: ((input: never) => Promise<WebsiteToolResult>) | undefined,
  input: unknown,
  unavailable: string,
): Promise<ToolResult> {
  if (!callback) return errorResponse(unavailable);
  try {
    const result = await callback(input as never);
    const body = JSON.stringify(result, null, 2);
    return result.ok ? successResponse(body) : errorResponse(body);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

const NO_WEBSITE = 'Website tools are only available in an Artist HQ workspace.';

export function handleGetWebsiteManifest(ctx: SessionToolContext, input: GetWebsiteManifestInput): Promise<ToolResult> {
  return invoke(ctx.getWebsiteManifest, input, NO_WEBSITE);
}

export function handleCreateWebsite(ctx: SessionToolContext, input: CreateWebsiteInput): Promise<ToolResult> {
  return invoke(ctx.createWebsite, input, NO_WEBSITE);
}

export function handleSetWebsiteContent(ctx: SessionToolContext, input: SetWebsiteContentInput): Promise<ToolResult> {
  return invoke(ctx.setWebsiteContent, input, NO_WEBSITE);
}

export function handleBuildWebsite(ctx: SessionToolContext, input: BuildWebsiteInput): Promise<ToolResult> {
  return invoke(ctx.buildWebsite, input, NO_WEBSITE);
}

export function handlePreviewWebsite(ctx: SessionToolContext, input: PreviewWebsiteInput): Promise<ToolResult> {
  return invoke(ctx.previewWebsite, input, NO_WEBSITE);
}

export function handleAuditWebsite(ctx: SessionToolContext, input: AuditWebsiteInput): Promise<ToolResult> {
  return invoke(ctx.auditWebsite, input, NO_WEBSITE);
}

export function handleDeployWebsite(ctx: SessionToolContext, input: DeployWebsiteInput): Promise<ToolResult> {
  return invoke(ctx.deployWebsite, input, NO_WEBSITE);
}

export function handleRollbackWebsite(ctx: SessionToolContext, input: RollbackWebsiteInput): Promise<ToolResult> {
  return invoke(ctx.rollbackWebsite, input, NO_WEBSITE);
}

export function handleWebsiteHistory(ctx: SessionToolContext, input: WebsiteHistoryInput): Promise<ToolResult> {
  return invoke(ctx.websiteHistory, input, NO_WEBSITE);
}

export function handleWebsiteStatus(ctx: SessionToolContext, input: WebsiteStatusInput): Promise<ToolResult> {
  return invoke(ctx.websiteStatus, input, NO_WEBSITE);
}

export function handleWebsiteCaptureSync(ctx: SessionToolContext, input: WebsiteCaptureSyncInput): Promise<ToolResult> {
  return invoke(ctx.websiteCaptureSync, input, NO_WEBSITE);
}

export function handleWebsiteDomainSet(ctx: SessionToolContext, input: WebsiteDomainSetInput): Promise<ToolResult> {
  return invoke(ctx.websiteDomainSet, input, NO_WEBSITE);
}

export function handleWebsiteDomainCheck(ctx: SessionToolContext, input: WebsiteDomainCheckInput): Promise<ToolResult> {
  return invoke(ctx.websiteDomainCheck, input, NO_WEBSITE);
}

export function handleWebsiteInspectExternal(ctx: SessionToolContext, input: WebsiteInspectExternalInput): Promise<ToolResult> {
  return invoke(ctx.websiteInspectExternal, input, NO_WEBSITE);
}
