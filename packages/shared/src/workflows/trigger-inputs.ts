/**
 * Workflows — trigger input normalisation and per-job toolset overrides.
 *
 * Ported from Hermes Agent (MIT) — `cron/scheduler.py` lines 60-88 (the
 * `_resolve_cron_enabled_toolsets` helper) and `cron/jobs.py` lines 523 / 662
 * (per-job override fields on the cron-job record). Upstream snapshot lives at
 * `.planning/research/upstream/hermes/` (read-only, not shipped). See research
 * note `.planning/research/03-hooks-prompt-cron.md` §Upgrade 8 for the full
 * precedence-chain rationale.
 *
 * Precedence (highest → lowest):
 *   1. Per-job override on the firing trigger (`enabled_source_slugs`)
 *   2. Per-platform config (e.g. `cron.enabled_source_slugs`)
 *   3. Workspace-wide default toolset
 *
 * Semantics — important:
 *   - `enabled_source_slugs === undefined` means "inherit from next layer".
 *   - `enabled_source_slugs === []` means **deny all** (allow zero sources). It
 *     does NOT fall through to defaults. This mirrors Hermes, where an empty
 *     array on a cron job is a deliberate "muzzle this run" signal.
 *   - Any thrown lookup is swallowed with a warning and we fall through to the
 *     default — matches Hermes `cron/scheduler.py:87` graceful degradation.
 *
 * `permission_mode` is a per-run **hint** carried on the trigger:
 *   - "default": existing per-workspace policy applies.
 *   - "subconscious": agent should pause and escalate on write attempts.
 *     Runtime semantics ship in plan 01-07; this plan only plumbs the field.
 *   - "yolo": skip approval checks (operator-acknowledged risk).
 *
 *   NOTE: this is intentionally distinct from the workspace `PermissionMode`
 *   union (`safe | ask | allow-all`) defined in `agent/mode-types.ts`. The
 *   workspace mode is a stable per-workspace policy; this is a per-run hint
 *   that influences how the runner *configures* the workspace mode for that
 *   one run.
 */

import { createLogger } from '../utils/debug.ts';
import type { LoadedWorkflow } from './types.ts';

const log = createLogger('workflow-trigger-inputs');

// ---------------------------------------------------------------------------
// Existing input normaliser — unchanged surface, kept backward compatible.
// ---------------------------------------------------------------------------

export function normalizeWorkflowTriggerInputs(
  workflow: LoadedWorkflow,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const inputDefs = workflow.metadata.trigger.inputs ?? [];
  if (inputDefs.length === 0) return {};

  const out: Record<string, unknown> = {};
  for (const def of inputDefs) {
    let value = raw?.[def.name];
    if (value === undefined) value = def.default;

    if (def.required && (value === undefined || value === null || value === '')) {
      throw new Error(`Missing required workflow input: ${def.name}`);
    }
    if (value === undefined || value === null || value === '') continue;

    if (def.type === 'string') {
      if (typeof value !== 'string') throw new Error(`Workflow input "${def.name}" must be a string.`);
      out[def.name] = value;
    } else if (def.type === 'number') {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new Error(`Workflow input "${def.name}" must be a number.`);
      }
      out[def.name] = value;
    } else if (def.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`Workflow input "${def.name}" must be a boolean.`);
      out[def.name] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-job toolset override + permission-mode hint (R5)
// ---------------------------------------------------------------------------

/** Run-level permission-mode hint. See file header for semantics. */
export type TriggerPermissionMode = 'default' | 'subconscious' | 'yolo';

export const TRIGGER_PERMISSION_MODES: readonly TriggerPermissionMode[] = [
  'default',
  'subconscious',
  'yolo',
] as const;

/**
 * Optional, backward-compatible per-job override carried on a workflow's
 * trigger inputs. Both fields are optional — workflows that don't set them
 * keep their current behavior.
 *
 * `undefined` ≠ `[]`. See file-header semantics.
 */
export interface TriggerToolsetOverride {
  /** Allow-list of source slugs this run may use. `[]` means deny-all. */
  enabled_source_slugs?: string[];
  /** Run-level permission-mode hint. */
  permission_mode?: TriggerPermissionMode;
}

/** Per-platform config layer (the middle precedence tier). */
export interface PlatformToolsetConfig {
  cron?: {
    enabled_source_slugs?: string[];
    permission_mode?: TriggerPermissionMode;
  };
  workflow?: {
    enabled_source_slugs?: string[];
    permission_mode?: TriggerPermissionMode;
  };
}

/** What platform layer to consult inside `PlatformToolsetConfig`. */
export type PlatformKey = 'cron' | 'workflow';

/**
 * Type guard for the optional override shape. Used by callers that read the
 * trigger payload off the wire (where it has type `Record<string, unknown>`).
 *
 * Validates BOTH fields. Returns a normalised copy so callers don't have to
 * re-check after.
 */
export function parseTriggerToolsetOverride(
  raw: unknown,
): TriggerToolsetOverride {
  if (raw === null || raw === undefined || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const out: TriggerToolsetOverride = {};

  if ('enabled_source_slugs' in obj) {
    const v = obj.enabled_source_slugs;
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      out.enabled_source_slugs = v as string[];
    } else if (v !== undefined) {
      throw new Error(
        'Trigger override "enabled_source_slugs" must be an array of strings (or omitted).',
      );
    }
  }

  if ('permission_mode' in obj) {
    const v = obj.permission_mode;
    if (v === undefined) {
      // omitted — treat as not set
    } else if (
      typeof v === 'string' &&
      (TRIGGER_PERMISSION_MODES as readonly string[]).includes(v)
    ) {
      out.permission_mode = v as TriggerPermissionMode;
    } else {
      throw new Error(
        `Trigger override "permission_mode" must be one of ${TRIGGER_PERMISSION_MODES.join(
          ', ',
        )}.`,
      );
    }
  }

  return out;
}

/**
 * Resolve the effective enabled-source-slug list for a run.
 *
 * Returns:
 *   - `[]`     — explicit deny-all (when the per-job override is `[]`).
 *   - `string[]` (non-empty) — the resolved allow-list.
 *   - `undefined` — no layer specified anything; caller should treat as
 *     "no gating" and load the full workspace default.
 *
 * Graceful degradation: any thrown lookup (e.g. malformed platform config)
 * is swallowed with a warn-level log and we fall through to the default.
 * Mirrors Hermes `cron/scheduler.py:87`.
 */
export function resolveEnabledToolsets(args: {
  perJobOverride?: TriggerToolsetOverride;
  perPlatformConfig?: PlatformToolsetConfig;
  platformKey?: PlatformKey;
  defaultToolset?: string[];
}): string[] | undefined {
  const { perJobOverride, perPlatformConfig, platformKey = 'cron', defaultToolset } = args;
  try {
    // Tier 1: per-job override wins, including the `[]` deny-all signal.
    if (perJobOverride && perJobOverride.enabled_source_slugs !== undefined) {
      return dedupe(perJobOverride.enabled_source_slugs);
    }

    // Tier 2: per-platform config. Look up the requested platform; if that
    // platform isn't configured, fall through to default. A non-existent
    // platform key is not an error (Hermes `cron/scheduler.py:87`).
    const platformLayer = perPlatformConfig?.[platformKey];
    if (platformLayer && platformLayer.enabled_source_slugs !== undefined) {
      return dedupe(platformLayer.enabled_source_slugs);
    }

    // Tier 3: workspace default.
    return defaultToolset === undefined ? undefined : dedupe(defaultToolset);
  } catch (err) {
    log.warn(
      `[resolveEnabledToolsets] lookup failed; falling back to default toolset: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return defaultToolset === undefined ? undefined : dedupe(defaultToolset);
  }
}

/**
 * Resolve the effective permission-mode hint. Same precedence chain as
 * `resolveEnabledToolsets`; defaults to "default" if nothing is set.
 */
export function resolvePermissionMode(args: {
  perJobOverride?: TriggerToolsetOverride;
  perPlatformConfig?: PlatformToolsetConfig;
  platformKey?: PlatformKey;
}): TriggerPermissionMode {
  const { perJobOverride, perPlatformConfig, platformKey = 'cron' } = args;
  try {
    if (perJobOverride?.permission_mode !== undefined) {
      return perJobOverride.permission_mode;
    }
    const platformLayer = perPlatformConfig?.[platformKey];
    if (platformLayer?.permission_mode !== undefined) {
      return platformLayer.permission_mode;
    }
    return 'default';
  } catch (err) {
    log.warn(
      `[resolvePermissionMode] lookup failed; defaulting to "default": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 'default';
  }
}

/**
 * Runtime enforcement helper. Returns a typed denial result when a source
 * slug is NOT in the resolved allow-list. Callers (workflow-runner) should
 * intercept tool-dispatch and short-circuit with this denial rather than
 * throwing — matches the spawn-session-tool source-slug enforcement pattern.
 *
 * - `resolved === undefined` → no gating active, allow.
 * - `resolved === []`        → deny everything (explicit empty allow-list).
 * - otherwise                → allow iff slug is in the list.
 */
export function isSourceAllowed(
  resolved: string[] | undefined,
  sourceSlug: string,
): boolean {
  if (resolved === undefined) return true;
  return resolved.includes(sourceSlug);
}

/** Build the typed denial value a tool dispatcher should return on rejection. */
export function buildToolNotEnabledDenial(sourceSlug: string): {
  denied: true;
  error: string;
  sourceSlug: string;
} {
  return {
    denied: true,
    error: `tool not enabled for this run (source "${sourceSlug}" outside per-run allow-list)`,
    sourceSlug,
  };
}

function dedupe(input: string[]): string[] {
  // Preserve insertion order; trim + drop empty strings. Returns [] for [].
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const s = raw.trim();
    if (s.length === 0) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
