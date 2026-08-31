/**
 * stdio JSON-RPC ACP server.
 *
 * Ported from Hermes hermes_acp/server.py (MIT).
 *   - HermesACPAgent.initialize      → handleInitialize
 *   - HermesACPAgent.session_new     → handleSessionNew
 *   - HermesACPAgent.session_load    → handleSessionLoad
 *   - HermesACPAgent.session_prompt  → handleSessionPrompt
 *   - HermesACPAgent.session_cancel  → handleSessionCancel
 *   - _acp_stderr_print (session.py:112-120) → acpStderrPrint
 *
 * Transport: line-delimited JSON over stdin/stdout. All logs go to stderr;
 * stdout is reserved for JSON-RPC frames.
 *
 * See THIRD_PARTY_NOTICES.md for license attribution.
 */

import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type {
  InitializeParams,
  InitializeResult,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  SessionId,
  SessionNewParams,
  SessionNewResult,
  SessionPromptParams,
  SessionPromptResult,
  SessionUpdate,
  PermissionRequest,
  PermissionResponse,
} from './types.ts';
import { SessionManager } from './session.ts';

/**
 * Write a log line to stderr. NEVER use console.log inside the server
 * — that would corrupt the JSON-RPC stream on stdout.
 */
export function acpStderrPrint(msg: string): void {
  try {
    process.stderr.write(`[acp] ${msg}\n`);
  } catch {
    /* best effort */
  }
}

export type PromptHandler = (ctx: {
  sessionId: SessionId;
  text: string;
  cwd: string;
  abort: AbortSignal;
  sendUpdate: (update: SessionUpdate) => Promise<void>;
  requestPermission: (req: PermissionRequest) => Promise<PermissionResponse | null>;
}) => Promise<SessionPromptResult>;

export interface RunnerOSACPAgentOptions {
  dbPath?: string;
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  /**
   * Handler invoked when a client sends `session/prompt`. The host wires
   * this to the RunnerOS agent runner. Default is an echo for tests.
   */
  onPrompt?: PromptHandler;
  /** Auth methods advertised in `initialize`. */
  authMethods?: InitializeResult['authMethods'];
}

const PROTOCOL_VERSION = 1;

export class RunnerOSACPAgent {
  readonly sessions: SessionManager;
  private readonly stdin: Readable;
  private readonly stdout: Writable;
  private readonly onPrompt: PromptHandler;
  private readonly authMethods: InitializeResult['authMethods'];
  private rl?: ReadlineInterface;
  private nextReqId = 1;
  private pendingPermissions = new Map<number | string, (res: PermissionResponse | null) => void>();
  private running = false;

  constructor(opts: RunnerOSACPAgentOptions = {}) {
    this.sessions = new SessionManager(opts.dbPath ?? ':memory:');
    this.stdin = opts.stdin ?? process.stdin;
    this.stdout = opts.stdout ?? process.stdout;
    this.authMethods = opts.authMethods ?? [
      { id: 'env', name: 'Environment credentials' },
    ];
    this.onPrompt = opts.onPrompt ?? defaultEchoPrompt;
  }

  /** Start reading JSON-RPC frames from stdin. Returns a promise that resolves on stdin close. */
  start(): Promise<void> {
    if (this.running) return Promise.resolve();
    this.running = true;
    return new Promise<void>((resolve) => {
      this.rl = createInterface({ input: this.stdin, crlfDelay: Infinity });
      this.rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        void this.handleLine(trimmed);
      });
      this.rl.on('close', () => {
        this.running = false;
        resolve();
      });
    });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.rl?.close();
    this.sessions.close();
  }

  private writeFrame(obj: JsonRpcResponse | JsonRpcRequest | JsonRpcNotification): void {
    try {
      this.stdout.write(JSON.stringify(obj) + '\n');
    } catch (err) {
      acpStderrPrint(`writeFrame failed: ${(err as Error).message}`);
    }
  }

  private async handleLine(line: string): Promise<void> {
    let msg: JsonRpcRequest | JsonRpcResponse;
    try {
      msg = JSON.parse(line) as JsonRpcRequest | JsonRpcResponse;
    } catch (err) {
      acpStderrPrint(`malformed JSON: ${(err as Error).message}`);
      // Per JSON-RPC 2.0 §4.2: emit a Parse Error with id:null. Keep the
      // stderr log above (drop-silent on the log channel) but make the wire
      // channel spec-compliant so peers don't hang waiting for a reply.
      this.writeFrame({
        jsonrpc: '2.0',
        id: null as unknown as number,
        error: { code: -32700, message: 'Parse error' },
      });
      return;
    }

    // Response to a permission request we initiated?
    if ('result' in msg || 'error' in msg) {
      const resp = msg as JsonRpcResponse;
      const waiter = this.pendingPermissions.get(resp.id);
      if (waiter) {
        this.pendingPermissions.delete(resp.id);
        if (resp.error) waiter(null);
        else waiter((resp.result as PermissionResponse) ?? null);
      }
      return;
    }

    const req = msg as JsonRpcRequest;
    // JSON-RPC 2.0 §4.1: a notification is a request with no `id`. Servers
    // MUST NOT reply to notifications. We still dispatch (in case the
    // method has side-effects) but never emit a response frame.
    const isNotification = req.id === undefined;
    try {
      const result = await this.dispatch(req);
      if (!isNotification) {
        this.writeFrame({ jsonrpc: '2.0', id: req.id, result });
      }
    } catch (err) {
      const e = err as Error;
      acpStderrPrint(`dispatch error ${req.method}: ${e.message}`);
      if (!isNotification) {
        this.writeFrame({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32603, message: e.message },
        });
      }
    }
  }

  private async dispatch(req: JsonRpcRequest): Promise<unknown> {
    switch (req.method) {
      case 'initialize':
        return this.handleInitialize(req.params as InitializeParams);
      case 'session/new':
        return this.handleSessionNew(req.params as SessionNewParams);
      case 'session/load':
        return this.handleSessionLoad(req.params as { sessionId: SessionId });
      case 'session/prompt':
        return this.handleSessionPrompt(req.params as SessionPromptParams);
      case 'session/cancel':
        return this.handleSessionCancel(req.params as { sessionId: SessionId });
      case 'session/fork':
        return this.handleSessionFork(req.params as { sessionId: SessionId });
      default:
        throw new Error(`Method not found: ${req.method}`);
    }
  }

  handleInitialize(_params: InitializeParams): InitializeResult {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { embeddedContext: true, image: false, audio: false },
      },
      authMethods: this.authMethods,
    };
  }

  handleSessionNew(params: SessionNewParams): SessionNewResult {
    const state = this.sessions.createSession(params.cwd ?? process.cwd());
    return { sessionId: state.id };
  }

  handleSessionLoad(params: { sessionId: SessionId }): { sessionId: SessionId } | null {
    const state = this.sessions.getSession(params.sessionId);
    if (!state) throw new Error(`Unknown session: ${params.sessionId}`);
    return { sessionId: state.id };
  }

  handleSessionFork(params: { sessionId: SessionId }): SessionNewResult {
    const forked = this.sessions.forkSession(params.sessionId);
    if (!forked) throw new Error(`Unknown session: ${params.sessionId}`);
    return { sessionId: forked.id };
  }

  handleSessionCancel(params: { sessionId: SessionId }): { ok: boolean } {
    return { ok: this.sessions.cancel(params.sessionId) };
  }

  async handleSessionPrompt(params: SessionPromptParams): Promise<SessionPromptResult> {
    const state = this.sessions.getSession(params.sessionId);
    if (!state) throw new Error(`Unknown session: ${params.sessionId}`);

    const text = (params.prompt ?? [])
      .filter((p) => p && p.type === 'text')
      .map((p) => p.text)
      .join('');

    state.abort = new AbortController();
    this.sessions.appendHistory(state.id, { role: 'user', content: text });

    const sendUpdate = async (update: SessionUpdate): Promise<void> => {
      this.writeFrame({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: state.id, update },
      });
    };

    const requestPermission = async (
      req: PermissionRequest,
    ): Promise<PermissionResponse | null> => {
      const id = this.nextReqId++;
      const waiter = new Promise<PermissionResponse | null>((resolve) => {
        this.pendingPermissions.set(id, resolve);
      });
      this.writeFrame({ jsonrpc: '2.0', id, method: 'session/request_permission', params: req });
      return waiter;
    };

    try {
      const result = await this.onPrompt({
        sessionId: state.id,
        text,
        cwd: state.cwd,
        abort: state.abort.signal,
        sendUpdate,
        requestPermission,
      });
      return result;
    } catch (err) {
      acpStderrPrint(`prompt error: ${(err as Error).message}`);
      return { stopReason: 'refusal' };
    } finally {
      this.sessions.saveSession(state);
    }
  }
}

const defaultEchoPrompt: PromptHandler = async ({ text, sendUpdate }) => {
  await sendUpdate({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: `echo: ${text}` },
  });
  return { stopReason: 'end_turn' };
};
