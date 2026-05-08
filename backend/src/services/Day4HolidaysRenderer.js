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

// ── public API ────────────────────────────────────────────────────────────

export function renderDay4Holidays(templateOrPath, data) {
  const template = typeof templateOrPath === 'string' && templateOrPath.includes('<')
    ? templateOrPath
    : readFileSync(templateOrPath, 'utf8');

  let result = template;

  // ── 1. Loops with row grouping (2-col grids) ───────────────────────────
  // Pattern: {{#loop sectionName}}<tr-template>{{/loop}}
  // Inside, {{#each row}}<cell-template>{{/each}} renders each item in the row.
  const loopRegex = /\{\{#loop\s+(\w+)\}\}([\s\S]*?)\{\{\/loop\}\}/g;
  result = result.replace(loopRegex, (_match, sectionName, content) => {
    const list = data[sectionName];
    if (!Array.isArray(list)) return '';

    // Group list into rows of 2
    const rows = [];
    for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2));

    return rows.map(row => {
      const eachRegex = /\{\{#each\s+row\}\}([\s\S]*?)\{\{\/each\}\}/g;
      return content.replace(eachRegex, (_e, eachContent) => {
        return row.map(item => {
          const itemKeyRegex = /\{\{(\w+)\}\}/g;
          return eachContent.replace(itemKeyRegex, (m, key) => (item[key] !== undefined ? item[key] : m));
        }).join('');
      });
    }).join('');
  });

  // ── 2. Plain lists ─────────────────────────────────────────────────────
  // Pattern: {{#list sectionName}}<item-template>{{/list}}
  const listRegex = /\{\{#list\s+(\w+)\}\}([\s\S]*?)\{\{\/list\}\}/g;
  result = result.replace(listRegex, (_m, sectionName, content) => {
    const list = data[sectionName];
    if (!Array.isArray(list)) return '';
    const itemKeyRegex = /\{\{(\w+)\}\}/g;
    return list.map(item =>
      content.replace(itemKeyRegex, (m, key) => (item[key] !== undefined ? item[key] : m))
    ).join('');
  });

  // ── 3. Variable substitution with dot/index notation ────────────────────
  // Pattern: {{path}} or {{obj.key}} or {{arr.0.field}}
  const varRegex = /\{\{([\w.]+)\}\}/g;
  result = result.replace(varRegex, (match, path) => {
    const keys = path.split('.');
    let value = data;
    for (const key of keys) {
      if (value && value[key] !== undefined) {
        value = value[key];
      } else {
        return match; // leave the placeholder so we can detect issues
      }
    }
    return value;
  });

  return result;
}

export default renderDay4Holidays;
