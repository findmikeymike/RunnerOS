import type { JsonSchema } from './types.ts';

export type StructuredOutputParseResult =
  | {
    ok: true;
    value: unknown;
  }
  | {
    ok: false;
    code: 'invalid-json' | 'schema-validation-failed';
    message: string;
  };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isValidWorkflowOutputSchema(value: unknown): value is JsonSchema {
  return isPlainObject(value) && typeof value.type === 'string';
}

function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function validateType(value: unknown, expected: unknown): boolean {
  const types = Array.isArray(expected) ? expected : [expected];
  return types.some((type) => {
    if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return isPlainObject(value);
    return valueType(value) === type;
  });
}

function validateAgainstSchema(value: unknown, schema: JsonSchema, path = '$'): string[] {
  const errors: string[] = [];

  if (schema.type !== undefined && !validateType(value, schema.type)) {
    const expected = Array.isArray(schema.type) ? schema.type.join(' | ') : String(schema.type);
    errors.push(`${path} must be ${expected}; got ${valueType(value)}`);
    return errors;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${path} must be one of ${schema.enum.map(String).join(', ')}`);
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path} must contain at least ${schema.minLength} characters`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path} must contain at most ${schema.maxLength} characters`);
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path} must match ${schema.pattern}`);
      } catch {
        errors.push(`${path} has an invalid schema pattern`);
      }
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
  }

  if (isPlainObject(value)) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} is required`);
    }

    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    for (const [key, propSchema] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(value, key) || !isPlainObject(propSchema)) continue;
      errors.push(...validateAgainstSchema(value[key], propSchema, `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push(`${path}.${key} is not allowed`);
      }
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      errors.push(`${path} must contain unique items`);
    }
    if (isPlainObject(schema.items)) {
      value.forEach((item, index) => {
        errors.push(...validateAgainstSchema(item, schema.items as JsonSchema, `${path}[${index}]`));
      });
    }
  }

  return errors;
}

export function parseStructuredStepOutput(
  text: string,
  schema: JsonSchema,
): StructuredOutputParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(text));
  } catch (err) {
    return {
      ok: false,
      code: 'invalid-json',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const errors = validateAgainstSchema(parsed, schema);
  if (errors.length > 0) {
    return {
      ok: false,
      code: 'schema-validation-failed',
      message: errors.join('; '),
    };
  }

  return { ok: true, value: parsed };
}

export function appendOutputSchemaInstruction(prompt: string, schema: JsonSchema): string {
  return [
    prompt.trimEnd(),
    '',
    'Your final reply MUST be valid JSON matching this JSON Schema. Return only JSON, with no prose or markdown fences.',
    JSON.stringify(schema, null, 2),
  ].join('\n');
}
