/**
 * ACP tool-call wire format.
 *
 * Ported from Hermes hermes_acp/tools.py (MIT).
 *   - get_tool_kind         → getToolKind
 *   - build_tool_title      → buildToolTitle
 *   - build_tool_start      → buildToolStart
 *   - build_tool_complete   → buildToolComplete
 *   - _json_loads_maybe     → jsonLoadsMaybe
 *
 * See THIRD_PARTY_NOTICES.md for license attribution.
 */

import type {
  ContentBlock,
  EditProposal,
  ToolCallId,
  ToolCallProgress,
  ToolCallStart,
  ToolKind,
  ToolStatus,
} from './types.ts';

const READ_TOOLS = new Set(['read_file', 'read', 'view']);
const EDIT_TOOLS = new Set(['write_file', 'patch', 'edit_file', 'edit']);
const EXECUTE_TOOLS = new Set(['terminal', 'process', 'execute_code', 'shell', 'bash']);

const POLISHED_TOOLS = new Set([
  'read_file',
  'write_file',
  'patch',
  'terminal',
  'process',
  'search_files',
  'todo',
]);

let _toolCallIdCounter = 0;

export function makeToolCallId(): ToolCallId {
  _toolCallIdCounter += 1;
  return `tc-${Date.now()}-${_toolCallIdCounter}`;
}

export function getToolKind(name: string): ToolKind {
  const lc = name.toLowerCase();
  if (READ_TOOLS.has(lc)) return 'read';
  if (EDIT_TOOLS.has(lc)) return 'edit';
  if (EXECUTE_TOOLS.has(lc)) return 'execute';
  return 'other';
}

export function buildToolTitle(name: string, args: Record<string, unknown>): string {
  const lc = name.toLowerCase();
  if (READ_TOOLS.has(lc) && typeof args.path === 'string') {
    return `read: ${args.path}`;
  }
  if (EDIT_TOOLS.has(lc) && typeof args.path === 'string') {
    return `${name}: ${args.path}`;
  }
  if (EXECUTE_TOOLS.has(lc) && typeof args.command === 'string') {
    return `${name}: ${args.command}`;
  }
  return name;
}

/**
 * Lenient JSON parse: strip trailing human hints that Hermes tools sometimes
 * append (e.g., `{"x":1}\n[Hint: truncated]`). Mirrors Hermes
 * `_json_loads_maybe` (tools.py:187-202).
 */
export function jsonLoadsMaybe(value: string): unknown {
  const text = value.trim();
  try {
    return JSON.parse(text);
  } catch {
    // Try to find first valid JSON object/array via brace matching.
    const first = text.search(/[{[]/);
    if (first < 0) throw new Error('No JSON found');
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = first; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          return JSON.parse(text.slice(first, i + 1));
        }
      }
    }
    throw new Error('Unterminated JSON');
  }
}

export function buildToolStart(
  id: ToolCallId,
  name: string,
  args: Record<string, unknown>,
  editDiff?: EditProposal | null,
): ToolCallStart {
  const kind = getToolKind(name);
  const content: ContentBlock[] = [];
  const locations: { path: string }[] = [];

  if (editDiff) {
    content.push({
      type: 'diff',
      path: editDiff.path,
      oldText: editDiff.oldText,
      newText: editDiff.newText,
    });
    locations.push({ path: editDiff.path });
  } else if (typeof args.path === 'string') {
    locations.push({ path: args.path });
  }

  return {
    sessionUpdate: 'tool_call',
    toolCallId: id,
    title: buildToolTitle(name, args),
    kind,
    status: 'in_progress',
    content,
    locations: locations.length > 0 ? locations : undefined,
    rawInput: args,
  };
}

export function buildToolComplete(
  id: ToolCallId,
  name: string,
  result: string | null,
  args?: Record<string, unknown>,
  _snapshot?: unknown,
): ToolCallProgress {
  let status: ToolStatus = 'completed';
  const content: ContentBlock[] = [];

  if (result !== null && result !== undefined) {
    let isError = false;
    if (POLISHED_TOOLS.has(name.toLowerCase())) {
      // Best-effort: detect Hermes-style error JSON
      try {
        const parsed = jsonLoadsMaybe(result);
        if (parsed && typeof parsed === 'object' && 'error' in (parsed as object)) {
          isError = true;
        }
      } catch {
        // not JSON; fall through
      }
    }
    if (isError) status = 'failed';
    content.push({ type: 'text', text: String(result) });
  }

  // args reserved for future formatting refinements (e.g., showing diff on
  // completion). Currently only used implicitly via raw_input on start.
  void args;

  return {
    sessionUpdate: 'tool_call_update',
    toolCallId: id,
    status,
    content,
  };
}
