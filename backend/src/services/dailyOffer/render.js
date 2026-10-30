/**
 * Daily offer email — HTML builder and per-recipient pricing.
 *
 * Two stages:
 *   1. buildTemplate(pick)        → the template saved in content_templates. Prices are
 *                                   left as %%DO_PRICE:<key>%% / %%DO_FROM%% tokens because
 *                                   each recipient sees their own market price + currency.
 *   2. applyMarket(tpl, snapshot, market, rates)
 *                                 → fills the tokens for one market (India ₹, UAE AED, …).
 *
 * The product snapshot (names, links, per-market AED prices) is stored on the journey's
 * email node, so send time never depends on the products table.
 */
import { EMAIL_HEAD, EMAIL_FOOT } from './emailShell.js';

export const DAILY_OFFER_MARKER = '<!--DAILY_OFFER-->';
const PRICE_TOKEN = /%%DO_PRICE:([A-Za-z0-9_-]+)%%/g;
const FROM_TOKEN = /%%DO_FROM%%/g;

// Currencies shown without decimals (large unit values).
const WHOLE_UNIT = new Set(['INR', 'PKR', 'LKR', 'NPR', 'BDT', 'JPY', 'KRW', 'IDR', 'VND', 'IRR', 'PHP', 'RUB', 'EGP', 'KES', 'NGN', 'HUF', 'CLP', 'COP', 'TZS', 'UGX']);
const SYMBOL = { INR: '₹', USD: '$', GBP: '£', EUR: '€' };
const MAX_DISPLAY_RATE = parseFloat(process.env.FX_MAX_DISPLAY_RATE || '1000');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CTA = {
  visa:           { url: 'https://www.raynatours.com/visas', label: 'Explore All Visas' },
  holiday_multi:  { url: 'https://www.raynatours.com/holidays', label: 'Explore Holiday Packages' },
  holiday_single: { url: 'https://www.raynatours.com/holidays', label: 'Explore Holiday Packages' },
  activities:     { url: 'https://www.raynatours.com/activities', label: 'Explore Things To Do' },
  cruise:         { url: 'https://www.raynatours.com/cruises', label: 'Explore All Cruises' },
};

// ── Money ────────────────────────────────────────────────────────────────

/** Display market after the FX safety rules: no usable rate → AED (correctly labelled). */
export function effectiveMarket(market, rates = {}) {
  const plan = market?.plan || 'default';
  let currency = String(market?.currency || 'AED').toUpperCase();
  let rate = currency === 'AED' ? 1 : Number(rates[currency]);
  if (!Number.isFinite(rate) || rate <= 0 || rate > MAX_DISPLAY_RATE) { currency = 'AED'; rate = 1; }
  return { plan, currency, rate };
}

/** "₹7,000", "AED 13.24", "SAR 276", "$35". */
export function formatMoney(amount, currency) {
  const cur = String(currency || 'AED').toUpperCase();
  const whole = WHOLE_UNIT.has(cur) || amount >= 1000;
  const rounded = whole ? Math.round(amount) : Math.round(amount * 100) / 100;
  const str = rounded.toLocaleString('en-US', {
    minimumFractionDigits: whole || Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return SYMBOL[cur] ? `${SYMBOL[cur]}${str}` : `${cur} ${str}`;
}

/**
 * One product's price for a market. Uses the market's own row when it has a real
 * sale price, else the default row — a 0 price is never shown. Returns null when the
 * product has no usable price at all.
 */
export function priceFor(prices, eff) {
  const own = prices?.[eff.plan];
  const row = own && own.sale > 0 ? own : prices?.default;
  if (!row || !(row.sale > 0)) return null;
  const sale = row.sale * eff.rate;
  const strike = row.price > row.sale ? row.price * eff.rate : null;
  const savePct = strike ? Math.round(((row.price - row.sale) / row.price) * 100) : 0;
  return { sale, strike: savePct >= 1 ? strike : null, savePct: savePct >= 1 ? savePct : 0, currency: eff.currency };
}

function priceHtml(p) {
  const strike = p.strike
    ? `<span class="ff-b dm-faint" style="font-size:11px;font-weight:400;color:#9A9A9A;text-decoration:line-through;">${esc(formatMoney(p.strike, p.currency))}</span>&nbsp; `
    : '';
  const save = p.savePct
    ? `<p style="margin:6px 0 0;"><span class="ff-b" style="display:inline-block;background:#4CAF50;color:#FFFFFF;font-size:10px;font-weight:600;line-height:14px;padding:2px 8px;border-radius:4px;">Save ${p.savePct}%</span></p>`
    : '';
  return `<p class="ff-d dm-strong" style="margin:0;font-size:15px;font-weight:600;color:#000;">${strike}<span class="ff-b dm-faint" style="font-size:10px;font-weight:300;color:#9A9A9A;">from </span>${esc(formatMoney(p.sale, p.currency))}</p>${save}`;
}

// ── Template ─────────────────────────────────────────────────────────────

function cardImage(url) {
  // Same Cloudinary crop as the hand-made daily emails (uniform 3:2 cards).
  return `https://res.cloudinary.com/dzsl8v8yw/image/fetch/c_fill,w_600,h_400,g_auto,q_60,f_jpg,fl_progressive/${url}`;
}

function card(p) {
  const href = esc(p.url);
  return `<div class="col" style="display:inline-block;width:100%;max-width:250px;vertical-align:top;">
<div style="padding:0 6px 12px 6px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFFFFF;border:1px solid #ECECEC;border-radius:10px;overflow:hidden;" class="dm-box">
<tr><td style="font-size:0;line-height:0;">
<a href="${href}" style="display:block;text-decoration:none;"><img border="0" class="card-img" src="${esc(cardImage(p.image))}" width="250" height="167" alt="${esc(p.name)}" style="width:100%;max-width:100%;height:auto;display:block;"></a>
</td></tr>
<tr><td style="padding:13px 15px 15px 15px;">
<a href="${href}" style="text-decoration:none;color:inherit;display:block;">
<p class="ff-d dm-strong" style="margin:0 0 3px;font-size:16px;line-height:20px;font-weight:600;color:#000;">${esc(p.name)}</p>
${p.subtitle ? `<p class="ff-b dm-sub" style="margin:0 0 10px;font-size:11.5px;line-height:16px;color:#7A7A7A;">${esc(p.subtitle)}</p>` : '<p style="margin:0 0 10px;font-size:0;line-height:0;">&nbsp;</p>'}
%%DO_PRICE:${p.key}%%
</a>
</td></tr>
</table>
</div>
</div>`;
}

function cardGrid(products) {
  const rows = [];
  for (let i = 0; i < products.length; i += 2) rows.push(products.slice(i, i + 2));
  const body = rows.map(pair => pair.map((p, j) =>
    `<!--[if mso]><td width="50%" valign="top" style="padding:0 ${j ? 0 : 6}px 12px ${j ? 6 : 0}px;"><![endif]-->\n${card(p)}\n<!--[if mso]></td><![endif]-->`
  ).join('\n')).join('\n<!--[if mso]></tr><tr><![endif]-->\n');
  return `<tr><td class="px dm-cardbg" style="padding:22px 38px 6px 38px;background-color:#FFFFFF;">
<div style="font-size:0;text-align:center;">
<!--[if mso]><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><![endif]-->
${body}
<!--[if mso]></tr></table><![endif]-->
</div>
</td></tr>`;
}

function sectionHeader(title, subtitle) {
  return `<tr><td class="px dm-cardbg" style="padding:38px 38px 0 38px;background-color:#FFFFFF;text-align:center;">
<p class="ff-d dm-strong" style="margin:0 0 10px 0;font-size:21px;line-height:26px;font-weight:700;letter-spacing:.01em;color:#000;">${esc(title)}</p>
<table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td style="width:44px;border-top:3px solid #C99A3A;font-size:0;line-height:0;">&nbsp;</td></tr></table>
${subtitle ? `<p class="ff-b dm-sub" style="margin:12px auto 0;max-width:380px;font-size:12.5px;line-height:18px;color:#8A7A6E;">${esc(subtitle)}</p>` : ''}
</td></tr>`;
}

function hero(pick) {
  return `<tr><td class="px dm-cardbg" style="padding:20px 38px 6px 38px;background-color:#FFFFFF;text-align:center;">
<p class="ff-b dm-label" style="margin:0 0 12px 0;font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:#9A9A9A;">${esc(pick.themeName)}</p>
<h1 class="ff-d dm-h h1" style="margin:0 0 15px 0;font-size:29px;line-height:37px;font-weight:600;color:#000;">${esc(pick.subjectLead)}</h1>
<p class="ff-b dm-sub" style="margin:0 auto;max-width:440px;font-size:14px;line-height:23px;font-weight:300;color:#6B6B6B;">Prices from %%DO_FROM%%.</p>
</td></tr>`;
}

function ctaRow(theme) {
  const c = CTA[theme] || CTA.holiday_multi;
  return `<tr><td class="px dm-cardbg" style="padding:30px 38px 34px 38px;background-color:#FFFFFF;">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${c.url}" style="height:54px;v-text-anchor:middle;width:524px;" arcsize="11%" strokecolor="#000000" fillcolor="#000000">
<w:anchorlock/>
<center style="color:#FFFFFF;font-family:Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;">${esc(c.label)}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!--><a href="${c.url}" style="display:block;width:100%;box-sizing:border-box;text-align:center;background-color:#000;color:#FFF;padding:19px 0;font-family:'Montserrat',Helvetica,Arial,sans-serif;font-size:12px;line-height:16px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;border-radius:6px;">${esc(c.label)}</a><!--<![endif]-->
</td></tr>`;
}

/** Subject with the %%DO_FROM%% token, e.g. "Visas for UAE, USA, Schengen & more – from %%DO_FROM%%". */
export function buildSubject(pick) {
  return `${pick.subjectLead} – from %%DO_FROM%%`;
}

/** Full template HTML (prices as tokens). */
export function buildTemplate(pick) {
  const sections = pick.groups.map(g => sectionHeader(g.title, g.subtitle) + '\n' + cardGrid(g.products)).join('\n');
  const head = EMAIL_HEAD
    .replace('%%DO_TITLE%%', esc(`${pick.subjectLead} – from `) + '%%DO_FROM%%')
    .replace('%%DO_PREHEADER%%', esc(`${pick.themeName}: ${pick.count} offers, prices from `) + '%%DO_FROM%%');
  return `${DAILY_OFFER_MARKER}\n${head}\n${hero(pick)}\n${sections}\n${ctaRow(pick.theme)}\n${EMAIL_FOOT}`;
}

/** The compact product snapshot stored on the journey node (only what send time needs). */
export function snapshotProducts(pick) {
  return pick.groups.flatMap(g => g.products).map(p => ({ key: p.key, name: p.name, prices: p.prices }));
}

/**
 * Fill prices for one market. Returns { html, subject, missing } — `missing` lists
 * products with no usable price (callers treat that as a failed check).
 */
export function applyMarket({ html, subject }, products, market, rates) {
  const eff = effectiveMarket(market, rates);
  const byKey = new Map(products.map(p => [p.key, p]));
  const missing = [];
  let min = Infinity;
  for (const p of products) {
    const pr = priceFor(p.prices, eff);
    if (pr) min = Math.min(min, pr.sale);
  }
  const fromText = Number.isFinite(min) ? formatMoney(min, eff.currency) : '';
  const outHtml = String(html || '').replace(PRICE_TOKEN, (_, key) => {
    const p = byKey.get(key);
    const pr = p ? priceFor(p.prices, eff) : null;
    if (!pr) { missing.push(key); return ''; }
    return priceHtml(pr);
  }).replace(FROM_TOKEN, esc(fromText));
  const outSubject = String(subject || '').replace(FROM_TOKEN, fromText);
  return { html: outHtml, subject: outSubject, missing, currency: eff.currency, from: fromText };
}

/** Problems that mean the rendered email must not be sent. */
export function renderProblems(rendered) {
  const problems = [];
  if (rendered.missing.length) problems.push(`${rendered.missing.length} product(s) without a price`);
  if (!rendered.from) problems.push('no "from" price');
  if (/%%DO_[A-Z_]+/.test(rendered.html) || /%%DO_/.test(rendered.subject)) problems.push('unfilled price tokens');
  if (/\{\{\s*[\w.]+\s*\}\}/.test(rendered.html)) problems.push('leftover {{…}} placeholders');
  if (/(₹|AED|SAR|\$|£|€)\s?0(\.0+)?(?![\d.,])/.test(rendered.html)) problems.push('a zero price');
  return problems;
}
