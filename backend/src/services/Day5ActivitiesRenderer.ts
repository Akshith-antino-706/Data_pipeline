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
import type { buildDay5ActivitiesData } from './Day5ActivitiesDataService.js';

type Day5ActivitiesData = Awaited<ReturnType<typeof buildDay5ActivitiesData>>;

function getValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc != null ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

function processLoops(template: string, data: unknown) {
  // 1. Chunk loops first (they nest @loop chunk inside)
  let processed = template.replace(
    /<!-- @chunk-loop ([\w.]+) (\d+) -->([\s\S]*?)<!-- @endchunkloop -->/g,
    (_match: string, arrayPath: string, sizeStr: string, content: string) => {
      const arr = getValue(data, arrayPath);
      if (!Array.isArray(arr)) return '';
      const parsedSize = parseInt(sizeStr, 10);
      const size = Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : 1;

      const chunks: unknown[][] = [];
      for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));

      return chunks.map(chunk => {
        return content.replace(
          /<!-- @loop chunk -->([\s\S]*?)<!-- @endloop -->/g,
          (_m: string, innerContent: string) => {
            return chunk.map((item, index) => {
              let html = innerContent.replace(
                /\{\{item\.([\w.]+)\}\}/g,
                (_im: string, key: string) => {
                  const v = getValue(item, key);
                  return v != null ? String(v) : '';
                }
              );
              // {{#if @last}}A{{else}}B{{/if}} — based on chunk position
              html = html.replace(
                /\{\{#if @last\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
                (_cm: string, ifVal: string, elseVal: string) => (index === chunk.length - 1 ? ifVal : elseVal)
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
    (_match: string, arrayPath: string, content: string) => {
      const arr = getValue(data, arrayPath);
      if (!Array.isArray(arr)) return '';
      return arr.map((item, index) => {
        let html = content.replace(
          /\{\{item\.([\w.]+)\}\}/g,
          (_im: string, key: string) => {
            const v = getValue(item, key);
            return v != null ? String(v) : '';
          }
        );
        html = html.replace(
          /\{\{#if @last\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
          (_cm: string, ifVal: string, elseVal: string) => (index === arr.length - 1 ? ifVal : elseVal)
        );
        return html;
      }).join('');
    }
  );

  return processed;
}

// ── public API ────────────────────────────────────────────────────────────

export function renderDay5Activities(templateOrPath: string, data: Day5ActivitiesData) {
  const template = typeof templateOrPath === 'string' && templateOrPath.includes('<')
    ? templateOrPath
    : readFileSync(templateOrPath, 'utf8');

  let result = processLoops(template, data);

  // Final pass: simple {{path.to.value}}
  result = result.replace(/\{\{([\w.]+)\}\}/g, (match: string, path: string) => {
    const v = getValue(data, path);
    return v != null ? String(v) : match;
  });

  return result;
}

export const _internals = { processLoops, getValue };
export default renderDay5Activities;
