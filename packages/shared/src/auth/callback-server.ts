import { createServer as createHttpServer, type Server } from 'http';
import { randomInt } from 'crypto';
import { URL } from 'url';
import { generateCallbackPage, OAUTH_CALLBACK_PAGE_HEADERS, type AppType } from './callback-page.ts';

// Re-export for backwards compatibility
export { generateCallbackPage, type AppType } from './callback-page.ts';

const DEFAULT_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export interface CallbackPayload {
  // For now just the query params. In the future we may extend this with other request properties.
  query: Record<string, string>;
}

export interface CallbackServer {
  promise: Promise<CallbackPayload>;
  url: string;
  /** Close the callback server. Call this on component unmount to clean up. */
  close: () => void | Promise<void>;
}

export function validateOAuthCallback(
  payload: CallbackPayload,
  expectedState: string,
): { code: string } | { error: string } {
  const returnedState = payload.query.state;
  if (!returnedState || returnedState !== expectedState) {
    throw new Error('Authorization callback could not be verified. Reconnect and try again.');
  }

  if (payload.query.error) {
    if (payload.query.error === 'access_denied') return { error: 'Access was denied.' };
    return { error: 'Authorization failed. Reconnect and try again.' };
  }

  if (!payload.query.code) {
    throw new Error('The authorization provider did not return a code.');
  }
  return { code: payload.query.code };
}

/**
 * Attempt to bind an HTTP server to the given port.
 * Resolves on success, rejects on error (e.g. EADDRINUSE).
 */
function tryBind(server: Server, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

export interface CreateCallbackServerOptions {
  appType?: AppType;
  /** Deep link URL to redirect to after successful auth (e.g., craftagents://auth-complete) */
  deeplinkUrl?: string;
  /** Fixed port to bind to. If set, only that port is tried (no range scanning). */
  port?: number;
  /** URL paths to accept as callbacks. Default: ['/callback', '/oauth/callback']. */
  callbackPaths?: string[];
  /** Maximum time to wait for the browser callback. */
  timeoutMs?: number;
}

/**
 * Creates an OAuth callback server on 127.0.0.1. Unless a provider requires a
 * fixed port, the OS assigns a random available port atomically.
 */
export async function createCallbackServer(options?: CreateCallbackServerOptions): Promise<CallbackServer> {
  const appType = options?.appType ?? 'terminal';
  const deeplinkUrl = options?.deeplinkUrl;
  const allowedPaths = new Set(options?.callbackPaths ?? ['/callback', '/oauth/callback']);

  let server: Server | null = null;
  let boundPort: number | null = null;
  let resolveCallback: ((payload: CallbackPayload) => void) | null = null;
  let rejectCallback: ((error: Error) => void) | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const callbackPromise = new Promise<CallbackPayload>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  // Build the request handler. It closes over `boundPort` which is set before
  // any requests can arrive (the browser isn't opened until after we return).
  const requestHandler = async (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    try {
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' });
        res.end('Method not allowed');
        return;
      }

      const url = new URL(req.url || '/', `http://127.0.0.1:${boundPort}`);

      if (!allowedPaths.has(url.pathname)) {
        res.writeHead(404, OAUTH_CALLBACK_PAGE_HEADERS);
        res.end('Not found');
        return;
      }

      const query: Record<string, string> = {};
      url.searchParams.forEach((value, key) => {
        query[key] = value;
      });

      const payload: CallbackPayload = {
        query,
      };

      // Check if this looks like a successful auth callback
      const hasCode = !!query.code;
      const hasError = !!query.error;

      // Send a styled success/error page
      const html = generateCallbackPage({
        title: hasError ? 'Authorization Failed' : 'Authorization Complete',
        isSuccess: hasCode && !hasError,
        errorDetail: hasError
          ? query.error === 'access_denied' ? 'Google access was denied.' : 'Authorization failed. Return to the app and try again.'
          : undefined,
        appType,
        deeplinkUrl: (hasCode && !hasError) ? deeplinkUrl : undefined,
      });

      res.writeHead(200, OAUTH_CALLBACK_PAGE_HEADERS);
      res.end(html);

      if (server) {
        server.close();
        server = null;
      }

      if (resolveCallback) {
        if (timeout) clearTimeout(timeout);
        resolveCallback(payload);
        resolveCallback = null;
        rejectCallback = null;
      }
    } catch (error) {
      const html = generateCallbackPage({
        title: 'Error',
        isSuccess: false,
        errorDetail: error instanceof Error ? error.message : 'Internal Server Error',
        appType,
      });

      res.writeHead(500, OAUTH_CALLBACK_PAGE_HEADERS);
      res.end(html);

      if (rejectCallback) {
        if (timeout) clearTimeout(timeout);
        rejectCallback(error instanceof Error ? error : new Error(String(error)));
        resolveCallback = null;
        rejectCallback = null;
      }
    } finally {
      if (server) {
        server.close();
        server = null;
      }
    }
  };

  const candidatePorts = options?.port !== undefined
    ? [options.port]
    : process.versions.bun
      ? Array.from({ length: 12 }, () => randomInt(49_152, 65_536))
      : [0];

  let bindError: Error | null = null;
  for (const candidatePort of candidatePorts) {
    const candidate = createHttpServer(requestHandler);
    try {
      await tryBind(candidate, candidatePort);
      server = candidate;
      break;
    } catch (err) {
      candidate.close();
      bindError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (!server) {
    throw bindError ?? new Error('Failed to start OAuth callback server');
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('OAuth callback server did not expose a local port');
  }
  boundPort = address.port;
  server.on('error', (err) => {
    rejectCallback?.(err instanceof Error ? err : new Error(String(err)));
  });

  timeout = setTimeout(() => {
    server?.close();
    server = null;
    rejectCallback?.(new Error('Authorization timed out. Reconnect and try again.'));
    resolveCallback = null;
    rejectCallback = null;
  }, options?.timeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS);
  timeout.unref?.();

  const callbackUrl = `http://127.0.0.1:${boundPort}`;

  return {
    promise: callbackPromise,
    url: callbackUrl,
    close: () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (server) {
        server.close();
        server = null;
      }
    },
  };
}
