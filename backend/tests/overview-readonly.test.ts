import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILES = ['../src/routes/overview.ts'];
const WRITE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|UPSERT|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|COPY|FOR\s+UPDATE)\b/i;

/** Extract every template literal and quoted string from the source. */
function stringLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g;
  for (const m of src.matchAll(re)) out.push(m[0]);
  return out;
}

describe('READ-ONLY GUARD: overview SQL contains no write keywords', () => {
  for (const rel of FILES) {
    it(rel, () => {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
      const literals = stringLiterals(src);
      expect(literals.length).toBeGreaterThan(10);
      const offenders = literals.filter(s => WRITE_KEYWORDS.test(s));
      expect(offenders).toEqual([]);
    });
  }
  it('guard regex catches write keywords', () => {
    expect(WRITE_KEYWORDS.test('SELECT 1 FOR UPDATE')).toBe(true);
    expect(WRITE_KEYWORDS.test('insert into x')).toBe(true);
    expect(WRITE_KEYWORDS.test('SELECT updated_at FROM t')).toBe(false);
  });
});
