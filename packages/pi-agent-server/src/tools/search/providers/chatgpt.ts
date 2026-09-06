/**
 * ChatGPT backend search provider — for ChatGPT Plus / OpenAI OAuth users.
 *
 * Uses the same Responses API format as the public OpenAI API, but hits the
 * ChatGPT backend endpoint which accepts OAuth access tokens instead of API keys.
 *
 * Auth flow mirrors the Pi SDK's `openai-codex-responses.js`:
 *   - Bearer token: the OAuth access token
 *   - chatgpt-account-id: extracted from the JWT's claims
 */

import type { WebSearchProvider, WebSearchResult } from '../types.ts';
import { parseResponsesApiResults, type ResponsesApiResponse } from './responses-api-parser.ts';
import { PI_PREFERRED_DEFAULTS } from '../../../../../shared/src/config/llm-connections.ts';

/**
 * Codex backend request contract (search path):
 * - model: the first Codex preference (see below), not a literal
 * - store: false
 * - stream: true (backend may return JSON or SSE)
 * - instructions + tool_choice + text.verbosity
 * - OpenAI-Beta: responses=experimental header
 *
 * If this payload changes, update:
 *   - ./chatgpt.test.ts
 *   - ../SEARCH_PAYLOAD_CONTRACT.md
 */

/**
 * Search model, derived rather than pinned.
 *
 * This was the literal 'gpt-5.5', and nothing passes a model in — the provider
 * is constructed with a token and an account id only — so every search request
 * used that one id unconditionally. When a pinned id is retired, search does not
 * degrade, it stops: the account returns a 400 and there is no second attempt.
 * Upstream hit exactly that (craft-agents-oss#1023).
 *
 * Taking the head of the Codex preference list means this tracks the same
 * catalog the rest of the app offers and cannot drift into a stale literal.
 * Upstream's full fix also retries down a bounded candidate chain on rejection;
 * that part is not ported, because our provider has diverged from theirs and the
 * failover path cannot be verified without a live ChatGPT-plan account.
 */
const CODEX_SEARCH_MODELS: readonly string[] = PI_PREFERRED_DEFAULTS['openai-codex'] ?? [];
const DEFAULT_SEARCH_MODEL = CODEX_SEARCH_MODELS[0] ?? 'gpt-5.6-sol';
const API_BASE = 'https://chatgpt.com/backend-api/codex';
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';
const ERROR_TEXT_LIMIT = 600;
const SEARCH_INSTRUCTIONS = 'You are a web search assistant. Return concise, factual search results with source citations when available.';
const SEARCH_TEXT_VERBOSITY = 'medium';

const SEARCH_TOOL_TYPE = 'web_search';

/**
 * Extract the `chatgpt_account_id` from a ChatGPT OAuth access token (JWT).
 * Returns null if the token is malformed or the claim is missing.
 */
export function extractChatGptAccountId(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(atob(parts[1]!));
    const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;

    return typeof accountId === 'string' && accountId.length > 0 ? accountId : null;
  } catch {
    return null;
  }
}

export class ChatGPTBackendSearchProvider implements WebSearchProvider {
  name = 'ChatGPT';

  constructor(
    private accessToken: string,
    private accountId: string,
    private options?: { model?: string },
  ) {}

  async search(query: string, count: number): Promise<WebSearchResult[]> {
    const requestBody = {
      model: this.options?.model || DEFAULT_SEARCH_MODEL,
      store: false,
      stream: true,
      instructions: SEARCH_INSTRUCTIONS,
      tools: [{ type: SEARCH_TOOL_TYPE }],
      tool_choice: 'auto',
      parallel_tool_calls: true,
      text: { verbosity: SEARCH_TEXT_VERBOSITY },
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Search the web for: ${query}\n\nReturn the top ${count} results with title, URL, and a brief description.`,
            },
          ],
        },
      ],
    };

    const requestFingerprint = buildRequestFingerprint(requestBody);

    const response = await fetch(`${API_BASE}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        'chatgpt-account-id': this.accountId,
        'OpenAI-Beta': 'responses=experimental',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30_000),
    });

    const contentType = response.headers.get('content-type') || 'unknown';

    if (response.ok) {
      try {
        const data = await parseResponsePayload(response);
        return parseResponsesApiResults(data, query, count);
      } catch (parseError) {
        const parseMessage = parseError instanceof Error ? parseError.message : String(parseError);
        throw new Error(
          `ChatGPT search failed: ${SEARCH_TOOL_TYPE} parse failed [${requestFingerprint}, content-type=${contentType}]: ${compactErrorText(parseMessage)}`,
        );
      }
    }

    const errorText = await response.text();
    const compactError = compactErrorText(errorText);
    throw new Error(
      `ChatGPT search failed: ${SEARCH_TOOL_TYPE} failed (HTTP ${response.status}) [${requestFingerprint}, content-type=${contentType}]: ${compactError}`,
    );
  }
}

async function parseResponsePayload(response: Response): Promise<ResponsesApiResponse> {
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();

  const looksLikeSse =
    contentType.includes('text/event-stream') ||
    raw.startsWith('event:') ||
    raw.includes('\ndata:') ||
    raw.includes('\n\nevent:');

  if (looksLikeSse) {
    return parseSseResponsePayload(raw);
  }

  try {
    return JSON.parse(raw) as ResponsesApiResponse;
  } catch {
    throw new Error(`ChatGPT search response parse failed: expected JSON or SSE payload, got: ${compactErrorText(raw)}`);
  }
}

function parseSseResponsePayload(sseText: string): ResponsesApiResponse {
  let completed: ResponsesApiResponse | null = null;

  for (const chunk of sseText.split('\n\n')) {
    const dataLines = chunk
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .filter(Boolean);

    for (const line of dataLines) {
      if (line === '[DONE]') continue;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (event?.type === 'response.completed' || event?.type === 'response.done') {
        if (event.response && typeof event.response === 'object') {
          completed = event.response as ResponsesApiResponse;
        }
      }
    }
  }

  if (!completed) {
    throw new Error('ChatGPT search stream returned no completed response payload');
  }

  return completed;
}

function buildRequestFingerprint(body: {
  model: string;
  store: boolean;
  stream: boolean;
  tools: Array<{ type: string }>;
  tool_choice: string;
  text?: { verbosity?: string };
}): string {
  const toolType = body.tools[0]?.type || 'unknown';
  const verbosity = body.text?.verbosity || 'unset';

  return `tool=${toolType}, model=${body.model}, store=${String(body.store)}, stream=${String(body.stream)}, tool_choice=${body.tool_choice}, text.verbosity=${verbosity}`;
}

function compactErrorText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Bad Request';
  return normalized.slice(0, ERROR_TEXT_LIMIT);
}
