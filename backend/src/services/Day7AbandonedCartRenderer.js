/**
 * Day7AbandonedCartRenderer
 *
 * Mustache-style renderer ported from the team's generator.js. Supports:
 *   {{path.to.value}}   — escaped substitution (we don't actually escape since
 *                          downstream values are HTML-safe; matches generator)
 *   {{{path.to.value}}} — raw HTML substitution
 *   {{.}}               — current loop primitive value
 *   {{#list path}}…{{/list}} — iterate array; nested context with _parent chain
 *   {{#if path}}…{{/if}}     — render block only when truthy (non-empty array)
 */

import { readFileSync } from 'node:fs';

function getValue(p, ctx) {
  if (p === '.') return ctx['.'];
  const keys = p.split('.');
  let value = ctx;
  for (const k of keys) {
    if (value && value[k] !== undefined) {
      value = value[k];
    } else if (value && value._parent) {
      return getValue(p, value._parent);
    } else {
      return undefined;
    }
  }
  return value;
}

function replaceVars(str, ctx) {
  // {{{path}}} — raw
  str = str.replace(/\{\{\{([\w.]+)\}\}\}/g, (m, p) => {
    const v = getValue(p, ctx);
    return v !== undefined ? String(v) : m;
  });
  // {{path}} or {{.}}
  str = str.replace(/\{\{([\w.]+|\.)\}\}/g, (m, p) => {
    const v = getValue(p, ctx);
    return v !== undefined ? String(v) : m;
  });
  return str;
}

function processBlocks(str, ctx) {
  let result = '';
  let lastIndex = 0;
  const blockStartRegex = /\{\{#(list|if)\s+([\w.]+)\}\}/g;
  let m;

  while ((m = blockStartRegex.exec(str)) !== null) {
    result += replaceVars(str.substring(lastIndex, m.index), ctx);

    const type = m[1];
    const path = m[2];
    const contentStart = m.index + m[0].length;

    let depth = 1;
    let cursor = contentStart;
    let endIndex = -1;
    const openTag  = `{{#${type}`;
    const closeTag = `{{/${type}}}`;

    while (depth > 0) {
      const ns = str.indexOf(openTag, cursor);
      const ne = str.indexOf(closeTag, cursor);
      if (ne === -1) break;
      if (ns !== -1 && ns < ne) {
        depth++;
        cursor = ns + openTag.length;
      } else {
        depth--;
        if (depth === 0) endIndex = ne;
        else             cursor = ne + closeTag.length;
      }
    }

    if (endIndex !== -1) {
      const inner = str.substring(contentStart, endIndex);
      const data  = getValue(path, ctx);

      if (type === 'list') {
        if (Array.isArray(data)) {
          result += data.map(item => {
            const itemCtx = (item !== null && typeof item === 'object')
              ? { ...item, _parent: ctx }
              : { '.': item, _parent: ctx };
            return processBlocks(inner, itemCtx);
          }).join('');
        }
      } else if (type === 'if') {
        const truthy = !!data && (!Array.isArray(data) || data.length > 0);
        if (truthy) result += processBlocks(inner, ctx);
      }

      lastIndex = endIndex + closeTag.length;
      blockStartRegex.lastIndex = lastIndex;
    } else {
      lastIndex = contentStart;
    }
  }

  result += replaceVars(str.substring(lastIndex), ctx);
  return result;
}

export function renderDay7AbandonedCart(templateOrPath, data) {
  const template = typeof templateOrPath === 'string' && templateOrPath.includes('<')
    ? templateOrPath
    : readFileSync(templateOrPath, 'utf8');
  return processBlocks(template, data);
}

export const _internals = { getValue, replaceVars, processBlocks };
export default renderDay7AbandonedCart;
