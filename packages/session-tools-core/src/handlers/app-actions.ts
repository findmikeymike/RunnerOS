import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import {
  executeAppAction,
  getAppActionReceipt,
  listAppActions,
  previewAppAction,
  type AppActionCallInput,
  type AppActionGetReceiptInput,
  type AppActionListInput,
  type AppActionPreviewInput,
} from '../app-actions/index.ts';

export type ListAppActionsToolInput = AppActionListInput;
export type PreviewAppActionToolInput = AppActionPreviewInput;
export type ExecuteAppActionToolInput = AppActionCallInput;
export type GetAppActionReceiptToolInput = AppActionGetReceiptInput;

function toStructuredContent(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
}

function jsonToolResult(text: string, structuredContent: unknown, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: toStructuredContent(structuredContent),
    isError,
  };
}

export async function handleListAppActions(
  ctx: SessionToolContext,
  args: ListAppActionsToolInput,
): Promise<ToolResult> {
  const result = listAppActions(ctx, args);
  return jsonToolResult(JSON.stringify(result, null, 2), result, false);
}

export async function handlePreviewAppAction(
  ctx: SessionToolContext,
  args: PreviewAppActionToolInput,
): Promise<ToolResult> {
  const result = await previewAppAction(ctx, args);
  return jsonToolResult(JSON.stringify(result, null, 2), result, !result.ok);
}

export async function handleExecuteAppAction(
  ctx: SessionToolContext,
  args: ExecuteAppActionToolInput,
): Promise<ToolResult> {
  const result = await executeAppAction(ctx, args);
  return jsonToolResult(JSON.stringify(result, null, 2), result, result.status === 'failed');
}

export async function handleGetAppActionReceipt(
  ctx: SessionToolContext,
  args: GetAppActionReceiptToolInput,
): Promise<ToolResult> {
  const receipt = getAppActionReceipt(ctx, args);
  const result = { receipt };
  return jsonToolResult(JSON.stringify(result, null, 2), result, !receipt);
}
