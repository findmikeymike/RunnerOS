import type { SessionToolContext } from '../context.ts'
import { errorResponse } from '../response.ts'
import type { ToolResult } from '../types.ts'

export interface ListXEditorialHistoryToolInput {
  limit?: number
}

export interface XEditorialHistoryToolResult {
  ok: boolean
  data?: unknown
  error?: string
}

export async function handleListXEditorialHistory(
  ctx: SessionToolContext,
  input: ListXEditorialHistoryToolInput,
): Promise<ToolResult> {
  if (!ctx.listXEditorialHistory) return errorResponse('list_x_editorial_history is not available in this workspace.')
  try {
    const result = await ctx.listXEditorialHistory({ limit: input.limit })
    return result.ok
      ? { content: [{ type: 'text', text: JSON.stringify(result.data ?? {}, null, 2) }] }
      : errorResponse(result.error ?? 'Unable to read X Editorial history.')
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error))
  }
}
