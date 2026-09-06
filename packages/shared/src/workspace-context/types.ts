/**
 * Workspace Context — types
 *
 * A "Context Doc" is a markdown file holding workspace-level guidance:
 * goals, vision, voice/style, glossary, anything the user wants their
 * agents to read before starting work.
 *
 * Design choices that drive the schema:
 *   - One file per topic (not one big workspace.md). Lets users keep
 *     "voice & style" separate from "Q2 product goals" and route them
 *     to different agents.
 *   - Routing is per-doc. Default = broadcast to every agent. Targeted
 *     routing names specific agent slugs.
 *   - Delivery and access are separate. `always` docs may enter a prompt;
 *     `on-demand` docs remain available for explicit retrieval only.
 *   - The Concierge may retrieve every enabled non-private doc regardless
 *     of routing. Private docs still obey their declared routing.
 *   - Frontmatter mirrors AGENT.md / SKILL.md so the YAML+markdown idiom
 *     stays consistent.
 */
import { AGENT_SLUG_REGEX } from '../agent-definitions/types.ts';

/**
 * "broadcast" = visible to every agent in the workspace.
 * A list of slugs = visible only to those agents (plus Concierge).
 *
 * We use a string literal for the broadcast case rather than `string[] | undefined`
 * so the file format is explicit: `agents: all` reads as a deliberate decision,
 * `agents: [writer]` reads as a deliberate narrowing. Missing field defaults
 * to broadcast at parse time.
 */
export type ContextDocRouting =
  | { mode: 'broadcast' }
  | { mode: 'targeted'; agents: string[] };

export type ContextDocDelivery = 'always' | 'on-demand';

/**
 * Goal status. When set, the doc is treated as a Goal by the Pulse runtime
 * (see `docs/pulses/01-spec.md` section 1). When unset, the doc is a regular
 * context doc and the goal-related fields are ignored.
 */
export type ContextDocGoalStatus = 'active' | 'blocked' | 'paused' | 'done';
export type ContextDocGoalPriority = 'low' | 'normal' | 'high';

export const CONTEXT_DOC_GOAL_STATUSES: readonly ContextDocGoalStatus[] = [
  'active',
  'blocked',
  'paused',
  'done',
];
export const CONTEXT_DOC_GOAL_PRIORITIES: readonly ContextDocGoalPriority[] = [
  'low',
  'normal',
  'high',
];

export interface ContextDocMetadata {
  /** Human-readable display name (e.g. "Voice & Style"). */
  name: string;
  /** One-sentence description. Optional. */
  description?: string;
  /** Routing rule. Defaults to broadcast when the field is missing. */
  routing: ContextDocRouting;
  /**
   * If false, the doc is in the workspace but not delivered to any agent.
   * Lets users keep drafts without affecting prompts. Defaults to true.
   */
  enabled: boolean;
  /**
   * Prompt delivery policy. Missing preserves legacy prompt delivery for
   * regular agents, while Concierge treats it as on-demand.
   */
  delivery?: ContextDocDelivery;
  /**
   * Agents that always receive this doc in their prompt, overriding `delivery`
   * for them alone.
   *
   * Exists because `delivery` is one value for every agent while some docs are
   * only always-relevant to part of the roster — branding is load-bearing for
   * visual and video agents and merely nice-to-have for a legal or royalty
   * worker. Expressing that through `routing` instead would be wrong: routing
   * controls *access*, so narrowing it would make the doc invisible to everyone
   * else rather than merely un-injected.
   *
   * Missing or empty behaves exactly as `delivery` alone, so existing docs are
   * unaffected.
   */
  deliveryAlwaysFor?: string[];
  /** If true, Concierge receives no routing override for this doc. */
  private?: boolean;
  /** Goal status — when set, this doc is a Pulse goal. */
  status?: ContextDocGoalStatus;
  /** Goal priority. Only meaningful when `status` is set. */
  priority?: ContextDocGoalPriority;
  /** Goal deadline as ISO date (YYYY-MM-DD). Only meaningful when `status` is set. */
  deadline?: string;
}

/**
 * Agents that always receive `artist-branding`, even though the doc is
 * on-demand for everyone else.
 *
 * Mirrors `visualAgent: true` in the agent definitions — the existing signal
 * for "produces something the audience looks at" — plus `branding-agent`,
 * which owns the doc without being a visual agent itself. A new visual agent
 * should be added here too.
 *
 * Lives in this module rather than beside the doc definition so
 * `SYSTEM_CONTEXT_DOC_DELIVERY` below can reference it without
 * workspace-context importing artist-context, which would be a cycle.
 */
export const ARTIST_BRANDING_ALWAYS_AGENT_SLUGS = [
  'hypermotion-agent',
  'video-director',
  'lottie-animation-agent',
  'video-editor-agent',
  'lyric-video-agent',
  'raw-video-editor',
  'art-director',
  'open-slide-agent',
  'shopify-agent',
  'print-agent',
  'branding-agent',
] as const;

/**
 * Delivery policy for product-generated context docs, applied by slug and
 * taking precedence over whatever the file on disk happens to say.
 *
 * These docs are written by Artist OS, not by the artist. Their frontmatter is
 * only rewritten when something edits the doc, so a workspace created before a
 * policy change would otherwise keep the old behavior indefinitely — an
 * `artist-profile` written months ago has no `delivery` field at all and would
 * silently stop being injected. Pinning the policy by slug makes it take effect
 * everywhere at once and keeps it identical across workspaces.
 *
 * The previous implementation did the same thing for `artist-network` with a
 * hardcoded slug check; this is that idea made explicit and extensible.
 *
 * Artist-authored docs are deliberately absent from this map: they are governed
 * by their own frontmatter, which the artist controls.
 */
export const SYSTEM_CONTEXT_DOC_DELIVERY: Readonly<Record<string, {
  delivery: ContextDocDelivery;
  alwaysFor?: readonly string[];
}>> = {
  // Who the artist is, and how they sound. No agent should have to ask.
  'artist-profile': { delivery: 'always' },
  'artist-voice': { delivery: 'always' },
  // What the current campaign is for.
  'mission-brief': { delivery: 'always' },
  // Brand DNA: in front of the agents that make audience-facing artifacts,
  // readable by everyone else.
  'artist-branding': { delivery: 'on-demand', alwaysFor: ARTIST_BRANDING_ALWAYS_AGENT_SLUGS },
  // A contact library is a lookup surface, never prompt furniture.
  'artist-network': { delivery: 'on-demand' },
};

export type ContextDocParseWarningCode =
  | 'invalid-agents'
  | 'invalid-enabled'
  | 'invalid-delivery'
  | 'invalid-delivery-always-for'
  | 'invalid-private'
  | 'invalid-status'
  | 'invalid-priority'
  | 'invalid-deadline';

export interface ContextDocParseWarning {
  field: keyof ContextDocMetadata;
  code: ContextDocParseWarningCode;
  message: string;
}

export interface LoadedContextDoc {
  /** Filesystem slug — also the @-mention identifier. */
  slug: string;
  metadata: ContextDocMetadata;
  /** Markdown body (everything below the frontmatter, trimmed). */
  body: string;
  /** Absolute path to the doc's directory. */
  path: string;
  /** Workspace this doc belongs to. */
  workspaceRootPath: string;
  parseWarnings?: ContextDocParseWarning[];
}

/** Same slug shape as agents/skills — keeps @-mentions uniform. */
export const CONTEXT_DOC_SLUG_REGEX = AGENT_SLUG_REGEX;

/** Filename used inside each doc's directory. */
export const CONTEXT_FILE = 'CONTEXT.md';
