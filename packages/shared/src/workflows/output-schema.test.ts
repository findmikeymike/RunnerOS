import { describe, expect, test } from 'bun:test';
import {
  appendOutputSchemaInstruction,
  isValidWorkflowOutputSchema,
  parseStructuredStepOutput,
} from './output-schema.ts';

describe('workflow output schema helpers', () => {
  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      count: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['title', 'count'],
  };

  test('accepts JSON Schema objects with a type', () => {
    expect(isValidWorkflowOutputSchema(schema)).toBe(true);
    expect(isValidWorkflowOutputSchema({ properties: {} })).toBe(false);
    expect(isValidWorkflowOutputSchema(null)).toBe(false);
  });

  test('parses and validates structured output', () => {
    const got = parseStructuredStepOutput(
      '{"title":"Draft","count":3,"tags":["a"]}',
      schema,
    );
    expect(got).toEqual({ ok: true, value: { title: 'Draft', count: 3, tags: ['a'] } });
  });

  test('parses fenced JSON output', () => {
    const got = parseStructuredStepOutput(
      '```json\n{"title":"Draft","count":3}\n```',
      schema,
    );
    expect(got.ok).toBe(true);
  });

  test('rejects invalid JSON and schema mismatches', () => {
    expect(parseStructuredStepOutput('not json', schema)).toMatchObject({ ok: false, code: 'invalid-json' });
    expect(parseStructuredStepOutput('{"title":9}', schema)).toMatchObject({
      ok: false,
      code: 'schema-validation-failed',
    });
  });

  test('appends structured-output instruction to prompts', () => {
    const prompt = appendOutputSchemaInstruction('Do it.', schema);
    expect(prompt).toContain('Return only JSON');
    expect(prompt).toContain('"title"');
  });
});


test('schema properties inspect own JSON fields rather than inherited Object members', () => {
  const optional = { type: 'object', properties: { toString: { type: 'string' } } };
  expect(parseStructuredStepOutput('{}', optional)).toEqual({ ok: true, value: {} });
  expect(parseStructuredStepOutput('{}', { ...optional, required: ['toString'] })).toMatchObject({ ok: false, code: 'schema-validation-failed' });
  expect(parseStructuredStepOutput('{"toString":"own value"}', { ...optional, required: ['toString'] })).toEqual({ ok: true, value: { toString: 'own value' } });
  expect(parseStructuredStepOutput('{"toString":42}', optional)).toMatchObject({ ok: false, code: 'schema-validation-failed' });
});

test('nested schema required fields cannot be satisfied by inherited methods', () => {
  const schema = { type: 'object', properties: { nested: { type: 'object', properties: { valueOf: { type: 'string' } }, required: ['valueOf'] } }, required: ['nested'] };
  expect(parseStructuredStepOutput('{"nested":{}}', schema)).toMatchObject({ ok: false, code: 'schema-validation-failed' });
  expect(parseStructuredStepOutput('{"nested":{"valueOf":"present"}}', schema).ok).toBe(true);
});
