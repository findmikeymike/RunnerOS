/**
 * Prompt assembly + injection scanning for non-interactive agent runs.
 *
 * Ports Hermes (MIT) cron-prompt scanning so RunnerOS cron jobs and workflow
 * dispatch can block prompt-injection / exfiltration payloads BEFORE the
 * prompt reaches the agent.
 *
 * Upstream references (vendored under .planning/research/upstream/hermes/):
 *   - tools/cronjob_tools.py:43-141  — regex pack + invisible-unicode scan
 *   - cron/scheduler.py:1058-1131    — assembled-prompt scan (#3968 fix)
 *
 * Hermes ships under MIT. See THIRD_PARTY_NOTICES.md.
 *
 * Why scan the *fully-assembled* prompt and not just user input:
 *   Hermes bug #3968 — skills are loaded from disk at run time, so create-time
 *   scanning of the user-supplied prompt missed payloads that lived inside a
 *   skill body. The fix is to assemble (user + skills + context files) and
 *   scan the concatenation immediately before dispatching the agent.
 */

// ---------------------------------------------------------------------------
// Threat pattern pack — ported verbatim (modulo TS regex syntax) from
// Hermes `_CRON_THREAT_PATTERNS` in tools/cronjob_tools.py:43-52.
// ---------------------------------------------------------------------------

export interface InjectionPattern {
  /** Stable identifier surfaced in logs and the blocked reason string. */
  id: string;
  re: RegExp;
}

const THREAT_PATTERNS: InjectionPattern[] = [
  { id: 'prompt_injection',     re: /ignore\s+(?:\w+\s+)*(?:previous|all|above|prior)\s+(?:\w+\s+)*instructions/i },
  { id: 'deception_hide',       re: /do\s+not\s+tell\s+the\s+user/i },
  { id: 'sys_prompt_override',  re: /system\s+prompt\s+override/i },
  { id: 'disregard_rules',      re: /disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i },
  { id: 'read_secrets',         re: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass)/i },
  { id: 'ssh_backdoor',         re: /authorized_keys/i },
  { id: 'sudoers_mod',          re: /\/etc\/sudoers|visudo/i },
  { id: 'destructive_root_rm',  re: /rm\s+-rf\s+\//i },
];

// SECRET_VAR sub-pattern (Hermes cronjob_tools.py:54).
const SECRET_VAR = String.raw`\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)\w*\}?`;

const EXFIL_PATTERNS: InjectionPattern[] = [
  { id: 'exfil_curl_url',         re: new RegExp(String.raw`curl\s+[^\n]*https?://[^\s"'\x60]*` + SECRET_VAR, 'i') },
  { id: 'exfil_wget_url',         re: new RegExp(String.raw`wget\s+[^\n]*https?://[^\s"'\x60]*` + SECRET_VAR, 'i') },
  { id: 'exfil_curl_data',        re: new RegExp(String.raw`curl\s+[^\n]*(?:--data(?:-raw|-binary|-urlencode)?|-d|--form|-F)\s+[^\n]*` + SECRET_VAR, 'i') },
  { id: 'exfil_wget_post',        re: new RegExp(String.raw`wget\s+[^\n]*--post-(?:data|file)=[^\n]*` + SECRET_VAR, 'i') },
  { id: 'exfil_curl_auth_header', re: new RegExp(String.raw`curl\s+[^\n]*(?:-H|--header)\s+["']Authorization:\s*(?:Bearer|token)\s+` + SECRET_VAR + String.raw`["']`, 'i') },
];

// Bonus: obvious base64-decode-then-pipe-to-shell payload (research callout).
const BASE64_SHELL: InjectionPattern = {
  id: 'base64_shell_payload',
  re: /(?:[A-Za-z0-9+/]{16,}={0,2}\s*\|\s*base64\s+-d\s*\|\s*sh)|(?:eval\s+\$\(\s*echo\s+[^\n)]*\|\s*base64\s+-d\s*\))/i,
};

/** Full ordered pattern list. Threats first, exfil second, base64 last. */
export const INJECTION_PATTERNS: InjectionPattern[] = [
  ...THREAT_PATTERNS,
  ...EXFIL_PATTERNS,
  BASE64_SHELL,
];

// ---------------------------------------------------------------------------
// Invisible-unicode handling. Mirrors Hermes _CRON_INVISIBLE_CHARS at
// tools/cronjob_tools.py:68-71. U+200D (ZWJ) is intentionally OMITTED from the
// strip set so emoji sequences like 👨‍💻 (which require ZWJ) don't trip the
// scanner. Stand-alone "bare" ZWJ between non-emoji characters IS still a
// signal that something invisible is being smuggled — we restore detection
// via `_zwjHasEmojiNeighbour`, ported from cronjob_tools.py:87-114.
// ---------------------------------------------------------------------------

const INVISIBLE_CHARS = new Set<string>([
  '​', // zero-width space
  '‌', // zero-width non-joiner
  // U+200D zero-width joiner handled specially below.
  '⁠', // word joiner
  '﻿', // BOM / zero-width no-break space
  '‪', '‫', '‬', '‭', '‮', // bidi controls
  '⁦', '⁧', '⁨', '⁩',           // bidi isolates
  '‎', '‏',                               // LRM / RLM
]);

const VARIATION_SELECTOR_CP = 0xFE0F;
const EMOJI_RANGES: ReadonlyArray<[number, number]> = [
  [0x1F000, 0x1FFFF],
  [0x2600,  0x27BF],
  [0x2300,  0x23FF],
  [0x1F1E6, 0x1F1FF],
  [0x20E3,  0x20E3],
];

function isEmojiCp(cp: number): boolean {
  for (const [lo, hi] of EMOJI_RANGES) if (cp >= lo && cp <= hi) return true;
  return false;
}

// Read the codepoint that ENDS at UTF-16 index `idx` (inclusive). When `idx`
// is a low surrogate we walk back to its paired high surrogate so emoji
// astral codepoints (e.g. U+1F4BB) aren't misread as their surrogate halves.
function codePointEndingAt(text: string, idx: number): number {
  if (idx < 0 || idx >= text.length) return 0;
  const code = text.charCodeAt(idx);
  if (code >= 0xDC00 && code <= 0xDFFF && idx > 0) {
    const prev = text.charCodeAt(idx - 1);
    if (prev >= 0xD800 && prev <= 0xDBFF) {
      return text.codePointAt(idx - 1) ?? 0;
    }
  }
  return text.codePointAt(idx) ?? 0;
}

function zwjHasEmojiNeighbour(text: string, idx: number): boolean {
  let left = idx - 1;
  while (left >= 0 && text.charCodeAt(left) === VARIATION_SELECTOR_CP) left--;
  let right = idx + 1;
  while (right < text.length && text.charCodeAt(right) === VARIATION_SELECTOR_CP) right++;
  if (left < 0 || right >= text.length) return false;
  const leftCp = codePointEndingAt(text, left);
  const rightCp = text.codePointAt(right) ?? 0;
  return isEmojiCp(leftCp) && isEmojiCp(rightCp);
}

/**
 * Strip invisible / bidi-control codepoints used to smuggle prompt-injection
 * payloads past visual review. U+200D ZWJ is removed only when it appears
 * BETWEEN non-emoji characters; legitimate emoji ZWJ sequences are preserved.
 *
 * Exported so callers (and tests) can introspect the normalized form.
 */
export function stripInvisibleChars(input: string): string {
  if (!input) return input;
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === '‍') {
      if (zwjHasEmojiNeighbour(input, i)) {
        out += ch;
      }
      continue;
    }
    if (INVISIBLE_CHARS.has(ch)) continue;
    out += ch;
  }
  return out;
}

function findInvisibleChar(input: string): string | null {
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === '‍') {
      if (!zwjHasEmojiNeighbour(input, i)) return ch;
      continue;
    }
    if (INVISIBLE_CHARS.has(ch)) return ch;
  }
  return null;
}

// ---------------------------------------------------------------------------
// assemblePrompt — concatenate user prompt + loaded skills + context files
// into the single string the agent will actually see. Deterministic order
// (sorted by name/path) so identical inputs always assemble identically and
// scanner results are reproducible.
// ---------------------------------------------------------------------------

export interface AssemblePromptInput {
  userPrompt: string;
  loadedSkills?: ReadonlyArray<{ name: string; body: string }>;
  contextFiles?: ReadonlyArray<{ path: string; body: string }>;
}

export function assemblePrompt(input: AssemblePromptInput): string {
  const { userPrompt, loadedSkills = [], contextFiles = [] } = input;
  const parts: string[] = [];

  parts.push('<user>');
  parts.push(userPrompt);
  parts.push('</user>');

  const skillsSorted = [...loadedSkills].sort((a, b) => a.name.localeCompare(b.name));
  for (const skill of skillsSorted) {
    parts.push(`<skill name="${skill.name}">`);
    parts.push(skill.body);
    parts.push('</skill>');
  }

  const contextSorted = [...contextFiles].sort((a, b) => a.path.localeCompare(b.path));
  for (const ctx of contextSorted) {
    parts.push(`<context path="${ctx.path}">`);
    parts.push(ctx.body);
    parts.push('</context>');
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// scanForInjection — pure regex scan against the fully-assembled prompt.
// Returns blocked + pattern id + a human-readable reason. Callers are
// expected to log the reason structured (jobId / runId / pattern) and to
// abort dispatch without invoking the agent.
// ---------------------------------------------------------------------------

export interface InjectionScanResult {
  blocked: boolean;
  reason?: string;
  pattern?: string;
}

export function scanForInjection(assembled: string): InjectionScanResult {
  if (!assembled) return { blocked: false };

  // 1. Invisible-unicode pre-check — Hermes flags ANY hit before regex scan
  //    so the underlying threat pattern's intent isn't disguised.
  const invisible = findInvisibleChar(assembled);
  if (invisible) {
    const cp = invisible.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
    return {
      blocked: true,
      pattern: 'invisible_unicode',
      reason: `prompt contains invisible unicode U+${cp} (possible injection)`,
    };
  }

  // 2. Normalize (no invisibles left, but keep ZWJs we preserved) and run
  //    each regex against the normalized form.
  const normalized = stripInvisibleChars(assembled);
  for (const p of INJECTION_PATTERNS) {
    if (p.re.test(normalized)) {
      return {
        blocked: true,
        pattern: p.id,
        reason: `prompt matches threat pattern '${p.id}'`,
      };
    }
  }

  return { blocked: false };
}

/**
 * Thrown by dispatch sites that want to surface a clean error instead of
 * returning a result object. Carries the pattern id for structured logging.
 */
export class PromptInjectionBlocked extends Error {
  readonly pattern: string;
  readonly reason: string;
  constructor(result: InjectionScanResult) {
    const reason = result.reason ?? 'blocked by prompt-injection scanner';
    super(reason);
    this.name = 'PromptInjectionBlocked';
    this.pattern = result.pattern ?? 'unknown';
    this.reason = reason;
  }
}
