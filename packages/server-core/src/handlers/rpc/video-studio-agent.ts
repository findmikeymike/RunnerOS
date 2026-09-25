import { dirname } from 'node:path';
import { getSessionDraft, setSessionDraft } from '@craft-agent/shared/config';
import type { ISessionManager } from '../session-manager-interface';
import { humanSendMessageOptions } from './session-send-options';

interface DraftStore {
  get: typeof getSessionDraft;
  set: typeof setSessionDraft;
}

/** Resolve the saved persona and acknowledge persistence, not model completion. */
export async function launchVideoStudioAgent(
  manager: Pick<ISessionManager, 'resolveAgentSessionOptions' | 'createSession' | 'sendMessage'>,
  input: { workspaceId: string; outputId: string; projectPath: string; prompt: string },
  drafts: DraftStore = { get: getSessionDraft, set: setSessionDraft },
  ackTimeoutMs = 15_000,
) {
  const options = await manager.resolveAgentSessionOptions(input.workspaceId, 'video-editor-agent', {
    referenceMode: 'strict', taskModeSelectionSource: 'handoff',
  });
  const session = await manager.createSession(input.workspaceId, {
    ...options, name: 'Video Studio', workingDirectory: dirname(input.projectPath),
  });
  const message = [
    'Continue editing this existing Video Studio project. Preserve its source media.',
    `Project path: ${JSON.stringify(input.projectPath)}`,
    `Workspace: ${JSON.stringify(input.workspaceId)}; existing Output ID: ${JSON.stringify(input.outputId)}.`,
    'Inspect the current timeline and media before editing. Keep this existing project as the source of truth.',
    'Use structured video tools for project changes. If a save conflicts, reread the project and reconcile; never bypass its lock or conflict checks with direct filesystem writes.',
    `Return route: video-studio/${input.outputId}`,
    'Return the user to this same Output in Video Studio after editing. Report actual changes and export status; do not claim a render unless verified.',
    '', 'User request:', input.prompt.trim(),
  ].join('\n');
  try { drafts.set(session.id, { text: message }); }
  catch {
    return { ok: true as const, outputId: input.outputId, sessionId: session.id, status: 'draft' as const,
      draftInput: message, message: 'Session created, but the draft could not be saved to disk. The request was not sent; keep this text and retry from the session.' };
  }
  return new Promise<{ ok: true; outputId: string; sessionId: string; status: 'started' | 'draft' | 'pending'; message: string; draftInput?: string }>((resolve) => {
    let acknowledged = false;
    let settled = false;
    const finish = (status: 'started' | 'draft' | 'pending', explanation: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: true, outputId: input.outputId, sessionId: session.id, status, message: explanation,
        ...(status === 'draft' ? { draftInput: message } : {}) });
    };
    const timer = setTimeout(() => finish('pending', 'Session created; message acceptance is still pending. Check the session before sending again.'), ackTimeoutMs);
    const onAck = () => {
      acknowledged = true;
      // A late ACK must never erase text the user has since edited.
      try {
        const draft = drafts.get(session.id);
        if (draft?.text === message && !draft.attachments?.length) drafts.set(session.id, { text: '' });
      } catch { /* Message is already persisted; stale draft cleanup must not undo acceptance. */ }
      finish('started', 'Request accepted in the Video Editor Agent session.');
    };
    Promise.resolve().then(() => manager.sendMessage(session.id, message, undefined, undefined,
      humanSendMessageOptions(), undefined, undefined, onAck))
      .then(() => { if (!acknowledged) finish('draft', 'The message was not accepted. Your request is saved as a session draft.'); })
      .catch((error) => {
        if (!acknowledged) finish('draft', `Could not send the request: ${error instanceof Error ? error.message : String(error)}. Your request is saved as a session draft.`);
      });
  });
}
