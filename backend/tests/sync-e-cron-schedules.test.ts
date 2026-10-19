// Asserts the cron schedule strings + timezone wired in server.ts for every job in src/crons.
// server.ts is NOT imported (it would start Express, crons, workers); its source is parsed
// as text instead, so no timer, socket or DB connection is ever opened.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() }, schedule: vi.fn() }));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverSrc = readFileSync(path.join(root, 'server.ts'), 'utf8');

interface CronBlock { expr: string; body: string; options: string }

// Split server.ts into cron.schedule(...) blocks: expression, body up to the options object.
function cronBlocks(): CronBlock[] {
  const out: CronBlock[] = [];
  const re = /cron\.schedule\('([^']+)',/g;
  const starts: { idx: number; expr: string }[] = [];
  for (let m = re.exec(serverSrc); m; m = re.exec(serverSrc)) starts.push({ idx: m.index, expr: m[1] });
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].idx : serverSrc.length;
    const chunk = serverSrc.slice(s.idx, end);
    const opt = /\},?\s*(\{[^}]*timezone[^}]*\})\);|,\s*(\{[^}]*timezone[^}]*\})\);/.exec(chunk);
    out.push({ expr: s.expr, body: chunk, options: opt ? (opt[1] || opt[2]) : '' });
  });
  return out;
}

const blocks = cronBlocks();
const blockFor = (mod: string): CronBlock | undefined => blocks.find(b => b.body.includes(`./src/crons/${mod}.js`));

const EXPECTED: Record<string, { expr: string; fn: string }> = {
  registrationDataSync:       { expr: '30 0 * * *', fn: 'runRegistrationDataSync' },
  dailyJourneyReSnapshot:     { expr: '30 2 * * *', fn: 'runDailyJourneyReSnapshot' },
  fxRatesSync:                { expr: '30 5 * * *', fn: 'runFxRatesSync' },
  contactMarketRefresh:       { expr: '45 5 * * *', fn: 'runContactMarketRefresh' },
  dailyCategoryPicksCompute:  { expr: '45 3 * * *', fn: 'runDailyCategoryPicksCompute' },
  dailyPastTripCompute:       { expr: '0 4 * * *',  fn: 'runDailyPastTripCompute' },
  dailyRecommendationCompute: { expr: '35 3 * * *', fn: 'runDailyRecommendationCompute' },
  weeklyProductUrlHealthCheck:{ expr: '0 6 * * 1',  fn: 'runWeeklyProductUrlHealthCheck' },
  dailyContinuousReEnroll:    { expr: '0 4 * * *',  fn: 'runDailyContinuousReEnroll' },
};

describe('server.ts cron registrations for src/crons/*', () => {
  it('every file in src/crons has an expected schedule entry', () => {
    const files = readdirSync(path.join(root, 'src/crons')).filter(f => f.endsWith('.ts')).map(f => f.replace(/\.ts$/, ''));
    expect(files.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [mod, exp] of Object.entries(EXPECTED)) {
    it(`${mod} runs at "${exp.expr}" Asia/Dubai with noOverlap and calls ${exp.fn}`, () => {
      const b = blockFor(mod);
      expect(b, `no cron.schedule block imports ${mod}`).toBeDefined();
      expect(b!.expr).toBe(exp.expr);
      expect(b!.options).toMatch(/timezone:\s*'Asia\/Dubai'/);
      expect(b!.options).toMatch(/noOverlap:\s*true/);
      expect(b!.body).toContain(`await ${exp.fn}()`);
      expect(b!.body).toMatch(/catch \(err\)/);   // errors never escape the cron tick
    });
  }

  it('registrationDataSync (00:30 Dubai) is followed by RegistrationContactSync.run()', () => {
    const b = blockFor('registrationDataSync')!;
    expect(b.body.indexOf('runRegistrationDataSync()')).toBeLessThan(b.body.indexOf('RegistrationContactSync.run()'));
  });

  it('every cron.schedule in server.ts uses a valid 5-field expression and the Dubai timezone', () => {
    expect(blocks.length).toBeGreaterThan(10);
    for (const b of blocks) {
      expect(b.expr.split(' ')).toHaveLength(5);
      if (b.options) expect(b.options).toContain("'Asia/Dubai'");
    }
  });

  it('ordering: category picks (3:45) run before past-trip compute (4:00); FX (5:30) before market refresh (5:45)', () => {
    const toMin = (e: string) => { const [m, h] = e.split(' ').map(Number); return h * 60 + m; };
    expect(toMin(EXPECTED.dailyCategoryPicksCompute.expr)).toBeLessThan(toMin(EXPECTED.dailyPastTripCompute.expr));
    expect(toMin(EXPECTED.dailyRecommendationCompute.expr)).toBeLessThan(toMin(EXPECTED.dailyCategoryPicksCompute.expr));
    expect(toMin(EXPECTED.fxRatesSync.expr)).toBeLessThan(toMin(EXPECTED.contactMarketRefresh.expr));
  });
});
