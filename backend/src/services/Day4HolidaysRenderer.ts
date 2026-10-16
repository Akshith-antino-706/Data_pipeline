/**
 * Day4HolidaysRenderer
 *
 * Pure renderer for the Day-4 Holidays email. The friend's template uses a
 * richer engine than the day-2/3 templates:
 *   - {{#loop sectionName}}...{{#each row}}...{{/each}}...{{/loop}}
 *       Iterate over data[sectionName], grouped into rows of 2 items.
 *       Inside, {{#each row}} iterates over the row's items.
 *   - {{#list sectionName}}...{{/list}}
 *       Plain iteration (no row grouping).
 *   - {{path.to.value}}, {{arr.0.field}}
 *       Variable substitution with dot/index notation.
 *
 * Faithful port of the team's generator.js (holidays flavor).
 */

import { readFileSync } from 'node:fs';
import type { buildDay4HolidaysData } from './Day4HolidaysDataService.js';

type Day4HolidaysData = Awaited<ReturnType<typeof buildDay4HolidaysData>>;

// ── public API ────────────────────────────────────────────────────────────

export function renderDay4Holidays(templateOrPath: string, data: Day4HolidaysData) {
  const template = typeof templateOrPath === 'string' && templateOrPath.includes('<')
    ? templateOrPath
    : readFileSync(templateOrPath, 'utf8');

  let result = template;

  // ── 1. Loops with row grouping (2-col grids) ───────────────────────────
  // Pattern: {{#loop sectionName}}<tr-template>{{/loop}}
  // Inside, {{#each row}}<cell-template>{{/each}} renders each item in the row.
  const loopRegex = /\{\{#loop\s+(\w+)\}\}([\s\S]*?)\{\{\/loop\}\}/g;
  result = result.replace(loopRegex, (_match: string, sectionName: string, content: string) => {
    const list = (data as Record<string, unknown>)[sectionName];
    if (!Array.isArray(list)) return '';

    // Group list into rows of 2
    const rows: Record<string, string>[][] = [];
    for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2));

    return rows.map(row => {
      const eachRegex = /\{\{#each\s+row\}\}([\s\S]*?)\{\{\/each\}\}/g;
      return content.replace(eachRegex, (_e: string, eachContent: string) => {
        return row.map(item => {
          const itemKeyRegex = /\{\{(\w+)\}\}/g;
          return eachContent.replace(itemKeyRegex, (m: string, key: string) => (item[key] !== undefined ? item[key] : m));
        }).join('');
      });
    }).join('');
  });

  // ── 2. Plain lists ─────────────────────────────────────────────────────
  // Pattern: {{#list sectionName}}<item-template>{{/list}}
  const listRegex = /\{\{#list\s+(\w+)\}\}([\s\S]*?)\{\{\/list\}\}/g;
  result = result.replace(listRegex, (_m: string, sectionName: string, content: string) => {
    const list = (data as Record<string, unknown>)[sectionName];
    if (!Array.isArray(list)) return '';
    const itemKeyRegex = /\{\{(\w+)\}\}/g;
    return list.map(item =>
      content.replace(itemKeyRegex, (m: string, key: string) => (item[key] !== undefined ? item[key] : m))
    ).join('');
  });

  // ── 3. Variable substitution with dot/index notation ────────────────────
  // Pattern: {{path}} or {{obj.key}} or {{arr.0.field}}
  const varRegex = /\{\{([\w.]+)\}\}/g;
  result = result.replace(varRegex, (match: string, path: string) => {
    const keys = path.split('.');
    let value: Record<string, unknown> = data;
    for (const key of keys) {
      if (value && value[key] !== undefined) {
        value = value[key] as Record<string, unknown>;
      } else {
        return match; // leave the placeholder so we can detect issues
      }
    }
    return value as unknown as string;
  });

  return result;
}

export default renderDay4Holidays;
