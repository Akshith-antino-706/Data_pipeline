/**
 * Day5ActivitiesRenderer
 *
 * Pure renderer for the Day-5 Activities email. The friend's template uses
 * a richer engine than day-2/3/4:
 *
 *   <!-- @chunk-loop ARRAY_PATH SIZE -->
 *     <tr>
 *       <!-- @loop chunk -->
 *         {{item.field}}
 *         {{#if @last}}<sep/>{{else}}<sep-with-bar/>{{/if}}
 *       <!-- @endloop -->
 *     </tr>
 *   <!-- @endchunkloop -->
 *
 *   <!-- @loop ARRAY_PATH -->
 *     {{item.field}}
 *     {{#if @last}}{{else}}{{/if}}
 *   <!-- @endloop -->
 *
 *   {{path.to.value}}     -- final pass after loops
 *
 * Faithful port of the team's generate.js (activities flavor).
 */

import { readFileSync } from 'node:fs';

function getValue(obj, path) {
  return path.split('.').reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
}

function processLoops(template, data) {
  // 1. Chunk loops first (they nest @loop chunk inside)
  let processed = template.replace(
    /<!-- @chunk-loop ([\w.]+) (\d+) -->([\s\S]*?)<!-- @endchunkloop -->/g,
    (_match, arrayPath, sizeStr, content) => {
      const arr = getValue(data, arrayPath);
      if (!Array.isArray(arr)) return '';
      const size = parseInt(sizeStr, 10);

      const chunks = [];
      for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));

      return chunks.map(chunk => {
        return content.replace(
          /<!-- @loop chunk -->([\s\S]*?)<!-- @endloop -->/g,
          (_m, innerContent) => {
            return chunk.map((item, index) => {
              let html = innerContent.replace(
                /\{\{item\.([\w.]+)\}\}/g,
                (_im, key) => {
                  const v = getValue(item, key);
                  return v != null ? String(v) : '';
                }
              );
              // {{#if @last}}A{{else}}B{{/if}} — based on chunk position
              html = html.replace(
                /\{\{#if @last\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
                (_cm, ifVal, elseVal) => (index === chunk.length - 1 ? ifVal : elseVal)
              );
              return html;
            }).join('');
          }
        );
      }).join('');
    }
  );

  // 2. Plain @loop arrays
  processed = processed.replace(
    /<!-- @loop ([\w.]+) -->([\s\S]*?)<!-- @endloop -->/g,
    (_match, arrayPath, content) => {
      const arr = getValue(data, arrayPath);
      if (!Array.isArray(arr)) return '';
      return arr.map((item, index) => {
        let html = content.replace(
          /\{\{item\.([\w.]+)\}\}/g,
          (_im, key) => {
            const v = getValue(item, key);
            return v != null ? String(v) : '';
          }
        );
        html = html.replace(
          /\{\{#if @last\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
          (_cm, ifVal, elseVal) => (index === arr.length - 1 ? ifVal : elseVal)
        );
        return html;
      }).join('');
    }
  );

  return processed;
}

// ── public API ────────────────────────────────────────────────────────────

export function renderDay5Activities(templateOrPath, data) {
  const template = typeof templateOrPath === 'string' && templateOrPath.includes('<')
    ? templateOrPath
    : readFileSync(templateOrPath, 'utf8');

  let result = processLoops(template, data);

  // Final pass: simple {{path.to.value}}
  result = result.replace(/\{\{([\w.]+)\}\}/g, (match, path) => {
    const v = getValue(data, path);
    return v != null ? String(v) : match;
  });

  return result;
}

export const _internals = { processLoops, getValue };
export default renderDay5Activities;
