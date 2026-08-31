/**
 * Minimal ACP stdio JSON-RPC client.
 *
 * Spawns a remote ACP agent over stdio, exchanges line-delimited JSON-RPC
 * frames, and yields SessionUpdate events. Used by `spawn-session-tool`
 * when `acpEndpoint` is set.
 *
 * Ported in spirit from the client half of Hermes hermes_acp/ (MIT) — the
 * Hermes server-side flow used as a mirror for what a compliant client
 * has to send/receive.
 *
 * Endpoint format (Phase 1, stdio-only):
 *   stdio:./path/to/agent-binary [args...]
 *
 * See THIRD_PARTY_NOTICES.md for license attribution.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type {
  InitializeResult,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  PermissionRequest,
  PermissionResponse,
  SessionId,
  SessionUpdate,
} from './types.ts';

export interface ACPClientOptions {
  /** Permission callback. If unset, all permission requests are denied. */
  onPermission?: (req: PermissionRequest) => Promise<PermissionResponse>;
  /** Session-update observer. */
  onSessionUpdate?: (sessionId: SessionId, update: SessionUpdate) => void;
  /**
   * Logger for remote stderr lines. Each line is forwarded with an
   * `[acp-remote]` prefix; lines are capped at 4KB to prevent log spam.
   * Default: `console.error`.
   */
  onRemoteLog?: (line: string) => void;
  /**
   * Window (ms) to wait after spawn for either the first stdout frame OR a
   * process `error`/`close` event before resolving `open()`'s initialize
   * request. Prevents a missing-binary spawn from hanging the caller for
   * the full request timeout. Default 2000ms.
   */
  earlyConnectivityWindowMs?: number;
}

const REMOTE_LOG_LINE_CAP = 4096;

export class ACPClient {
  private proc?: ChildProcessWithoutNullStreams;
  private rl?: ReadlineInterface;
  private nextId = 1;
  private pending = new Map<number | string, (resp: JsonRpcResponse) => void>();
  private readonly onPermission: ACPClientOptions['onPermission'];
  private readonly onSessionUpdate: ACPClientOptions['onSessionUpdate'];
  private readonly onRemoteLog: (line: string) => void;
  private readonly earlyWindowMs: number;
  private closed = false;
  private closeError?: Error;
  private stderrTail = '';

  constructor(opts: ACPClientOptions = {}) {
    this.onPermission = opts.onPermission;
    this.onSessionUpdate = opts.onSessionUpdate;
    this.onRemoteLog = opts.onRemoteLog ?? ((line) => console.error(line));
    this.earlyWindowMs = opts.earlyConnectivityWindowMs ?? 2000;
  }

  /**
   * Open an endpoint. Currently supports `stdio:<command> [args...]`.
   */
  async open(endpoint: string): Promise<InitializeResult> {
    if (!endpoint.startsWith('stdio:')) {
      throw new Error(`Unsupported ACP endpoint scheme: ${endpoint}`);
    }
    const parts = endpoint.slice('stdio:'.length).split(/\s+/).filter(Boolean);
    if (parts.length === 0) throw new Error('Empty stdio endpoint');
    const cmd = parts[0]!;
    const args = parts.slice(1);

    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;

    // Capture remote stderr; forward to logger with cap; keep a small tail
    // buffer to include in error messages on early spawn failures.
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      // Update tail buffer (bounded).
      this.stderrTail = (this.stderrTail + text).slice(-REMOTE_LOG_LINE_CAP);
      for (const rawLine of text.split(/\r?\n/)) {
        if (!rawLine) continue;
        const capped =
          rawLine.length > REMOTE_LOG_LINE_CAP
            ? rawLine.slice(0, REMOTE_LOG_LINE_CAP) + '…[truncated]'
            : rawLine;
        try {
          this.onRemoteLog(`[acp-remote] ${capped}`);
        } catch {
          /* logger must never throw the client */
        }
      }
    });

    this.rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    this.rl.on('line', (line) => {
      this.handleLine(line.trim());
    });

    // ---- Lifecycle handlers: reject all pending waiters on error/close. ----
    // Surfaces ENOENT/EACCES (proc 'error') and unexpected exits (proc 'close')
    // to every in-flight request, so callers don't hang for the full outer
    // timeout when the spawn never produced a wire reply.
    const lifecycleError = new Promise<Error>((resolveErr) => {
      proc.once('error', (err: NodeJS.ErrnoException) => {
        const msg =
          err && err.code
            ? `ACP spawn failed (${err.code}): ${err.message}${this.stderrTail ? ` — stderr: ${this.stderrTail.trim()}` : ''}`
            : `ACP spawn failed: ${err.message}${this.stderrTail ? ` — stderr: ${this.stderrTail.trim()}` : ''}`;
        const wrapped = new Error(msg);
        this.failAll(wrapped);
        resolveErr(wrapped);
      });
      proc.once('close', (code) => {
        const msg = `ACP server closed unexpectedly (exit code ${code})${this.stderrTail ? ` — stderr: ${this.stderrTail.trim()}` : ''}`;
        const wrapped = new Error(msg);
        this.failAll(wrapped);
        resolveErr(wrapped);
      });
    });

    // Early-connectivity gate: race the initialize request against an early
    // error/close event AND a short window. Without this, a fast spawn
    // failure (ENOENT) emits `error` asynchronously and `request()` could
    // otherwise wait for the caller's outer timeout. After the window we
    // keep racing against the lifecycle error (no resolution path can hang).
    const initializePromise = this.request<InitializeResult>('initialize', {});
    // Defang unhandled-rejection warnings while we race.
    initializePromise.catch(() => {});
    lifecycleError.catch(() => {});

    const earlyWindow = new Promise<'window'>((resolve) => {
      const t = setTimeout(() => resolve('window'), this.earlyWindowMs);
      t.unref?.();
    });

    const firstOutcome = await Promise.race([
      initializePromise.then(
        (r) => ({ kind: 'ok' as const, value: r }),
        (err: unknown) => ({ kind: 'err' as const, err: err as Error }),
      ),
      lifecycleError.then((err) => ({ kind: 'err' as const, err })),
      earlyWindow.then(() => ({ kind: 'window' as const })),
    ]);

    if (firstOutcome.kind === 'err') throw firstOutcome.err;
    if (firstOutcome.kind === 'ok') return firstOutcome.value;

    // Window elapsed with no error and no response yet — keep racing the
    // initialize result against any subsequent lifecycle error so we never
    // hang waiting on a dead process.
    const finalOutcome = await Promise.race([
      initializePromise.then(
        (r) => ({ kind: 'ok' as const, value: r }),
        (err: unknown) => ({ kind: 'err' as const, err: err as Error }),
      ),
      lifecycleError.then((err) => ({ kind: 'err' as const, err })),
    ]);
    if (finalOutcome.kind === 'err') throw finalOutcome.err;
    return finalOutcome.value;
  }

  async createSession(cwd: string): Promise<SessionId> {
    const r = (await this.request<{ sessionId: SessionId }>('session/new', { cwd })) as {
      sessionId: SessionId;
    };
    return r.sessionId;
  }

  /** Send a prompt and return when the agent completes. */
  async prompt(sessionId: SessionId, text: string): Promise<{ stopReason: string }> {
    return (await this.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    })) as { stopReason: string };
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.proc) return resolve();
      const proc = this.proc;
      // If the child already exited (e.g. spawn ENOENT), `close` will not
      // fire again; resolve synchronously rather than wait forever.
      if (proc.exitCode !== null || (proc as unknown as { killed?: boolean }).killed) {
        this.rl?.close();
        return resolve();
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      proc.once('close', finish);
      // Backstop: if the spawn never produced a real OS process (e.g.
      // synchronous-error path on some platforms), `close` may not fire
      // again. Cap the wait at 500ms.
      const t = setTimeout(finish, 500);
      t.unref?.();
      this.rl?.close();
      try {
        proc.stdin.end();
      } catch {
        /* ignore */
      }
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    });
  }

  /** Reject all in-flight requests and refuse further sends. */
  private failAll(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.closeError = err;
    for (const [id, waiter] of this.pending) {
      this.pending.delete(id);
      waiter({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } } as JsonRpcResponse);
    }
  }

  private writeFrame(obj: unknown): void {
    if (this.closed) throw this.closeError ?? new Error('ACP client closed');
    if (!this.proc) throw new Error('ACP client not open');
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  private async request<T>(method: string, params: unknown): Promise<T> {
    if (this.closed) throw this.closeError ?? new Error('ACP client closed');
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const waiter = new Promise<JsonRpcResponse>((resolve) => {
      this.pending.set(id, resolve);
    });
    try {
      this.writeFrame(req);
    } catch (err) {
      this.pending.delete(id);
      throw err;
    }
    const resp = await waiter;
    if (resp.error) throw new Error(`ACP ${method}: ${resp.error.message}`);
    return resp.result as T;
  }

  private async handleLine(line: string): Promise<void> {
    if (!line) return;
    let msg: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      const resp = msg as JsonRpcResponse;
      const waiter = this.pending.get(resp.id);
      if (waiter) {
        this.pending.delete(resp.id);
        waiter(resp);
      }
      return;
    }

    if ('method' in msg) {
      if (msg.method === 'session/update' && this.onSessionUpdate) {
        const p = msg.params as { sessionId: SessionId; update: SessionUpdate };
        this.onSessionUpdate(p.sessionId, p.update);
        return;
      }
      if (msg.method === 'session/request_permission' && 'id' in msg) {
        const req = msg as JsonRpcRequest;
        const params = req.params as PermissionRequest;
        let result: PermissionResponse;
        if (this.onPermission) {
          try {
            result = await this.onPermission(params);
          } catch {
            result = { outcome: { outcome: 'cancelled' } };
          }
        } else {
          // Default policy: deny everything.
          const denyOpt = params.options.find((o) => o.optionId === 'deny');
          result = denyOpt
            ? { outcome: { outcome: 'selected', optionId: denyOpt.optionId } }
            : { outcome: { outcome: 'cancelled' } };
        }
        this.writeFrame({ jsonrpc: '2.0', id: req.id, result });
      }
    }
  }
}
