/**
 * Minimal mustache-style template engine.
 *
 * Supported:
 *   {{ path }}            escaped interpolation
 *   {{{ path }}}          raw interpolation
 *   {{#if path}} … {{else}} … {{/if}}
 *   {{#each path}} … {{/each}}   ({{this}}, {{this.field}}, {{@index}} inside)
 *   {{> partialName}}
 *   {{! comment }}
 *
 * Deliberately tiny: no bundler, no dependencies, no arbitrary expressions.
 * Anything more complex belongs in the render model, not the template.
 */

const TOKEN = /\{\{\{\s*([^{}]*?)\s*\}\}\}|\{\{([#/>!]?)\s*([^{}]*?)\s*\}\}/g;

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parse(source) {
  const root = { type: 'root', body: [] };
  const stack = [root];

  const push = (node) => {
    const top = stack[stack.length - 1];
    const target = top.type === 'if' && top.inAlt ? top.alt : top.body;
    target.push(node);
  };
  const text = (value) => { if (value) push({ type: 'text', value }); };

  let cursor = 0;
  let match;
  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(source)) !== null) {
    text(source.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const [, rawPath, sigil, body] = match;
    if (rawPath !== undefined) {
      push({ type: 'var', path: rawPath.trim(), raw: true });
      continue;
    }

    const content = body.trim();
    if (sigil === '!') continue;
    if (sigil === '>') { push({ type: 'partial', name: content }); continue; }

    if (sigil === '#') {
      const spaceAt = content.search(/\s/);
      const keyword = spaceAt === -1 ? content : content.slice(0, spaceAt);
      const path = spaceAt === -1 ? '' : content.slice(spaceAt).trim();
      if (keyword !== 'if' && keyword !== 'each') {
        throw new Error(`Unknown block helper: ${keyword}`);
      }
      const node = keyword === 'if'
        ? { type: 'if', path, body: [], alt: [], inAlt: false }
        : { type: 'each', path, body: [] };
      push(node);
      stack.push(node);
      continue;
    }

    if (sigil === '/') {
      if (stack.length === 1) throw new Error(`Unbalanced closing tag: {{/${content}}}`);
      stack.pop();
      continue;
    }

    if (content === 'else') {
      const top = stack[stack.length - 1];
      if (top.type !== 'if') throw new Error('{{else}} outside of {{#if}}');
      top.inAlt = true;
      continue;
    }

    push({ type: 'var', path: content, raw: false });
  }
  text(source.slice(cursor));

  if (stack.length !== 1) throw new Error('Unclosed template block');
  return root;
}

function resolve(path, scopes) {
  if (!path || path === 'this' || path === '.') return scopes[scopes.length - 1];
  const parts = path.replace(/^this\./, '').split('.');
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    let value = scopes[i];
    let ok = true;
    for (const part of parts) {
      if (value === null || value === undefined || typeof value !== 'object' || !(part in value)) {
        ok = false;
        break;
      }
      value = value[part];
    }
    if (ok) return value;
  }
  return undefined;
}

function truthy(value) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function evaluate(nodes, scopes, partials) {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += node.value;
        break;
      case 'var': {
        const value = resolve(node.path, scopes);
        if (value === undefined || value === null || value === false) break;
        out += node.raw ? String(value) : escapeHtml(value);
        break;
      }
      case 'if':
        out += truthy(resolve(node.path, scopes))
          ? evaluate(node.body, scopes, partials)
          : evaluate(node.alt, scopes, partials);
        break;
      case 'each': {
        const list = resolve(node.path, scopes);
        if (!Array.isArray(list)) break;
        list.forEach((item, index) => {
          const scope = item !== null && typeof item === 'object'
            ? { ...item, '@index': index, '@first': index === 0, '@last': index === list.length - 1 }
            : item;
          out += evaluate(node.body, [...scopes, scope], partials);
        });
        break;
      }
      case 'partial': {
        const partial = partials[node.name];
        if (partial === undefined) throw new Error(`Missing partial: ${node.name}`);
        out += evaluate(partial, scopes, partials);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

const cache = new Map();

function compile(source) {
  let ast = cache.get(source);
  if (!ast) {
    ast = parse(source);
    cache.set(source, ast);
  }
  return ast;
}

export function render(source, data, partialSources = {}) {
  const partials = {};
  for (const [name, value] of Object.entries(partialSources)) {
    partials[name] = compile(value).body;
  }
  return evaluate(compile(source).body, [data], partials);
}
