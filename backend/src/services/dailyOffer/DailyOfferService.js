/**
 * DailyOfferService — creates and checks the automated daily offer email.
 *
 *   9:00 AM Dubai  runCreate()      download feed → pick → test-render → save template +
 *                                   journey (Draft, no start time). Retried every 30 min
 *                                   until 2 PM while today's journey doesn't exist.
 *   3:45 PM Dubai  runFinalCheck()  re-download feed, refresh products/prices, re-check
 *                                   everything → set scheduled_start_at = 4 PM. The
 *                                   existing per-minute auto-start cron sends it.
 *
 * Anything wrong → that day's email is NOT sent and the reason is logged (and written
 * into the journey description when a journey exists). Fail-safe: a journey without a
 * start time never sends.
 *
 * No feed data is stored. The only writes are the same rows a person creates by hand
 * (1 template + 1 journey); the product snapshot lives in the journey's email node.
 */
import dbDefault from '../../config/database.js';
import { getDailyOfferConfig, dubaiDate, dubaiInstant, dubaiMinutes, hhmmToMinutes } from './config.js';
import { fetchFeed as fetchFeedDefault, FeedError, isUsable } from './feed.js';
import { pickForLoopDay, nextLoopDay, LOOP } from './picker.js';
import { buildTemplate, buildSubject, applyMarket, renderProblems, DAILY_OFFER_MARKER } from './render.js';

export const CREATED_BY = 'daily-offer-automation';
const STARTED = new Set(['active', 'completed', 'paused']);

// Markets every email is test-rendered for before it may be saved or sent.
export const PREVIEW_MARKETS = {
  india: { label: 'India', plan: 'IN', currency: 'INR' },
  uae:   { label: 'UAE', plan: 'AE', currency: 'AED' },
  saudi: { label: 'Saudi Arabia', plan: 'SA', currency: 'SAR' },
  other: { label: 'Other country (USD)', plan: 'default', currency: 'USD' },
  none:  { label: 'No mobile country (AED)', plan: 'default', currency: 'AED' },
};

class SkipError extends Error {
  constructor(reason, message) { super(message); this.reason = reason; }
}

/** "2026-11-01" → "1st November". */
export function ordinalDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDate();
  const suffix = (day % 100 >= 11 && day % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th');
  return `${day}${suffix} ${d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })}`;
}

/** The email node's daily-offer label, or null. */
export function offerLabelOf(journey) {
  const node = (journey?.nodes || []).find(n => n?.data?.dailyOffer);
  return node ? { node, label: node.data.dailyOffer } : null;
}

export default class DailyOfferService {
  constructor({ db = dbDefault, fetchFeed = fetchFeedDefault, config = getDailyOfferConfig(), services = null, log = console } = {}) {
    this.db = db;
    this.fetchFeed = fetchFeed;
    this.config = config;
    this._services = services;     // { ContentService, JourneyService } — injectable for tests
    this.log = log;
  }

  async services() {
    if (!this._services) {
      const [{ ContentService }, { default: JourneyService }] = await Promise.all([
        import('../ContentService.js'), import('../JourneyService.js'),
      ]);
      this._services = { ContentService, JourneyService };
    }
    return this._services;
  }

  // ── Reads ──────────────────────────────────────────────────────────────

  /** Recent daily-offer journeys, newest first. */
  async recentJourneys(limit = 40) {
    const { rows } = await this.db.query(
      `SELECT journey_id, name, status, scheduled_start_at, snapshot_count, custom_segment_id, nodes
         FROM journey_flows
        WHERE nodes @> '[{"data":{"dailyOffer":{}}}]'::jsonb
        ORDER BY journey_id DESC
        LIMIT $1`, [limit]);
    return rows;
  }

  /** Loop position + "previous" info for the picker, from journeys that actually sent. */
  async planToday(recent) {
    const sent = recent.filter(j => STARTED.has(j.status) && offerLabelOf(j));
    const last = sent[0] ? offerLabelOf(sent[0]).label : null;
    const loopDay = nextLoopDay(last?.loopDay);
    const theme = LOOP.find(s => s.loopDay === loopDay).theme;
    const sameTheme = sent.map(j => offerLabelOf(j).label).find(l => l.theme === theme);
    const lastActivities = sent.map(j => offerLabelOf(j).label).find(l => l.theme === 'activities');
    return {
      loopDay,
      previous: {
        productKeys: sameTheme?.productKeys || [],
        activityCursor: Number.isInteger(lastActivities?.activityCursor) ? lastActivities.activityCursor : null,
      },
    };
  }

  async loadRates() {
    const { rows } = await this.db.query('SELECT currency, aed_to_currency, updated_at FROM fx_rates');
    const rates = { AED: 1 };
    const updated = {};
    for (const r of rows) {
      const cur = String(r.currency).toUpperCase();
      rates[cur] = Number(r.aed_to_currency);
      updated[cur] = r.updated_at ? new Date(r.updated_at) : null;
    }
    return { rates, updated };
  }

  /** INR and SAR must have a rate refreshed within maxFxAgeHours. */
  checkRates({ rates, updated }, now) {
    for (const cur of ['INR', 'SAR']) {
      if (!(rates[cur] > 0)) throw new SkipError('fx_missing', `No ${cur} exchange rate`);
      const age = updated[cur] ? (now - updated[cur]) / 3600000 : Infinity;
      if (age > this.config.maxFxAgeHours) {
        throw new SkipError('fx_stale', `${cur} exchange rate is ${Math.round(age)} hours old`);
      }
    }
  }

  async checkSegment() {
    const { rows: [seg] } = await this.db.query(
      'SELECT id, name, is_active FROM custom_segments WHERE id = $1', [this.config.segmentId]);
    if (!seg) throw new SkipError('segment_missing', `Segment ${this.config.segmentId} not found`);
    if (seg.is_active === false) throw new SkipError('segment_inactive', `Segment "${seg.name}" is switched off`);
    return seg;
  }

  // ── Build + check ──────────────────────────────────────────────────────

  /** Template HTML, subject and the node snapshot for a pick. */
  build(pick) {
    const html = buildTemplate(pick);
    const subject = buildSubject(pick);
    const products = pick.groups.flatMap(g => g.products).map(p => ({ key: p.key, name: p.name, prices: p.prices }));
    const groups = pick.groups.map(g => ({ title: g.title, subtitle: g.subtitle, keys: g.products.map(p => p.key) }));
    return { html, subject, products, groups };
  }

  /** Test-render for every preview market; throws SkipError on any problem. */
  testRender(built, rates) {
    for (const [key, m] of Object.entries(PREVIEW_MARKETS)) {
      const out = applyMarket({ html: built.html, subject: built.subject }, built.products, m, rates);
      const problems = renderProblems(out);
      if (problems.length) throw new SkipError('render_failed', `${m.label} email: ${problems.join(', ')}`);
      if (key === 'india' && rates.INR > 0 && out.currency !== 'INR') {
        throw new SkipError('render_failed', 'India email did not render in INR');
      }
    }
  }

  checkCount(pick) {
    if (pick.count < this.config.minProducts) {
      throw new SkipError('too_few_products', `Only ${pick.count} good products for ${pick.themeName} (minimum ${this.config.minProducts})`);
    }
  }

  // ── 9 AM: create ───────────────────────────────────────────────────────

  async runCreate({ now = new Date() } = {}) {
    const today = dubaiDate(now);
    try {
      const recent = await this.recentJourneys();
      const existing = recent.find(j => offerLabelOf(j)?.label.date === today);
      if (existing) return { status: 'exists', journeyId: existing.journey_id };

      await this.checkSegment();
      const fx = await this.loadRates();
      this.checkRates(fx, now);

      const feed = await this.fetchFeed({
        url: this.config.feedUrl, timeoutMs: this.config.feedTimeoutMs, minRows: this.config.minFeedRows, now,
      });
      const { loopDay, previous } = await this.planToday(recent);
      const pick = pickForLoopDay(feed.products, loopDay, previous);
      this.checkCount(pick);
      const built = this.build(pick);
      this.testRender(built, fx.rates);

      const name = `${ordinalDate(today)} - ${pick.themeName} (Day ${loopDay})`;
      const { ContentService, JourneyService } = await this.services();
      const template = await ContentService.create({
        name, channel: 'email', subject: built.subject, body: built.html, createdBy: CREATED_BY,
      });
      const label = {
        version: 1,
        date: today,
        loopDay,
        theme: pick.theme,
        themeName: pick.themeName,
        status: 'created',
        productKeys: pick.productKeys,
        activityCursor: pick.activityCursor,
        groups: built.groups,
        products: built.products,
        feedGeneratedAt: feed.generatedAt,
        createdAt: now.toISOString(),
      };
      const journey = await JourneyService.create({
        name,
        description: `Automated daily offer (Day ${loopDay} of 8). Sends at ${this.config.sendAt} Dubai after the ${this.config.checkAt} final check.`,
        segmentId: `custom:${this.config.segmentId}`,
        audience: 'all',
        journeyType: 'fixed',
        exitOnConversion: true,
        scheduledStartAt: null,
        createdBy: CREATED_BY,
        nodes: [
          { id: 'node_0', type: 'trigger', position: { x: 300, y: 50 },
            data: { label: 'Entry Point', segmentId: `custom:${this.config.segmentId}`, triggerType: 'segment_entry' } },
          { id: 'node_1', type: 'action', position: { x: 300, y: 170 },
            data: { label: pick.themeName, channel: 'email', goalType: 'booking', waitDays: 1, condition: 'booked',
                    restChannel: 'email', emailTemplateId: Number(template.id), dailyOffer: label } },
        ],
        edges: [{ id: 'e_node_0_node_1', source: 'node_0', target: 'node_1' }],
      });
      this.log.log(`[DailyOffer] Created "${name}" — template ${template.id}, journey ${journey.journey_id}, ${pick.count} products`);
      return { status: 'created', journeyId: journey.journey_id, templateId: template.id, name, count: pick.count };
    } catch (err) {
      const reason = err instanceof SkipError || err instanceof FeedError ? err.reason : 'error';
      this.log.warn(`[DailyOffer] ${today} not created (${reason}): ${err.message}`);
      return { status: 'skipped', reason, message: err.message };
    }
  }

  // ── 3:45 PM: final check ───────────────────────────────────────────────

  async runFinalCheck({ now = new Date() } = {}) {
    const today = dubaiDate(now);
    const recent = await this.recentJourneys();
    const journey = recent.find(j => offerLabelOf(j)?.label.date === today);
    if (!journey) return { status: 'none', message: 'No daily offer journey for today' };
    const { node, label } = offerLabelOf(journey);
    if (label.status === 'skipped') return { status: 'skipped_earlier', journeyId: journey.journey_id };
    if (journey.status !== 'draft' || journey.scheduled_start_at) {
      return { status: 'already_scheduled', journeyId: journey.journey_id };
    }
    const { ContentService, JourneyService } = await this.services();
    try {
      const sendMin = hhmmToMinutes(this.config.sendAt);
      if (dubaiMinutes(now) > sendMin + 120) throw new SkipError('too_late', 'Final check ran more than 2 hours after send time');

      const snap = Number(journey.snapshot_count);
      if (snap === -1) throw new SkipError('audience_not_ready', 'Audience list is still being built');
      if (snap === -2) throw new SkipError('audience_failed', 'Audience list failed to build');
      if (!(snap > 0)) throw new SkipError('audience_empty', 'Segment has no people');
      await this.checkSegment();
      const fx = await this.loadRates();
      this.checkRates(fx, now);

      // Fresh feed: drop products that became unavailable and refresh prices.
      const feed = await this.fetchFeed({
        url: this.config.feedUrl, timeoutMs: this.config.feedTimeoutMs, minRows: this.config.minFeedRows, now,
      });
      const fresh = new Map(feed.products.filter(isUsable).map(p => [p.key, p]));
      const groups = label.groups
        .map(g => ({ title: g.title, subtitle: g.subtitle, products: g.keys.map(k => fresh.get(k)).filter(Boolean) }))
        .filter(g => g.products.length);
      const flat = groups.flatMap(g => g.products);
      const pick = {
        loopDay: label.loopDay, theme: label.theme, themeName: label.themeName,
        subjectLead: '', groups, productKeys: flat.map(p => p.key), count: flat.length,
      };
      // Keep the 9 AM subject lead (it names the countries chosen then).
      const { rows: [tpl] } = await this.db.query('SELECT id, subject FROM content_templates WHERE id = $1', [node.data.emailTemplateId]);
      if (!tpl) throw new SkipError('template_missing', 'Template was deleted');
      pick.subjectLead = String(tpl.subject || '').replace(/ – from %%DO_FROM%%$/, '') || label.themeName;
      this.checkCount(pick);
      const built = this.build(pick);
      this.testRender(built, fx.rates);

      await ContentService.update(tpl.id, { body: built.html, subject: built.subject });
      const dropped = label.productKeys.filter(k => !pick.productKeys.includes(k));
      const newLabel = { ...label, status: 'scheduled', productKeys: pick.productKeys, groups: built.groups,
        products: built.products, checkedAt: now.toISOString(), dropped };
      const nodes = journey.nodes.map(n => n.id === node.id ? { ...n, data: { ...n.data, dailyOffer: newLabel } } : n);
      await JourneyService.update(journey.journey_id, {
        nodes,
        scheduled_start_at: dubaiInstant(today, this.config.sendAt).toISOString(),
      });
      this.log.log(`[DailyOffer] Journey ${journey.journey_id} passed final check — scheduled ${this.config.sendAt} Dubai, ${pick.count} products${dropped.length ? `, dropped ${dropped.length} unavailable` : ''}`);
      return { status: 'scheduled', journeyId: journey.journey_id, count: pick.count, dropped };
    } catch (err) {
      const reason = err instanceof SkipError || err instanceof FeedError ? err.reason : 'error';
      this.log.warn(`[DailyOffer] Journey ${journey.journey_id} NOT sent (${reason}): ${err.message}`);
      const nodes = journey.nodes.map(n => n.id === node.id
        ? { ...n, data: { ...n.data, dailyOffer: { ...label, status: 'skipped', skipReason: reason, checkedAt: now.toISOString() } } }
        : n);
      await JourneyService.update(journey.journey_id, {
        nodes,
        description: `Not sent: ${err.message} (final check ${this.config.checkAt} Dubai, ${today}).`,
      }).catch(e => this.log.error(`[DailyOffer] could not record skip reason: ${e.message}`));
      return { status: 'skipped', reason, message: err.message, journeyId: journey.journey_id };
    }
  }

  // ── Preview (Templates page "View as") ─────────────────────────────────

  /** Rendered preview of a daily offer template for one market, or null when not one. */
  async previewTemplate(template, marketKey = 'uae') {
    if (!template?.body || !String(template.body).startsWith(DAILY_OFFER_MARKER)) return null;
    const tid = Number(template.id);
    const { rows: [j] } = await this.db.query(
      `SELECT journey_id, nodes FROM journey_flows
        WHERE nodes @> $1::jsonb
        ORDER BY journey_id DESC LIMIT 1`,
      [JSON.stringify([{ data: { emailTemplateId: tid } }])]);
    const found = offerLabelOf(j);
    if (!found) return null;
    const market = PREVIEW_MARKETS[marketKey] || PREVIEW_MARKETS.uae;
    const { rates } = await this.loadRates();
    const out = applyMarket({ html: template.body, subject: template.subject }, found.label.products, market, rates);
    return {
      html: out.html.replace(DAILY_OFFER_MARKER, ''),
      subject: out.subject,
      market: marketKey in PREVIEW_MARKETS ? marketKey : 'uae',
      markets: Object.entries(PREVIEW_MARKETS).map(([key, m]) => ({ key, label: m.label })),
      currency: out.currency,
      journeyId: j.journey_id,
      status: found.label.status,
    };
  }
}
