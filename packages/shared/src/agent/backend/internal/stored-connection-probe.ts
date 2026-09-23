import { parseValidationError } from '../../../config/llm-validation';

interface ProbeBackend {
  runMiniCompletion(prompt: string): Promise<string | null>;
  destroy(): void;
}

/** A real inference proves access; credential presence or a models list does not. */
export async function probeStoredConnection(agent: ProbeBackend, timeoutMs = 20_000): Promise<{ success: boolean; error?: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      agent.runMiniCompletion('Reply with exactly: OK'),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('stored-connection-probe-timeout')), timeoutMs);
      }),
    ]);
    return result?.trim() ? { success: true } : { success: false, error: 'The selected model returned no response. Check provider access and model availability.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'stored-connection-probe-timeout') return { success: false, error: 'Connection test timed out. Check your provider and try again.' };
    // Translate known failures, but never return raw provider output or subprocess stderr.
    const safe = parseValidationError(message);
    if (safe === 'Access denied. Check your API key permissions.') return { success: false, error: 'Access denied for the selected model. Check your provider access or choose another model.' };
    return { success: false, error: safe !== message.slice(0, 200) ? safe : 'The selected model could not complete a request. Check provider access, model availability, and the installed app runtime.' };
  } finally {
    if (timer) clearTimeout(timer);
    try { agent.destroy(); } catch { /* Cleanup must not replace a sanitized result with raw SDK errors. */ }
  }
}
