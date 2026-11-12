// Schedules for src/crons/* are registered in server.ts via node-cron. Importing server.ts would
// boot Express, open DB pools and register ~30 live cron jobs, so instead we read the source as
// text and inspect each cron.schedule(...) block statically. Nothing is executed here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = readFileSync(resolve(here, '../server.ts'), 'utf8').replace(/\r\n/g, '\n');

interface ScheduleInfo { expr: string; timezone: string | null; noOverlap: boolean; body: string }

function scheduleFor(cronModule: string): ScheduleInfo {
  const idx = SERVER.indexOf(`./src/crons/${cronModule}.js`);
  if (idx < 0) throw new Error(`${cronModule} is not referenced in server.ts`);
  const start = SERVER.lastIndexOf('cron.schedule(', idx);
  const head = /^cron\.schedule\('([^']+)'/.exec(SERVER.slice(start, start + 80));
  const optsMatch = /\}, \{([^}]*)\}\);/.exec(SERVER.slice(idx));
  if (!head || !optsMatch) throw new Error(`could not parse schedule for ${cronModule}`);
  const opts = optsMatch[1];
  const tz = /timezone:\s*'([^']+)'/.exec(opts);
  return {
    expr: head[1],
    timezone: tz ? tz[1] : null,
    noOverlap: /noOverlap:\s*true/.test(opts),
    body: SERVER.slice(start, idx + optsMatch.index),
  };
}

const EXPECTED: [string, string][] = [
  ['registrationDataSync', '30 0 * * *'],
  ['dailyJourneyReSnapshot', '30 2 * * *'],
  ['dailyRecommendationCompute', '35 3 * * *'],
  ['dailyCategoryPicksCompute', '45 3 * * *'],
  ['dailyPastTripCompute', '0 4 * * *'],
  ['fxRatesSync', '30 5 * * *'],
  ['contactMarketRefresh', '45 5 * * *'],
  ['weeklyProductUrlHealthCheck', '0 6 * * 1'],
  ['dailyContinuousReEnroll', '0 4 * * *'],
  ['dailySendCounts', '45 0 * * *'],
];

describe('cron schedules registered in server.ts', () => {
  it('imports node-cron as the scheduler', () => {
    expect(SERVER).toMatch(/import cron from 'node-cron';/);
  });

  it.each(EXPECTED)('%s runs at "%s" Asia/Dubai with noOverlap', (mod, expr) => {
    const s = scheduleFor(mod);
    expect(s.expr).toBe(expr);
    expect(s.timezone).toBe('Asia/Dubai');
    expect(s.noOverlap).toBe(true);
  });

  it.each(EXPECTED.map(([m]) => [m]))('%s handler is wrapped in try/catch so a failure never crashes the process', (mod) => {
    const s = scheduleFor(mod);
    expect(s.body).toMatch(/try \{/);
    expect(s.body).toMatch(/catch \(/);
    expect(s.body).toMatch(/console\.error\(/);
  });

  it('registrationDataSync is followed by RegistrationContactSync in the same job', () => {
    const s = scheduleFor('registrationDataSync');
    expect(s.body.indexOf('runRegistrationDataSync()')).toBeLessThan(s.body.indexOf('RegistrationContactSync.run()'));
  });

  it('dependency ordering: re-snapshot → rec compute → category picks → past-trip', () => {
    const toMin = (e: string) => { const [m, h] = e.split(' ').map(Number); return h * 60 + m; };
    const t = (m: string) => toMin(scheduleFor(m).expr);
    expect(t('dailyJourneyReSnapshot')).toBeLessThan(t('dailyRecommendationCompute'));
    expect(t('dailyRecommendationCompute')).toBeLessThan(t('dailyCategoryPicksCompute'));
    expect(t('dailyCategoryPicksCompute')).toBeLessThan(t('dailyPastTripCompute'));
    expect(t('fxRatesSync')).toBeLessThan(t('contactMarketRefresh'));
  });

  it('every cron module is lazily imported inside its job (no top-level side effects at boot)', () => {
    for (const [mod] of EXPECTED) {
      expect(SERVER).toContain(`await import('./src/crons/${mod}.js')`);
    }
  });
});
