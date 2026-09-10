import { expect, test } from 'bun:test';
import { durableStepOutput, supportsDurableOutputSchema, supportsDurableOutputPath } from './durable-workflow-output-schema';

const schema = { type: 'object', required: ['title', 'items'], properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'object', required: ['count'], properties: { count: { type: 'integer' } } } } } };
test('certified schema validates JSON and fenced JSON with required nested fields', () => {
  expect(supportsDurableOutputSchema(schema)).toBe(true);
  expect(durableStepOutput('```json\n{"title":"release","items":[{"count":2}]}\n```', schema)).toEqual({ title: 'release', items: [{ count: 2 }] });
  for (const value of ['not json', '{}', '{"title":false,"items":[]}', '{"title":"a","items":[{"count":1.5}]}']) expect(() => durableStepOutput(value, schema)).toThrow();
});
test('unsupported schema promises and unsafe paths reject before execution', () => {
  for (const value of [{ type: 'string', minLength: 5 }, { type: 'object', additionalProperties: false }, { type: 'object', required: ['absent'] }, { type: 'string', pattern: 'safe' }, { type: ['string', 'null'] }, { type: 'object', properties: { constructor: { type: 'string' } } }, { type: 'object', enum: [{}] }]) expect(supportsDurableOutputSchema(value)).toBe(false);
  expect(supportsDurableOutputPath(schema, ['items', '0', 'count'])).toBe(true);
  for (const path of [['missing'], ['items', 'count'], ['items', '0', 'constructor'], ['title', 'length']]) expect(supportsDurableOutputPath(schema, path)).toBe(false);
  expect(supportsDurableOutputPath(undefined, ['title'])).toBe(false);
});
test('schema recursion is bounded', () => {
  let nested: Record<string, unknown> = { type: 'string' };
  for (let i = 0; i < 30; i++) nested = { type: 'array', items: nested };
  expect(supportsDurableOutputSchema(nested)).toBe(false);
  expect(() => durableStepOutput('{"extra":1e999}', { type: 'object' })).toThrow('invalid-json-value');
});
