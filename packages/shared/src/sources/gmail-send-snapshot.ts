/** Private preparation for the existing Gmail send approval, never a model tool. */
export interface PreparedGmailSend {
  input: Record<string, unknown>;
  description: string;
}
export type GmailDraftPreparer = (input: Record<string, unknown>) => Promise<PreparedGmailSend>;
const preparers = new WeakMap<object, GmailDraftPreparer>();
export function registerGmailDraftPreparer(server: object, prepare: GmailDraftPreparer): void {
  preparers.set(server, prepare);
}
export function getGmailDraftPreparer(server: object): GmailDraftPreparer | undefined {
  return preparers.get(server);
}

export function gmailDraftSendMailbox(input: Record<string, unknown>): string | null {
  if (String(input.method).toUpperCase() !== 'POST') return null;
  let path: string;
  try { path = decodeURIComponent(new URL(String(input.path), 'https://gmail.googleapis.com/').pathname); }
  catch { return null; }
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '')
    .match(/\/users\/([^/]+)\/drafts\/send$/i)?.[1] ?? null;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

/** Freeze input before any read; full and raw must describe one immutable message. */
export async function prepareGmailDraftSend(
  original: Record<string, unknown>,
  read: (path: string, params?: Record<string, unknown>) => Promise<unknown>,
): Promise<PreparedGmailSend> {
  const input = structuredClone(original);
  const mailbox = gmailDraftSendMailbox(input);
  if (!mailbox) throw new Error('Could not identify this Gmail draft send.');
  let params = record(input.params);
  if ('_rawBody' in params) {
    if (typeof params._rawBody !== 'string') throw new Error('Gmail draft send needs a JSON request body.');
    let parsed: unknown;
    try { parsed = JSON.parse(params._rawBody); }
    catch { throw new Error('Gmail draft send needs a valid JSON request body.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Gmail draft send needs a JSON object.');
    params = record(parsed);
    if ('_rawBody' in params || '_contentType' in params) throw new Error('Gmail draft JSON contains unsupported request overrides.');
  }
  if (typeof params.id !== 'string' || !params.id.trim()) throw new Error('Gmail draft send needs its exact draft ID.');
  const requestedMessage = record(params.message);
  if ('raw' in requestedMessage && (typeof requestedMessage.raw !== 'string' || !requestedMessage.raw.trim())) {
    throw new Error('The requested Gmail replacement message is empty or invalid.');
  }
  const profile = record(await read('/users/me/profile'));
  const email = profile.emailAddress;
  if (typeof email !== 'string' || !email.includes('@')) throw new Error('Could not resolve the Gmail mailbox for this approval.');
  if (mailbox.toLowerCase() !== 'me' && mailbox.toLowerCase() !== email.toLowerCase()) {
    throw new Error('The requested Gmail mailbox does not match the connected account.');
  }
  const userPath = `/users/${encodeURIComponent(email)}`;
  let message = record(params.message);
  let preview: string;
  if (typeof message.raw === 'string' && message.raw.trim()) {
    // An explicit replacement is already the requested message; do not fetch an older draft.
    preview = Buffer.from(message.raw, 'base64url').toString('utf8');
  } else {
    const draftPath = `${userPath}/drafts/${encodeURIComponent(params.id)}`;
    const full = record(await read(draftPath, { format: 'full' }));
    const raw = record(await read(draftPath, { format: 'raw' }));
    const fullMessage = record(full.message);
    const rawMessage = record(raw.message);
    if (full.id !== params.id || raw.id !== params.id || typeof fullMessage.id !== 'string'
      || fullMessage.id !== rawMessage.id || typeof rawMessage.raw !== 'string' || !rawMessage.raw.trim()) {
      throw new Error('The Gmail draft changed while preparing its preview. Try sending again to review the current draft.');
    }
    message = { raw: rawMessage.raw, ...(rawMessage.threadId ? { threadId: rawMessage.threadId } : {}) };
    preview = await describeMessage(fullMessage, read, userPath);
  }
  return {
    input: { ...input, path: `${userPath}/drafts/send`, params: { ...params, message } },
    description: `Approve sending this exact Gmail message now\nMailbox: ${email}\n${preview}`,
  };
}

async function describeMessage(message: Record<string, any>,
  read: (path: string, params?: Record<string, unknown>) => Promise<unknown>, userPath: string,
): Promise<string> {
  const payload = record(message.payload);
  const headers = Array.isArray(payload.headers) ? payload.headers : [];
  const shownHeaders = headers.filter(header => /^(from|to|cc|bcc|subject)$/i.test(String(header?.name)))
    .map(header => `${header.name}: ${header.value}`).join('\n');
  const bodies: string[] = [];
  const attachments: string[] = [];
  async function walk(part: Record<string, any>): Promise<void> {
    if (part.filename) attachments.push(`${part.filename} (${part.mimeType || 'attachment'}, ${part.body?.size ?? '?'} bytes)`);
    else if (/^text\/(plain|html)$/i.test(part.mimeType)) {
      let data = part.body?.data;
      if (typeof data !== 'string' && typeof part.body?.attachmentId === 'string') {
        const body = record(await read(`${userPath}/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`));
        data = body.data;
        if (typeof data !== 'string') throw new Error('Could not load the Gmail message body for approval.');
      }
      if (typeof data === 'string') bodies.push(Buffer.from(data, 'base64url').toString('utf8'));
    } else if (part.body?.attachmentId) {
      attachments.push(`Unnamed attachment (${part.mimeType || 'attachment'}, ${part.body?.size ?? '?'} bytes)`);
    }
    for (const child of Array.isArray(part.parts) ? part.parts : []) await walk(record(child));
  }
  await walk(payload);
  return [shownHeaders, bodies.join('\n\n'), attachments.length ? `Attachments:\n${attachments.join('\n')}` : 'Attachments: none'].join('\n\n');
}
