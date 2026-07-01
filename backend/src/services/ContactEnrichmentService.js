import db from '../config/database.js';
import { isValidEmail, suggestDomain } from '@emailcheck/email-validator-js';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';
import Anthropic from '@anthropic-ai/sdk';

const BATCH_SIZE = 1000;
const CLAUDE_BATCH = 50;

// Country name mapping from ISO 2-letter code
const COUNTRY_NAMES = {
  IN: 'India', AE: 'UAE', SA: 'Saudi Arabia', US: 'United States', GB: 'United Kingdom',
  CA: 'Canada', AU: 'Australia', DE: 'Germany', FR: 'France', IT: 'Italy', ES: 'Spain',
  NL: 'Netherlands', BE: 'Belgium', CH: 'Switzerland', AT: 'Austria', SE: 'Sweden',
  NO: 'Norway', DK: 'Denmark', FI: 'Finland', PL: 'Poland', PT: 'Portugal',
  RU: 'Russia', CN: 'China', JP: 'Japan', KR: 'South Korea', SG: 'Singapore',
  MY: 'Malaysia', TH: 'Thailand', ID: 'Indonesia', PH: 'Philippines', VN: 'Vietnam',
  BD: 'Bangladesh', PK: 'Pakistan', LK: 'Sri Lanka', NP: 'Nepal', MM: 'Myanmar',
  KW: 'Kuwait', QA: 'Qatar', BH: 'Bahrain', OM: 'Oman', JO: 'Jordan',
  LB: 'Lebanon', IQ: 'Iraq', IR: 'Iran', EG: 'Egypt', ZA: 'South Africa',
  NG: 'Nigeria', KE: 'Kenya', GH: 'Ghana', TZ: 'Tanzania', UG: 'Uganda',
  BR: 'Brazil', MX: 'Mexico', AR: 'Argentina', CO: 'Colombia', CL: 'Chile',
  TR: 'Turkey', IL: 'Israel', NZ: 'New Zealand', HK: 'Hong Kong', TW: 'Taiwan',
};

// Map country text from DB to ISO 2-letter code for libphonenumber-js
const COUNTRY_TO_ISO = {
  'india': 'IN', 'uae': 'AE', 'united arab emirates': 'AE', 'dubai': 'AE',
  'saudi arabia': 'SA', 'ksa': 'SA', 'usa': 'US', 'united states': 'US',
  'uk': 'GB', 'united kingdom': 'GB', 'england': 'GB', 'canada': 'CA',
  'australia': 'AU', 'germany': 'DE', 'france': 'FR', 'italy': 'IT',
  'spain': 'ES', 'netherlands': 'NL', 'belgium': 'BE', 'switzerland': 'CH',
  'singapore': 'SG', 'malaysia': 'MY', 'thailand': 'TH', 'indonesia': 'ID',
  'philippines': 'PH', 'bangladesh': 'BD', 'pakistan': 'PK', 'sri lanka': 'LK',
  'nepal': 'NP', 'kuwait': 'KW', 'qatar': 'QA', 'bahrain': 'BH', 'oman': 'OM',
  'jordan': 'JO', 'lebanon': 'LB', 'egypt': 'EG', 'south africa': 'ZA',
  'nigeria': 'NG', 'kenya': 'KE', 'brazil': 'BR', 'mexico': 'MX',
  'turkey': 'TR', 'israel': 'IL', 'new zealand': 'NZ', 'hong kong': 'HK',
  'china': 'CN', 'japan': 'JP', 'south korea': 'KR', 'russia': 'RU',
  'iran': 'IR', 'iraq': 'IQ',
};

/**
 * ContactEnrichmentService
 *
 * Enriches unified_contacts with:
 * - Email validation + Claude-powered fixing
 * - Mobile formatting (country code + digits) + country detection
 */
export default class ContactEnrichmentService {

  // ── Public API ────────────────────────────────────────────────

  /**
   * Enrich ALL contacts (one-time full run).
   * Processes contacts where actual_email IS NULL (not yet enriched).
   */
  static async enrichAll() {
    return this._enrich({ onlyNew: false });
  }

  /**
   * Enrich only NEW contacts (daily cron).
   * Processes contacts where actual_email IS NULL (added since last enrichment).
   */
  static async enrichNew() {
    return this._enrich({ onlyNew: true });
  }

  // ── Core enrichment loop ──────────────────────────────────────

  static async _enrich({ onlyNew = true } = {}) {
    const start = Date.now();
    const startedAt = new Date();
    let totalProcessed = 0;
    let emailsValidated = 0;
    let emailsFixed = 0;
    let emailsMarkedInvalid = 0;
    let mobilesFormatted = 0;
    let mobilesMarkedInvalid = 0;
    let offset = 0;

    console.log(`[Enrichment] Starting ${onlyNew ? 'incremental' : 'full'} enrichment...`);

    // Wrap the whole body so any failure still writes an 'error' row to
    // sync_metadata (otherwise /data-pipeline shows stale success indefinitely).
    try {

    while (true) {
      // Fetch batch of un-enriched contacts
      const { rows: contacts } = await db.query(`
        SELECT id, email, mobile, country
        FROM unified_contacts
        WHERE actual_email IS NULL
        ORDER BY id
        LIMIT $1 OFFSET $2
      `, [BATCH_SIZE, offset]);

      if (!contacts || contacts.length === 0) break;

      // ── Email enrichment ──
      const emailResults = await this._enrichEmails(contacts);

      // ── Mobile enrichment ──
      const mobileResults = this._enrichMobiles(contacts);

      // ── Bulk update DB (single query for entire batch) ──
      const ids = [], actualEmails = [], enrichedEmails = [], emailInvalids = [];
      const actualMobiles = [], enrichedMobiles = [], mobileCountries = [], mobileInvalids = [];

      for (let i = 0; i < contacts.length; i++) {
        const c = contacts[i];
        const e = emailResults[i];
        const m = mobileResults[i];

        ids.push(c.id);
        actualEmails.push(e.actualEmail);
        enrichedEmails.push(e.enrichedEmail);
        emailInvalids.push(e.markInvalid ? 'Yes' : null);
        actualMobiles.push(m.actualMobile);
        enrichedMobiles.push(m.enrichedMobile);
        mobileCountries.push(m.mobileCountry);
        mobileInvalids.push(m.markInvalid ? 'Yes' : null);

        if (e.markInvalid) emailsMarkedInvalid++;
        if (e.wasFixed) emailsFixed++;
        if (m.wasFormatted) mobilesFormatted++;
        if (m.markInvalid) mobilesMarkedInvalid++;
        emailsValidated++;
      }

      await db.query(`
        UPDATE unified_contacts AS uc SET
          actual_email = v.actual_email,
          email = v.enriched_email,
          email_unsubscribe = COALESCE(v.email_inv, uc.email_unsubscribe),
          actual_mobile = v.actual_mobile,
          mobile = v.enriched_mobile,
          mobile_country = v.mobile_country,
          wa_unsubscribe = COALESCE(v.mobile_inv, uc.wa_unsubscribe),
          updated_at = NOW()
        FROM (
          SELECT unnest($1::int[]) AS id,
                 unnest($2::text[]) AS actual_email,
                 unnest($3::text[]) AS enriched_email,
                 unnest($4::text[]) AS email_inv,
                 unnest($5::text[]) AS actual_mobile,
                 unnest($6::text[]) AS enriched_mobile,
                 unnest($7::text[]) AS mobile_country,
                 unnest($8::text[]) AS mobile_inv
        ) AS v
        WHERE uc.id = v.id
      `, [ids, actualEmails, enrichedEmails, emailInvalids, actualMobiles, enrichedMobiles, mobileCountries, mobileInvalids]);

      totalProcessed += contacts.length;
      offset += contacts.length;

      if (totalProcessed % 5000 === 0) {
        console.log(`[Enrichment] Processed ${totalProcessed}... (emails fixed: ${emailsFixed}, invalid: ${emailsMarkedInvalid}, mobiles formatted: ${mobilesFormatted})`);
      }

      if (contacts.length < BATCH_SIZE) break;
    }

      const durationMs = Date.now() - start;
      const result = { totalProcessed, emailsValidated, emailsFixed, emailsMarkedInvalid, mobilesFormatted, mobilesMarkedInvalid, durationMs };
      console.log(`[Enrichment] Done in ${(durationMs / 1000).toFixed(1)}s —`, JSON.stringify(result));

      // Record success in sync_metadata so /data-pipeline shows last-run info.
      await db.query(`
        INSERT INTO sync_metadata (table_name, last_synced_at, rows_synced, sync_status, error_message, sync_duration_ms, updated_at)
        VALUES ('contact_enrichment', $1, $2, 'success', NULL, $3, NOW())
        ON CONFLICT (table_name) DO UPDATE SET
          last_synced_at   = EXCLUDED.last_synced_at,
          rows_synced      = EXCLUDED.rows_synced,
          sync_status      = 'success',
          error_message    = NULL,
          sync_duration_ms = EXCLUDED.sync_duration_ms,
          updated_at       = NOW()
      `, [startedAt, totalProcessed, durationMs]).catch(err =>
        console.warn('[Enrichment] sync_metadata write failed:', err.message)
      );

      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      console.error(`[Enrichment] Failed after ${(durationMs / 1000).toFixed(1)}s:`, err.message);
      await db.query(`
        INSERT INTO sync_metadata (table_name, last_synced_at, rows_synced, sync_status, error_message, sync_duration_ms, updated_at)
        VALUES ('contact_enrichment', $1, $2, 'error', $3, $4, NOW())
        ON CONFLICT (table_name) DO UPDATE SET
          rows_synced      = EXCLUDED.rows_synced,
          sync_status      = 'error',
          error_message    = EXCLUDED.error_message,
          sync_duration_ms = EXCLUDED.sync_duration_ms,
          updated_at       = NOW()
      `, [startedAt, totalProcessed, err.message.slice(0, 500), durationMs]).catch(() => {});
      throw err;
    }
  }

  // ── Email enrichment ──────────────────────────────────────────

  static async _enrichEmails(contacts) {
    const results = [];
    const invalidBatch = []; // collect invalid emails for Claude fixing

    for (const c of contacts) {
      const original = c.email || '';
      // Basic cleanup: trim, lowercase, remove spaces
      let cleaned = original.trim().toLowerCase().replace(/\s+/g, '');

      if (!cleaned || !cleaned.includes('@')) {
        results.push({ actualEmail: original, enrichedEmail: cleaned || null, markInvalid: true, wasFixed: false });
        continue;
      }

      // Quick domain suggestion (catches gmial.com → gmail.com etc.)
      try {
        const domainPart = cleaned.split('@')[1];
        if (domainPart) {
          const suggested = suggestDomain(domainPart);
          if (suggested && suggested !== domainPart) {
            cleaned = cleaned.split('@')[0] + '@' + suggested;
          }
        }
      } catch {}

      // Validate email format
      let valid = false;
      try { valid = isValidEmail(cleaned || ''); } catch {}
      if (valid) {
        results.push({ actualEmail: original, enrichedEmail: cleaned, markInvalid: false, wasFixed: cleaned !== original.trim().toLowerCase() });
      } else {
        // Collect for Claude batch fixing
        invalidBatch.push({ index: results.length, original, cleaned });
        results.push({ actualEmail: original, enrichedEmail: cleaned, markInvalid: true, wasFixed: false });
      }
    }

    // ── Claude API: fix invalid emails in batches of 50 ──
    if (invalidBatch.length > 0) {
      for (let i = 0; i < invalidBatch.length; i += CLAUDE_BATCH) {
        const batch = invalidBatch.slice(i, i + CLAUDE_BATCH);
        const fixed = await this._fixEmailsWithClaude(batch.map(b => b.cleaned));

        for (let j = 0; j < batch.length; j++) {
          const fixedEmail = fixed[j];
          if (fixedEmail && fixedEmail !== batch[j].cleaned && isValidEmail(fixedEmail)) {
            // Claude fixed it and it's now valid
            results[batch[j].index] = {
              actualEmail: batch[j].original,
              enrichedEmail: fixedEmail,
              markInvalid: false,
              wasFixed: true,
            };
          }
        }
      }
    }

    return results;
  }

  static async _fixEmailsWithClaude(emails) {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return emails.map(() => null);

      const client = new Anthropic({ apiKey });
      const emailList = emails.map((e, i) => `${i + 1}. ${e}`).join('\n');

      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Fix these invalid email addresses. Common issues: typos in domain (gmial→gmail, yaho→yahoo, hotmal→hotmail, outloo→outlook), extra dots, missing dots, spaces. Return ONLY the fixed emails, one per line, same order. If unfixable, return the original as-is.\n\n${emailList}`
        }]
      });

      const response = msg.content[0]?.text || '';
      const fixedLines = response.trim().split('\n').map(l => {
        // Strip numbering like "1. " or "1) "
        return l.replace(/^\d+[\.\)]\s*/, '').trim().toLowerCase();
      });

      return fixedLines;
    } catch (err) {
      console.error(`[Enrichment] Claude API error: ${err.message}`);
      return emails.map(() => null);
    }
  }

  // ── Mobile enrichment ─────────────────────────────────────────

  static _enrichMobiles(contacts) {
    return contacts.map(c => {
      const original = c.mobile || '';
      if (!original || original.length < 7) {
        return { actualMobile: original, enrichedMobile: original || null, mobileCountry: null, markInvalid: !!original, wasFormatted: false };
      }

      // Detect ISO country code from DB country field
      const countryHint = (c.country || '').toLowerCase().trim();
      const isoCode = COUNTRY_TO_ISO[countryHint] || null;

      let enrichedMobile = original;
      let mobileCountry = null;
      let wasFormatted = false;
      let markInvalid = false;

      try {
        // Try parsing with country hint
        let parsed = null;

        // First try: raw number with country hint
        const rawDigits = original.replace(/[^0-9+]/g, '');
        const withPlus = rawDigits.startsWith('+') ? rawDigits : '+' + rawDigits;

        try {
          parsed = parsePhoneNumber(withPlus);
        } catch {}

        // Second try: with country code hint
        if (!parsed && isoCode) {
          try {
            parsed = parsePhoneNumber(original, isoCode);
          } catch {}
        }

        // Third try: assume India if 10 digits
        if (!parsed && rawDigits.length === 10) {
          try {
            parsed = parsePhoneNumber(rawDigits, 'IN');
          } catch {}
        }

        if (parsed && parsed.isValid()) {
          // Format: country code + number, no +, no spaces
          // e.g. +91 9102524714 → 919102524714
          const intl = parsed.formatInternational().replace(/[\s\-\(\)]/g, '');
          enrichedMobile = intl.startsWith('+') ? intl.slice(1) : intl;

          // Detect country
          const detectedIso = parsed.country;
          mobileCountry = COUNTRY_NAMES[detectedIso] || detectedIso || null;
          wasFormatted = enrichedMobile !== original;
        } else {
          // Could not parse — strip to digits only
          enrichedMobile = rawDigits.replace(/^\+/, '');
          markInvalid = true;
        }
      } catch {
        enrichedMobile = original.replace(/[^0-9]/g, '');
        markInvalid = true;
      }

      return { actualMobile: original, enrichedMobile, mobileCountry, markInvalid, wasFormatted };
    });
  }
}
