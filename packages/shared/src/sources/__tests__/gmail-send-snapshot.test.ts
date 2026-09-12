import { describe, expect, test } from 'bun:test';
import { prepareGmailDraftSend } from '../gmail-send-snapshot.ts';
import { prepareGmailApprovalPrompt } from '../../agent/core/prepare-gmail-prompt.ts';

const raw = Buffer.from('To: first@example.com\r\nSubject: Approved\r\n\r\nApproved body').toString('base64url');
const full = { id: 'draft-1', message: { id: 'message-1', payload: {
  headers: [{ name: 'To', value: 'first@example.com' }, { name: 'Subject', value: 'Approved' }],
  mimeType: 'multipart/mixed', parts: [
    { mimeType: 'text/plain', body: { data: Buffer.from('Approved body').toString('base64url') } },
    { filename: 'press.pdf', mimeType: 'application/pdf', body: { size: 123, attachmentId: 'att' } },
  ],
} } };
const original = () => ({ path: '/users/me/drafts/send', method: 'POST', params: { id: 'draft-1' }, _intent: 'Send reviewed press email' });
function reader(overrides: { full?: unknown; raw?: unknown; email?: string } = {}) {
  const calls: string[] = [];
  return { calls, read: async (path: string, params?: Record<string, unknown>) => {
    calls.push(path);
    if (path.endsWith('/profile')) return { emailAddress: overrides.email ?? 'artist@example.com' };
    if (params?.format === 'full') return structuredClone(overrides.full ?? full);
    return overrides.raw ?? { id: 'draft-1', message: { id: 'message-1', raw, threadId: 'thread-1' } };
  } };
}

describe('Gmail draft snapshot', () => {
  test('pins mailbox and exact MIME while displaying the matching full preview', async () => {
    const io = reader();
    const prepared = await prepareGmailDraftSend(original(), io.read);
    expect(prepared.input.path).toBe('/users/artist%40example.com/drafts/send');
    expect(prepared.input.params).toEqual({ id: 'draft-1', message: { raw, threadId: 'thread-1' } });
    expect(prepared.input._intent).toBe('Send reviewed press email');
    expect(prepared.description).toContain('first@example.com');
    expect(prepared.description).toContain('Approved body');
    expect(prepared.description).toContain('press.pdf');
    expect(io.calls.slice(1)).toEqual(['/users/artist%40example.com/drafts/draft-1', '/users/artist%40example.com/drafts/draft-1']);
  });
  test('input edits during reads do not retarget the snapshot', async () => {
    const input = original();
    const io = reader();
    const prepared = await prepareGmailDraftSend(input, async (path, params) => {
      input.params.id = 'other-draft';
      input._intent = 'changed';
      return io.read(path, params);
    });
    expect((prepared.input.params as any).id).toBe('draft-1');
    expect(prepared.input._intent).toBe('Send reviewed press email');
  });
  test('mismatching message versions never produce an approval', async () => {
    await expect(prepareGmailDraftSend(original(), reader({ raw: { id: 'draft-1', message: { id: 'new-version', raw } } }).read)).rejects.toThrow('changed');
  });
  test('explicit mailbox must match the connected profile', async () => {
    await expect(prepareGmailDraftSend({ ...original(), path: '/users/other%40example.com/drafts/send' }, reader().read)).rejects.toThrow('does not match');
    expect((await prepareGmailDraftSend({ ...original(), path: '/users/artist%40example.com/drafts/send' }, reader().read)).input.path)
      .toBe('/users/artist%40example.com/drafts/send');
  });
  test('caller-supplied replacement raw is preserved without reading the remote draft', async () => {
    const io = reader();
    const replacement = Buffer.from('To: requested@example.com\r\n\r\nRequested body').toString('base64url');
    const prepared = await prepareGmailDraftSend({ ...original(), params: { id: 'draft-1', message: { raw: replacement } } }, io.read);
    expect((prepared.input.params as any).message.raw).toBe(replacement);
    expect(prepared.description).toContain('Requested body');
    expect(io.calls).toHaveLength(1);
  });
  test('JSON raw request body takes precedence and becomes canonical params', async () => {
    const prepared = await prepareGmailDraftSend({ ...original(), params: {
      id: 'ignored', _contentType: 'application/json', _rawBody: JSON.stringify({ id: 'draft-1', message: { raw } }),
    } }, reader().read);
    expect(prepared.input.params).toEqual({ id: 'draft-1', message: { raw } });
  });
  test('invalid replacement or malformed raw request cannot silently send an older draft', async () => {
    for (const params of [{ id: 'draft-1', message: { raw: '' } }, { id: 'draft-1', message: { raw: 42 } }, { _rawBody: 'not JSON' }]) {
      await expect(prepareGmailDraftSend({ ...original(), params }, reader().read)).rejects.toThrow();
    }
  });
  test('missing draft never produces an approval', async () => {
    await expect(prepareGmailDraftSend(original(), reader({ full: {} }).read)).rejects.toThrow('changed');
  });
  test('existing approval receives prepared input, while non-send prompts are untouched', async () => {
    const checked = { type: 'prompt' as const, promptType: 'api_mutation' as const, description: 'original' };
    const pool = { prepareGmailDraftSend: async (_tool: string, input: Record<string, unknown>) => prepareGmailDraftSend(input, reader().read) };
    const prompt = await prepareGmailApprovalPrompt(checked, 'mcp__gmail__api_gmail', original(), pool);
    expect(prompt.modifiedInput?.path).toContain('artist%40example.com');
    expect(prompt.description).toContain('Approved body');
    expect(await prepareGmailApprovalPrompt(checked, 'api_other', original())).toBe(checked);
  });
});

test('large text bodies stored as attachments are read before approval', async () => {
  const fullBody = structuredClone(full);
  fullBody.message.payload.parts = [{ mimeType: 'text/plain', body: { attachmentId: 'body-attachment', size: 500 } }] as any;
  const io = reader({ full: fullBody });
  const prepared = await prepareGmailDraftSend(original(), async (path, params) => {
    if (path.endsWith('/attachments/body-attachment')) {
      expect(path).toBe('/users/artist%40example.com/messages/message-1/attachments/body-attachment');
      return { data: Buffer.from('Large reviewed body').toString('base64url') };
    }
    return io.read(path, params);
  });
  expect(prepared.description).toContain('Large reviewed body');
  expect((prepared.input.params as any).message.raw).toBe(raw);
});
