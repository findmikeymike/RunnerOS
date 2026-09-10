import { parseStructuredStepOutput } from '../../../shared/src/workflows/output-schema';
import type { JsonSchema } from '../../../shared/src/workflows/types';

const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finiteJson(value: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => finiteJson(item, depth + 1));
  if (object(value)) return Object.values(value).every(item => finiteJson(item, depth + 1));
  return value === null || typeof value === 'string' || typeof value === 'boolean';
}

/** Certify only schema keywords actually enforced by the existing workflow validator. */
export function supportsDurableOutputSchema(schema: unknown, depth = 0): schema is JsonSchema {
  if (depth > 24 || !object(schema) || typeof schema.type !== 'string' || !types.has(schema.type)
    || Object.keys(schema).some(key => !['type', 'enum', 'properties', 'required', 'items'].includes(key))) return false;
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length
    || schema.enum.some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value)
      || typeof value === 'number' && !Number.isFinite(value)))) return false;
  if (schema.properties !== undefined && (schema.type !== 'object' || !object(schema.properties)
    || Object.entries(schema.properties).some(([key, child]) => reserved.has(key) || !supportsDurableOutputSchema(child, depth + 1)))) return false;
  if (schema.required !== undefined && (schema.type !== 'object' || !Array.isArray(schema.required)
    || new Set(schema.required).size !== schema.required.length
    || schema.required.some(key => typeof key !== 'string' || reserved.has(key) || !object(schema.properties) || !own(schema.properties, key)))) return false;
  if (schema.items !== undefined && (schema.type !== 'array' || !supportsDurableOutputSchema(schema.items, depth + 1))) return false;
  return true;
}

/** Saved text is the replay authority; parse only against its frozen declared schema. */
export function durableStepOutput(text: string, schema?: JsonSchema): unknown {
  if (!schema) return text;
  if (!supportsDurableOutputSchema(schema)) throw new Error('unsupported-durable-output-schema');
  const parsed = parseStructuredStepOutput(text, schema);
  if (!parsed.ok) throw new Error(`durable-output-${parsed.code}`);
  if (!finiteJson(parsed.value)) throw new Error('durable-output-invalid-json-value');
  return parsed.value;
}

export function supportsDurableOutputPath(schema: JsonSchema | undefined, path: string[]): boolean {
  if (!path.length) return true;
  let current: unknown = schema;
  for (const key of path) {
    if (!object(current) || reserved.has(key)) return false;
    if (current.type === 'object' && object(current.properties) && own(current.properties, key)) current = current.properties[key];
    else if (current.type === 'array' && /^(0|[1-9][0-9]*)$/.test(key)) current = current.items;
    else return false;
  }
  return object(current);
}
