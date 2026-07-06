import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionToolContext, ListAgentsResult, ListSourcesResult } from '../context.ts';
import type { CreateOutputResult, CreateOutputToolInput } from './outputs.ts';
import type { AppActionDefinition } from '../app-actions/types.ts';
import { APP_ACTION_DEFINITIONS, APP_ACTION_REGISTRY } from '../app-actions/registry.ts';
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
  parentAgentSlug?: string;
  listAgents?: () => ListAgentsResult;
  listSources?: () => ListSourcesResult;
  createOutput?: (input: CreateOutputToolInput) => Promise<CreateOutputResult>;
  permissionMode?: 'safe' | 'ask' | 'allow-all' | null;
  verifyAppActionApproval?: SessionToolContext['verifyAppActionApproval'];
}): SessionToolContext {
  const ctx: SessionToolContext = {
    sessionId: 'session-1',
    workspacePath,
    workspaceId: 'workspace-1',
    activeAgentSlug: opts?.activeAgentSlug,
    parentAgentSlug: opts?.parentAgentSlug,
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
    listSources: opts?.listSources,
    createOutput: opts?.createOutput,
    verifyAppActionApproval: opts?.verifyAppActionApproval,
  };
  if (opts?.permissionMode !== null) {
    ctx.getSessionInfo = () => ({
      id: 'session-1',
      name: 'Session',
      labels: [],
      status: 'todo',
      permissionMode: opts?.permissionMode ?? 'ask',
      createdAt: 0,
      isActive: true,
    });
  }
  return ctx;
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

  it('dedupes return-prior actions by natural key across request IDs', async () => {
    const root = makeWorkspace();
    try {
      let calls = 0;
      const ctx = makeCtx(root, {
        createOutput: async () => {
          calls += 1;
          return { ok: true, outputId: `out_natural_${calls}` };
        },
      });

      const first = await handleExecuteAppAction(ctx, {
        actionId: 'outputs.create',
        input: { title: 'Same Brief', kind: 'report', summary: 'First summary.' },
        requestId: 'req-natural-1',
      });
      const second = await handleExecuteAppAction(ctx, {
        actionId: 'outputs.create',
        input: { title: 'Same Brief', kind: 'report', summary: 'Different summary.' },
        requestId: 'req-natural-2',
      });

      expect((first.structuredContent as any).status).toBe('succeeded');
      expect((second.structuredContent as any).status).toBe('duplicate');
      expect((second.structuredContent as any).duplicateOfReceiptId).toBe((first.structuredContent as any).receipt.id);
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

  it('serializes concurrent internal surface writes', async () => {
    const root = makeWorkspace();
    try {
      const ctx = makeCtx(root);
      await Promise.all(Array.from({ length: 12 }, (_, index) => handleExecuteAppAction(ctx, {
        actionId: 'kanban.create_card',
        input: { boardId: 'main', columnId: 'todo', title: `Concurrent ${index}` },
        requestId: `req-kanban-concurrent-${index}`,
      })));
      const cardsPath = join(root, '.runneros', 'app-actions', 'surfaces', 'kanban', 'cards.json');
      const cards = JSON.parse(readFileSync(cardsPath, 'utf-8'));

      expect(cards).toHaveLength(12);
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

  it('fails closed when active agent grants are invalid', async () => {
    const root = makeWorkspace();
    try {
      const ctx = makeCtx(root, {
        activeAgentSlug: 'bad-grants',
        listAgents: () => ({
          total: 1,
          returned: 1,
          agents: [{
            slug: 'bad-grants',
            name: 'Bad Grants',
            description: 'Has malformed grants.',
            active: true,
            skills: [],
            sources: [],
            tags: [],
            actionGrants: ['not.a.real.grant'],
          }],
        }),
      });

      const result = await handleExecuteAppAction(ctx, {
        actionId: 'kanban.create_card',
        input: { boardId: 'main', columnId: 'todo', title: 'Should not write' },
        requestId: 'req-invalid-grants',
      });

      expect(result.isError).toBe(true);
      expect((result.structuredContent as any).errors[0].message).toContain('invalid action grants');
      expect(existsSync(join(root, '.runneros', 'app-actions', 'surfaces', 'kanban', 'cards.json'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it('requires parent agent grants for delegated app actions', async () => {
    const root = makeWorkspace();
    try {
      const listAgents = (parentGrants: string[]) => () => ({
        total: 2,
        returned: 2,
        agents: [
          {
            slug: 'child-worker',
            name: 'Child Worker',
            description: 'Can create kanban cards.',
            active: true,
            skills: [],
            sources: [],
            tags: [],
            actionGrants: ['kanban.create_card'],
          },
          {
            slug: 'parent-agent',
            name: 'Parent Agent',
            description: 'Delegating agent.',
            active: true,
            skills: [],
            sources: [],
            tags: [],
            actionGrants: parentGrants,
          },
        ],
      });

      const denied = await handleExecuteAppAction(makeCtx(root, {
        activeAgentSlug: 'child-worker',
        parentAgentSlug: 'parent-agent',
        listAgents: listAgents(['outputs.create']),
      }), {
        actionId: 'kanban.create_card',
        input: { boardId: 'main', columnId: 'todo', title: 'Blocked by parent' },
        requestId: 'req-parent-denied',
      });
      const allowed = await handleExecuteAppAction(makeCtx(root, {
        activeAgentSlug: 'child-worker',
        parentAgentSlug: 'parent-agent',
        listAgents: listAgents(['kanban.create_card']),
      }), {
        actionId: 'kanban.create_card',
        input: { boardId: 'main', columnId: 'todo', title: 'Allowed by parent' },
        requestId: 'req-parent-allowed',
      });

      expect(denied.isError).toBe(true);
      expect((denied.structuredContent as any).errors[0].message).toContain('Parent agent');
      expect(allowed.isError).toBe(false);
      expect((allowed.structuredContent as any).receipt.actor.parentAgentSlug).toBe('parent-agent');
    } finally {
      cleanup(root);
    }
  });

  it('does not poison idempotency when a transient unavailable failure is retried', async () => {
    const root = makeWorkspace();
    try {
      let calls = 0;
      const input = {
        actionId: 'outputs.create',
        input: { title: 'Retry Brief', kind: 'report', summary: 'Retry after adapter appears.' },
        requestId: 'req-retry-after-failure',
      };

      const first = await handleExecuteAppAction(makeCtx(root), input);
      const second = await handleExecuteAppAction(makeCtx(root, {
        createOutput: async () => {
          calls += 1;
          return { ok: true, outputId: 'out_retry' };
        },
      }), input);

      expect(first.isError).toBe(true);
      expect((first.structuredContent as any).errors[0].code).toBe('ACTION_UNAVAILABLE');
      expect(second.isError).toBe(false);
      expect((second.structuredContent as any).status).toBe('succeeded');
      expect(calls).toBe(1);
    } finally {
      cleanup(root);
    }
  });

  it('requires a bound permission mode before internal writes execute', async () => {
    const root = makeWorkspace();
    try {
      let calls = 0;
      const result = await handleExecuteAppAction(makeCtx(root, {
        permissionMode: null,
        createOutput: async () => {
          calls += 1;
          return { ok: true, outputId: 'out_missing_permission' };
        },
      }), {
        actionId: 'outputs.create',
        input: { title: 'No Permission Mode', kind: 'report', summary: 'Should fail closed.' },
        requestId: 'req-no-permission-mode',
      });

      expect(result.isError).toBe(true);
      expect((result.structuredContent as any).errors[0].message).toContain('Permission mode');
      expect(calls).toBe(0);
    } finally {
      cleanup(root);
    }
  });

  it('requires server-side approval verification before executing approval-required actions', async () => {
    const root = makeWorkspace();
    let executed = 0;
    const action: AppActionDefinition<Record<string, unknown>, Record<string, unknown>> = {
      id: 'test.external_echo',
      version: 1,
      title: 'External Echo',
      description: 'Test approval-required external action.',
      surface: 'publishing',
      kind: 'external_send',
      risk: 'external_write',
      inputSchema: { type: 'object' },
      idempotency: { required: true, keyFields: ['title'], duplicateWindowSeconds: 60, duplicateBehavior: 'return_prior' },
      approvalPolicy: { mode: 'always', reason: 'External test action.', summaryFields: ['title'], snapshotFields: ['title'] },
      capability: { defaultGrant: 'none', requiredActionGrants: ['test.external_echo'], allowedBackground: false },
      audit: { redactInputFields: [], redactOutputFields: [], piiFields: [] },
      uiEvents: [{ type: 'publishing:updated' }],
      validate: (input) => ({ ok: true, input: input as Record<string, unknown> }),
      availability: () => ({ available: true }),
      execute: async (_ctx, input) => {
        executed += 1;
        return { output: input };
      },
    };
    APP_ACTION_DEFINITIONS.push(action);
    APP_ACTION_REGISTRY.set(action.id, action);
    try {
      const input = {
        actionId: action.id,
        input: { title: 'External send' },
        requestId: 'req-approval-verifier',
      };
      const pending = await handleExecuteAppAction(makeCtx(root), input);
      const token = (pending.structuredContent as any).approval.approvalId;
      const noVerifier = await handleExecuteAppAction(makeCtx(root), { ...input, approvalToken: token });
      const rejected = await handleExecuteAppAction(makeCtx(root, {
        verifyAppActionApproval: () => ({ approved: false, reason: 'User has not approved.' }),
      }), { ...input, approvalToken: token });
      const approved = await handleExecuteAppAction(makeCtx(root, {
        verifyAppActionApproval: () => ({ approved: true }),
      }), { ...input, approvalToken: token });

      expect((pending.structuredContent as any).status).toBe('approval_required');
      expect(noVerifier.isError).toBe(true);
      expect((noVerifier.structuredContent as any).errors[0].message).toContain('Approval verification');
      expect(rejected.isError).toBe(true);
      expect((rejected.structuredContent as any).errors[0].message).toContain('User has not approved');
      expect(approved.isError).toBe(false);
      expect((approved.structuredContent as any).status).toBe('succeeded');
      expect(executed).toBe(1);
    } finally {
      APP_ACTION_REGISTRY.delete(action.id);
      APP_ACTION_DEFINITIONS.splice(APP_ACTION_DEFINITIONS.findIndex((entry) => entry.id === action.id), 1);
      cleanup(root);
    }
  });

  it('updates existing Network people instead of appending duplicates', async () => {
    const root = makeWorkspace();
    try {
      const ctx = makeCtx(root);
      const first = await handleExecuteAppAction(ctx, {
        actionId: 'network.upsert_person',
        input: { name: 'Riley Park', email: 'riley@example.com', role: 'manager' },
        requestId: 'req-network-1',
      });
      const second = await handleExecuteAppAction(ctx, {
        actionId: 'network.upsert_person',
        input: { name: 'Riley Park', email: 'RILEY@example.com', role: 'booking' },
        requestId: 'req-network-2',
      });
      const peoplePath = join(root, '.runneros', 'app-actions', 'surfaces', 'network', 'people.json');
      const people = JSON.parse(readFileSync(peoplePath, 'utf-8'));

      expect(first.isError).toBe(false);
      expect(second.isError).toBe(false);
      expect(people).toHaveLength(1);
      expect(people[0].role).toBe('booking');
      expect(people[0].id).toBe((first.structuredContent as any).receipt.target.entityId);
      expect((second.structuredContent as any).receipt.target.entityId).toBe(people[0].id);
    } finally {
      cleanup(root);
    }
  });

  it('redacts PII fields from contact receipts', async () => {
    const root = makeWorkspace();
    try {
      const result = await handleExecuteAppAction(makeCtx(root), {
        actionId: 'network.upsert_person',
        input: {
          name: 'Riley Park',
          email: 'riley@example.com',
          socialHandle: '@riley',
          notes: 'Personal phone is private.',
        },
        requestId: 'req-network-redaction',
      });
      const receipt = (result.structuredContent as any).receipt;

      expect(result.isError).toBe(false);
      expect(receipt.redactedInput.email).toBe('[redacted]');
      expect(receipt.redactedInput.socialHandle).toBe('[redacted]');
      expect(receipt.redactedInput.notes).toBe('[redacted]');
      expect(receipt.redactedOutput.email).toBe('[redacted]');
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

  it('redacts vault paths from receipts', async () => {
    const root = makeWorkspace();
    try {
      const ctx = {
        ...makeCtx(root),
        addVaultFiles: async () => ({
          imported: [{ id: 'asset-1', relativePath: '/Users/michael/private/source.wav' }],
        }),
      } as SessionToolContext;

      const result = await handleExecuteAppAction(ctx, {
        actionId: 'vault.add_file',
        input: { paths: ['/Users/michael/private/source.wav'], kindHint: 'demo' },
        requestId: 'req-vault-redaction',
      });
      const receipt = (result.structuredContent as any).receipt;

      expect(result.isError).toBe(false);
      expect(receipt.redactedInput.paths).toBe('[redacted]');
      expect(receipt.redactedOutput.imported[0].relativePath).toBe('[redacted]');
    } finally {
      cleanup(root);
    }
  });

  it('honors required source availability metadata before execution', async () => {
    const root = makeWorkspace();
    let executed = 0;
    const action: AppActionDefinition<Record<string, unknown>, Record<string, unknown>> = {
      id: 'test.source_bound',
      version: 1,
      title: 'Source Bound',
      description: 'Test source-gated action.',
      surface: 'publishing',
      kind: 'create',
      risk: 'internal_write',
      inputSchema: { type: 'object' },
      idempotency: { required: true, keyFields: ['title'], duplicateWindowSeconds: 60, duplicateBehavior: 'return_prior' },
      approvalPolicy: { mode: 'never', summaryFields: ['title'], snapshotFields: ['title'] },
      capability: { defaultGrant: 'all', requiredActionGrants: ['test.source_bound'], requiredSourceSlugs: ['google-calendar'], allowedBackground: true },
      audit: { redactInputFields: [], redactOutputFields: [], piiFields: [] },
      uiEvents: [{ type: 'publishing:updated' }],
      validate: (input) => ({ ok: true, input: input as Record<string, unknown> }),
      execute: async (_ctx, input) => {
        executed += 1;
        return { output: input };
      },
    };
    APP_ACTION_DEFINITIONS.push(action);
    APP_ACTION_REGISTRY.set(action.id, action);
    try {
      const missing = await handleExecuteAppAction(makeCtx(root, {
        listSources: () => ({ total: 0, returned: 0, sources: [] }),
      }), {
        actionId: action.id,
        input: { title: 'Needs source' },
        requestId: 'req-source-missing',
      });
      const connected = await handleExecuteAppAction(makeCtx(root, {
        listSources: () => ({
          total: 1,
          returned: 1,
          sources: [{
            slug: 'google-calendar',
            name: 'Google Calendar',
            description: '',
            tags: [],
            type: 'api',
            tier: 'workspace',
            enabled: true,
            authStatus: 'connected',
          }],
        }),
      }), {
        actionId: action.id,
        input: { title: 'Needs source' },
        requestId: 'req-source-connected',
      });

      expect(missing.isError).toBe(true);
      expect((missing.structuredContent as any).errors[0].message).toContain('Required source');
      expect(connected.isError).toBe(false);
      expect(executed).toBe(1);
    } finally {
      APP_ACTION_REGISTRY.delete(action.id);
      APP_ACTION_DEFINITIONS.splice(APP_ACTION_DEFINITIONS.findIndex((entry) => entry.id === action.id), 1);
      cleanup(root);
    }
  });
});
