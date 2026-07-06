import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionToolContext, ListAgentsResult } from '../context.ts';
import type { CreateOutputResult, CreateOutputToolInput } from './outputs.ts';
import {
  handleExecuteAppAction,
  handleGetAppActionReceipt,
  handleListAppActions,
  handlePreviewAppAction,
} from './app-actions.ts';

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'runneros-app-actions-'));
}

function cleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function makeCtx(workspacePath: string, opts?: {
  activeAgentSlug?: string;
  listAgents?: () => ListAgentsResult;
  createOutput?: (input: CreateOutputToolInput) => Promise<CreateOutputResult>;
}): SessionToolContext {
  return {
    sessionId: 'session-1',
    workspacePath,
    workspaceId: 'workspace-1',
    activeAgentSlug: opts?.activeAgentSlug,
    plansFolderPath: join(workspacePath, 'plans'),
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
    fs: {
      exists: existsSync,
      readFile: (path) => readFileSync(path, 'utf-8'),
      readFileBuffer: (path) => readFileSync(path),
      writeFile: () => {},
      isDirectory: () => false,
      readdir: () => [],
      stat: () => ({ size: 0, isDirectory: () => false }),
    },
    loadSourceConfig: () => null,
    get sourcesPath() { return join(workspacePath, 'sources'); },
    get skillsPath() { return join(workspacePath, 'skills'); },
    listAgents: opts?.listAgents,
    createOutput: opts?.createOutput,
  };
}

describe('app action handlers', () => {
  it('lists available actions and can include unavailable adapters', async () => {
    const root = makeWorkspace();
    try {
      const ctx = makeCtx(root, {
        createOutput: async () => ({ ok: true, outputId: 'out_1' }),
      });

      const available = await handleListAppActions(ctx, {});
      const unavailable = await handleListAppActions(ctx, { includeUnavailable: true });

      expect(available.isError).toBe(false);
      expect((available.structuredContent as any).actions.some((action: any) => action.id === 'outputs.create')).toBe(true);
      expect((available.structuredContent as any).actions.some((action: any) => action.id === 'calendar.create_event')).toBe(false);
      expect((unavailable.structuredContent as any).actions.some((action: any) => action.id === 'calendar.create_event')).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it('previews validation and approval-required unavailable actions without writing', async () => {
    const root = makeWorkspace();
    try {
      const ctx = makeCtx(root);

      const invalid = await handlePreviewAppAction(ctx, {
        actionId: 'outputs.create',
        input: { title: 'No kind or summary' },
        requestId: 'req-invalid',
      });
      const external = await handlePreviewAppAction(ctx, {
        actionId: 'calendar.create_event',
        input: { title: 'Call', start: {}, end: {} },
        requestId: 'req-calendar',
      });

      expect(invalid.isError).toBe(true);
      expect((invalid.structuredContent as any).errors[0].code).toBe('VALIDATION_FAILED');
      expect(external.isError).toBe(true);
      expect((external.structuredContent as any).approvalRequired).toBe(true);
      expect((external.structuredContent as any).errors[0].code).toBe('ACTION_UNAVAILABLE');
      expect(existsSync(join(root, '.runneros', 'app-actions'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it('executes outputs.create with receipt lookup and idempotent duplicate behavior', async () => {
    const root = makeWorkspace();
    try {
      let calls = 0;
      const ctx = makeCtx(root, {
        createOutput: async (input) => {
          calls += 1;
          return { ok: true, outputId: `out_${calls}`, route: `/outputs/out_${calls}`, file: input.title };
        },
      });
      const input = {
        actionId: 'outputs.create',
        input: { title: 'Research Brief', kind: 'report', summary: 'Short brief.' },
        requestId: 'req-output-1',
      };

      const first = await handleExecuteAppAction(ctx, input);
      const duplicate = await handleExecuteAppAction(ctx, input);
      const receiptId = (first.structuredContent as any).receipt.id;
      const receipt = await handleGetAppActionReceipt(ctx, { receiptId });

      expect(first.isError).toBe(false);
      expect((first.structuredContent as any).status).toBe('succeeded');
      expect((first.structuredContent as any).receipt.outputId).toBe('out_1');
      expect(duplicate.isError).toBe(false);
      expect((duplicate.structuredContent as any).status).toBe('duplicate');
      expect((duplicate.structuredContent as any).duplicateOfReceiptId).toBe(receiptId);
      expect((receipt.structuredContent as any).receipt.id).toBe(receiptId);
      expect(calls).toBe(1);
    } finally {
      cleanup(root);
    }
  });

  it('writes internal Kanban records with a receipt', async () => {
    const root = makeWorkspace();
    try {
      const ctx = makeCtx(root);
      const result = await handleExecuteAppAction(ctx, {
        actionId: 'kanban.create_card',
        input: { boardId: 'main', columnId: 'todo', title: 'Follow up' },
        requestId: 'req-kanban-1',
      });
      const cardsPath = join(root, '.runneros', 'app-actions', 'surfaces', 'kanban', 'cards.json');
      const cards = JSON.parse(readFileSync(cardsPath, 'utf-8'));

      expect(result.isError).toBe(false);
      expect((result.structuredContent as any).receipt.target.surface).toBe('kanban');
      expect(cards).toHaveLength(1);
      expect(cards[0].title).toBe('Follow up');
    } finally {
      cleanup(root);
    }
  });

  it('denies active agents outside their declared action grants', async () => {
    const root = makeWorkspace();
    try {
      const ctx = makeCtx(root, {
        activeAgentSlug: 'output-only',
        listAgents: () => ({
          total: 1,
          returned: 1,
          agents: [{
            slug: 'output-only',
            name: 'Output Only',
            description: 'Can create outputs.',
            active: true,
            skills: [],
            sources: [],
            tags: [],
            actionGrants: ['outputs.create'],
          }],
        }),
      });

      const result = await handleExecuteAppAction(ctx, {
        actionId: 'kanban.create_card',
        input: { boardId: 'main', columnId: 'todo', title: 'Not allowed' },
        requestId: 'req-denied-1',
      });

      expect(result.isError).toBe(true);
      expect((result.structuredContent as any).status).toBe('failed');
      expect((result.structuredContent as any).errors[0].message).toContain('missing action grant');
    } finally {
      cleanup(root);
    }
  });

  it('rejects unsupported Vault kind hints before adapter execution', async () => {
    const root = makeWorkspace();
    try {
      let called = false;
      const ctx = {
        ...makeCtx(root),
        addVaultFiles: async () => {
          called = true;
          return {};
        },
      } as SessionToolContext;

      const result = await handleExecuteAppAction(ctx, {
        actionId: 'vault.add_file',
        input: { paths: ['/tmp/source.png'], kindHint: 'private-secret-folder' },
        requestId: 'req-vault-invalid-kind',
      });

      expect(result.isError).toBe(true);
      expect((result.structuredContent as any).errors[0].code).toBe('VALIDATION_FAILED');
      expect(called).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});
