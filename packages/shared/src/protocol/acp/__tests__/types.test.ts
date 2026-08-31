/**
 * Tests for ACP types, tool kind mapping, and lenient JSON parse.
 * Ported in spirit from Hermes hermes_acp/tests/ (MIT).
 */

import { describe, expect, test } from 'bun:test';
import { getToolKind, buildToolStart, buildToolComplete, jsonLoadsMaybe } from '../tools.ts';

describe('tools.getToolKind', () => {
  test('maps read_file → read', () => {
    expect(getToolKind('read_file')).toBe('read');
  });
  test('maps write_file → edit', () => {
    expect(getToolKind('write_file')).toBe('edit');
  });
  test('maps patch → edit', () => {
    expect(getToolKind('patch')).toBe('edit');
  });
  test('maps terminal → execute', () => {
    expect(getToolKind('terminal')).toBe('execute');
  });
  test('maps process → execute', () => {
    expect(getToolKind('process')).toBe('execute');
  });
  test('maps execute_code → execute', () => {
    expect(getToolKind('execute_code')).toBe('execute');
  });
  test('unknown_tool → other', () => {
    expect(getToolKind('unknown_tool')).toBe('other');
  });
});

describe('tools.buildToolStart', () => {
  test('emits ToolCallStart with locations for path args', () => {
    const start = buildToolStart('tc-1', 'read_file', { path: '/etc/hosts' });
    expect(start.sessionUpdate).toBe('tool_call');
    expect(start.kind).toBe('read');
    expect(start.title).toBe('read: /etc/hosts');
    expect(start.locations).toEqual([{ path: '/etc/hosts' }]);
  });

  test('emits diff content when editDiff provided', () => {
    const start = buildToolStart(
      'tc-2',
      'write_file',
      { path: '/tmp/x' },
      { toolName: 'write_file', path: '/tmp/x', oldText: 'a', newText: 'b', arguments: {} },
    );
    expect(start.content[0]).toEqual({ type: 'diff', path: '/tmp/x', oldText: 'a', newText: 'b' });
  });
});

describe('tools.buildToolComplete', () => {
  test('completed status when result is plain text', () => {
    const c = buildToolComplete('tc-1', 'read_file', 'file contents');
    expect(c.status).toBe('completed');
    expect(c.content?.[0]).toEqual({ type: 'text', text: 'file contents' });
  });

  test('failed status when polished tool emits error JSON', () => {
    const c = buildToolComplete('tc-1', 'read_file', '{"error":"oops"}');
    expect(c.status).toBe('failed');
  });
});

describe('tools.jsonLoadsMaybe', () => {
  test('parses pure JSON', () => {
    expect(jsonLoadsMaybe('{"x":1}')).toEqual({ x: 1 });
  });

  test('strips trailing human hint', () => {
    const data = jsonLoadsMaybe('{"x":1}\n[Hint: truncated]');
    expect(data).toEqual({ x: 1 });
  });

  test('strips leading whitespace and trailing prose', () => {
    expect(jsonLoadsMaybe('  {"a":[1,2,3]}  extra prose here ')).toEqual({ a: [1, 2, 3] });
  });
});
