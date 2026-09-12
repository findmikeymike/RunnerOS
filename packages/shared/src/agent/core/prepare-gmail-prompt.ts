import { gmailDraftSendMailbox, type PreparedGmailSend } from '../../sources/gmail-send-snapshot.ts';
import type { PreToolUseCheckResult } from './pre-tool-use.ts';

type ApprovalPrompt = Extract<PreToolUseCheckResult, { type: 'prompt' }>;
export async function prepareGmailApprovalPrompt(
  checked: ApprovalPrompt,
  toolName: string,
  original: Record<string, unknown>,
  pool?: { prepareGmailDraftSend(toolName: string, input: Record<string, unknown>): Promise<PreparedGmailSend> },
): Promise<ApprovalPrompt> {
  const input = { ...(checked.modifiedInput ?? original),
    ...(typeof original._intent === 'string' ? { _intent: original._intent } : {}),
  };
  if (!toolName.toLowerCase().includes('api_gmail') || !gmailDraftSendMailbox(input)) return checked;
  if (!pool) throw new Error('The Gmail source is unavailable for draft preparation.');
  const prepared = await pool.prepareGmailDraftSend(toolName, structuredClone(input));
  return { ...checked, description: prepared.description, modifiedInput: prepared.input,
    command: `POST ${String(prepared.input.path)}` };
}
