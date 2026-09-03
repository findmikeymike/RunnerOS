/**
 * Workflows — templating resolver
 *
 * Mustache-ish, intentionally tiny. Recognized tokens:
 *
 *   {{trigger.<field>}}
 *   {{steps.<id>.output}}
 *   {{steps.<id>.output.<dot.path>}}
 *   {{run.id}}
 *   {{run.startedAt}}
 *   {{steps.<id>.output | escape}}
 *
 * Rules per `docs/workflows/01-spec.md`:
 *   - Unknown references resolve to '' and emit a warning.
 *   - No expressions or loops. The only filter is `escape`, for embedding
 *     untrusted text inside a structural prompt boundary.
 *   - Resolution is pure — no I/O.
 */

export interface TemplateContext {
  trigger?: Record<string, unknown>;
  untrustedTriggerFields?: readonly string[];
  steps?: Record<string, { output: unknown }>;
  run?: { id: string; startedAt: string };
}

export interface TemplateResolveResult {
  output: string;
  warnings: string[];
}

const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

function stringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function escapePromptBoundary(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function parseExpression(expr: string):
  | { ok: true; path: string; filter?: 'escape' }
  | { ok: false; reason: string } {
  const segments = expr.split('|').map((segment) => segment.trim());
  if (segments.length > 2 || !segments[0]) return { ok: false, reason: `invalid template expression "{{${expr}}}"` };
  if (segments.length === 1) return { ok: true, path: segments[0] };
  if (segments[1] !== 'escape') return { ok: false, reason: `unknown template filter "${segments[1] ?? ''}"` };
  return { ok: true, path: segments[0], filter: 'escape' };
}

function formatResolvedValue(value: unknown, filter: 'escape' | undefined): string {
  const text = stringify(value);
  return filter === 'escape' ? escapePromptBoundary(text) : text;
}

function formatUntrustedTriggerValue(name: string, value: unknown): string {
  const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return `<untrusted-trigger-data name="${safeName}">\n${escapePromptBoundary(stringify(value))}\n</untrusted-trigger-data>`;
}

function dotWalk(root: unknown, parts: string[]): { ok: true; value: unknown } | { ok: false } {
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return { ok: false };
    cur = (cur as Record<string, unknown>)[p];
    if (cur === undefined) return { ok: false };
  }
  return { ok: true, value: cur };
}

function resolveToken(expr: string, ctx: TemplateContext): { ok: true; value: string } | { ok: false; reason: string } {
  const parsed = parseExpression(expr);
  if (!parsed.ok) return parsed;
  const parts = parsed.path.split('.').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, reason: `empty token "{{${expr}}}"` };

  const head = parts[0];

  if (head === 'trigger') {
    const field = parts[1];
    if (field === undefined) return { ok: false, reason: `"{{${expr}}}" is missing a field name` };
    if (parts.length !== 2) return { ok: false, reason: `"{{${expr}}}" must be trigger.<field>` };
    if (!ctx.trigger || !(field in ctx.trigger)) {
      return { ok: false, reason: `unknown trigger field "${field}"` };
    }
    if (ctx.untrustedTriggerFields?.includes(field)) {
      return { ok: true, value: formatUntrustedTriggerValue(field, ctx.trigger[field]) };
    }
    return { ok: true, value: formatResolvedValue(ctx.trigger[field], parsed.filter) };
  }

  if (head === 'run') {
    const field = parts[1];
    if (parts.length !== 2 || field === undefined) {
      return { ok: false, reason: `"{{${expr}}}" is not a recognized run field` };
    }
    if (field !== 'id' && field !== 'startedAt') {
      return { ok: false, reason: `unknown run field "${field}"` };
    }
    if (!ctx.run) return { ok: false, reason: `run context not available` };
    return { ok: true, value: formatResolvedValue(ctx.run[field], parsed.filter) };
  }

  if (head === 'steps') {
    const stepId = parts[1];
    if (parts.length < 3 || parts[2] !== 'output' || stepId === undefined) {
      return { ok: false, reason: `"{{${expr}}}" must be steps.<id>.output[.path]` };
    }
    const step = ctx.steps?.[stepId];
    if (!step) return { ok: false, reason: `unknown step "${stepId}"` };
    if (parts.length === 3) return { ok: true, value: formatResolvedValue(step.output, parsed.filter) };
    const walked = dotWalk(step.output, parts.slice(3));
    if (!walked.ok) return { ok: false, reason: `unknown path "${parts.slice(3).join('.')}" in step "${stepId}" output` };
    return { ok: true, value: formatResolvedValue(walked.value, parsed.filter) };
  }

  return { ok: false, reason: `unrecognized token root "${head}"` };
}

export function resolveTemplate(template: string, ctx: TemplateContext): TemplateResolveResult {
  const warnings: string[] = [];
  const output = template.replace(TOKEN_RE, (_match, expr: string) => {
    const result = resolveToken(expr, ctx);
    if (result.ok) return result.value;
    warnings.push(result.reason);
    return '';
  });
  return { output, warnings };
}

/**
 * Static check used by the parser — no values needed, only known step IDs +
 * known trigger input names. Returns a list of error messages; empty = clean.
 *
 * The parser uses this to enforce "no forward references": call it with
 * `knownStepIds = previousStepIds` while walking step-by-step, so a step
 * referencing a later step's output trips an error.
 */
export function validateTemplateReferences(
  template: string,
  knownStepIds: string[],
  knownTriggerInputs: string[],
): string[] {
  const errors: string[] = [];
  const stepSet = new Set(knownStepIds);
  const triggerSet = new Set(knownTriggerInputs);
  const matches = template.matchAll(TOKEN_RE);
  for (const m of matches) {
    const rawExpr = m[1] ?? '';
    const expr = rawExpr.trim();
    const parsed = parseExpression(expr);
    if (!parsed.ok) {
      errors.push(parsed.reason);
      continue;
    }
    const parts = parsed.path.split('.').map((p) => p.trim()).filter(Boolean);
    const head = parts[0];
    if (!head) {
      errors.push(`empty token "{{${expr}}}"`);
      continue;
    }
    if (head === 'trigger') {
      const field = parts[1];
      if (!field) {
        errors.push(`"{{${expr}}}" is missing a field name`);
        continue;
      }
      if (parts.length !== 2) {
        errors.push(`"{{${expr}}}" must be trigger.<field>`);
        continue;
      }
      if (!triggerSet.has(field)) {
        errors.push(`trigger has no input named "${field}"`);
      }
    } else if (head === 'steps') {
      const stepId = parts[1];
      if (!stepId || parts.length < 3 || parts[2] !== 'output') {
        errors.push(`"{{${expr}}}" must be steps.<id>.output[.path]`);
        continue;
      }
      if (!stepSet.has(stepId)) {
        errors.push(`reference to unknown or future step "${stepId}"`);
      }
    } else if (head === 'run') {
      const field = parts[1];
      if (parts.length !== 2 || (field !== 'id' && field !== 'startedAt')) {
        errors.push(`"{{${expr}}}" is not a recognized run field`);
      }
    } else {
      errors.push(`unrecognized token root "${head}" in "{{${expr}}}"`);
    }
  }
  return errors;
}
