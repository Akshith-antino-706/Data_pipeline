import { query, transaction } from '../config/database.js';

// ── Country code → nationality/country mapping ─────────────
const COUNTRY_CODE_MAP = {
  '1': { country: 'United States', nationality: 'American', region: 'NA' },
  '7': { country: 'Russia', nationality: 'Russian', region: 'EU' },
  '20': { country: 'Egypt', nationality: 'Egyptian', region: 'AF' },
  '27': { country: 'South Africa', nationality: 'South African', region: 'AF' },
  '30': { country: 'Greece', nationality: 'Greek', region: 'EU' },
  '31': { country: 'Netherlands', nationality: 'Dutch', region: 'EU' },
  '33': { country: 'France', nationality: 'French', region: 'EU' },
  '34': { country: 'Spain', nationality: 'Spanish', region: 'EU' },
  '39': { country: 'Italy', nationality: 'Italian', region: 'EU' },
  '44': { country: 'United Kingdom', nationality: 'British', region: 'EU' },
  '49': { country: 'Germany', nationality: 'German', region: 'EU' },
  '55': { country: 'Brazil', nationality: 'Brazilian', region: 'SA' },
  '60': { country: 'Malaysia', nationality: 'Malaysian', region: 'AS' },
  '61': { country: 'Australia', nationality: 'Australian', region: 'OC' },
  '62': { country: 'Indonesia', nationality: 'Indonesian', region: 'AS' },
  '63': { country: 'Philippines', nationality: 'Filipino', region: 'AS' },
  '65': { country: 'Singapore', nationality: 'Singaporean', region: 'AS' },
  '66': { country: 'Thailand', nationality: 'Thai', region: 'AS' },
  '81': { country: 'Japan', nationality: 'Japanese', region: 'AS' },
  '82': { country: 'South Korea', nationality: 'Korean', region: 'AS' },
  '86': { country: 'China', nationality: 'Chinese', region: 'AS' },
  '90': { country: 'Turkey', nationality: 'Turkish', region: 'AS' },
  '91': { country: 'India', nationality: 'Indian', region: 'AS' },
  '92': { country: 'Pakistan', nationality: 'Pakistani', region: 'AS' },
  '93': { country: 'Afghanistan', nationality: 'Afghan', region: 'AS' },
  '94': { country: 'Sri Lanka', nationality: 'Sri Lankan', region: 'AS' },
  '95': { country: 'Myanmar', nationality: 'Burmese', region: 'AS' },
  '212': { country: 'Morocco', nationality: 'Moroccan', region: 'AF' },
  '234': { country: 'Nigeria', nationality: 'Nigerian', region: 'AF' },
  '254': { country: 'Kenya', nationality: 'Kenyan', region: 'AF' },
  '255': { country: 'Tanzania', nationality: 'Tanzanian', region: 'AF' },
  '256': { country: 'Uganda', nationality: 'Ugandan', region: 'AF' },
  '351': { country: 'Portugal', nationality: 'Portuguese', region: 'EU' },
  '353': { country: 'Ireland', nationality: 'Irish', region: 'EU' },
  '357': { country: 'Cyprus', nationality: 'Cypriot', region: 'EU' },
  '380': { country: 'Ukraine', nationality: 'Ukrainian', region: 'EU' },
  '420': { country: 'Czech Republic', nationality: 'Czech', region: 'EU' },
  '421': { country: 'Slovakia', nationality: 'Slovak', region: 'EU' },
  '852': { country: 'Hong Kong', nationality: 'Hong Konger', region: 'AS' },
  '880': { country: 'Bangladesh', nationality: 'Bangladeshi', region: 'AS' },
  '960': { country: 'Maldives', nationality: 'Maldivian', region: 'AS' },
  '961': { country: 'Lebanon', nationality: 'Lebanese', region: 'AS' },
  '962': { country: 'Jordan', nationality: 'Jordanian', region: 'AS' },
  '964': { country: 'Iraq', nationality: 'Iraqi', region: 'AS' },
  '965': { country: 'Kuwait', nationality: 'Kuwaiti', region: 'AS' },
  '966': { country: 'Saudi Arabia', nationality: 'Saudi', region: 'AS' },
  '968': { country: 'Oman', nationality: 'Omani', region: 'AS' },
  '970': { country: 'Palestine', nationality: 'Palestinian', region: 'AS' },
  '971': { country: 'United Arab Emirates', nationality: 'Emirati', region: 'AS' },
  '972': { country: 'Israel', nationality: 'Israeli', region: 'AS' },
  '973': { country: 'Bahrain', nationality: 'Bahraini', region: 'AS' },
  '974': { country: 'Qatar', nationality: 'Qatari', region: 'AS' },
  '977': { country: 'Nepal', nationality: 'Nepali', region: 'AS' },
  '992': { country: 'Tajikistan', nationality: 'Tajik', region: 'AS' },
  '993': { country: 'Turkmenistan', nationality: 'Turkmen', region: 'AS' },
  '994': { country: 'Azerbaijan', nationality: 'Azerbaijani', region: 'AS' },
  '995': { country: 'Georgia', nationality: 'Georgian', region: 'AS' },
  '998': { country: 'Uzbekistan', nationality: 'Uzbek', region: 'AS' },
};

// ── Gender inference from first name ────────────────────────
// Common name → gender patterns (expandable)
const MALE_NAMES = new Set([
  'ahmed', 'ali', 'amit', 'andrew', 'arjun', 'benjamin', 'charles', 'david',
  'deepak', 'edward', 'faisal', 'george', 'hamid', 'hassan', 'ibrahim',
  'james', 'john', 'joseph', 'khalid', 'kumar', 'manoj', 'michael',
  'mohammed', 'muhammad', 'omar', 'patrick', 'peter', 'rahul', 'rajesh',
  'robert', 'rohit', 'sanjay', 'suresh', 'thomas', 'vikram', 'william',
  'sohail', 'ayush', 'harish', 'manish', 'manoj', 'nicholas', 'walter',
  'amol', 'rodel', 'salim',
]);
const FEMALE_NAMES = new Set([
  'aisha', 'amina', 'anna', 'catherine', 'chloe', 'deepa', 'elena',
  'emma', 'fatima', 'grace', 'hannah', 'jessica', 'julia', 'kate',
  'lara', 'maria', 'maryam', 'nadia', 'neha', 'nisha', 'olivia',
  'priya', 'rachel', 'sarah', 'sophia', 'sunita', 'zara',
  'mabel', 'khushi', 'puja', 'andrea', 'vaishnavi',
]);

export class DataCleaningService {

  /** Clean and normalize a phone number, return { cleaned, countryCode, countryInfo } */
  static cleanPhone(raw) {
    if (!raw) return null;
    const str = String(raw).trim();

    // Remove junk values
    const junk = ['', '-', '0', '00', 'NA', 'N/A', 'na', 'n/a', 'null', 'NULL', 'None', '0000000000'];
    if (junk.includes(str)) return null;

    // Strip everything except digits and leading +
    let digits = str.replace(/[^0-9]/g, '');
    if (digits.length < 7) return null;

    // Try to extract country code (longest match first)
    let countryCode = null;
    let countryInfo = null;
    for (const len of [3, 2, 1]) {
      const prefix = digits.slice(0, len);
      if (COUNTRY_CODE_MAP[prefix]) {
        countryCode = prefix;
        countryInfo = COUNTRY_CODE_MAP[prefix];
        break;
      }
    }

    return {
      cleaned: '+' + digits,
      digits,
      countryCode,
      countryInfo,
    };
  }

  /** Infer gender from first name */
  static inferGender(fullName) {
    if (!fullName) return null;
    const first = fullName.trim().split(/\s+/)[0].toLowerCase();
    if (MALE_NAMES.has(first)) return 'male';
    if (FEMALE_NAMES.has(first)) return 'female';

    // Heuristic: common endings
    if (first.endsWith('a') || first.endsWith('i') || first.endsWith('e')) return 'female';
    if (first.endsWith('deep') || first.endsWith('raj') || first.endsWith('esh')) return 'male';

    return null;
  }

  /** Clean a single email */
  static cleanEmail(raw) {
    if (!raw) return null;
    const str = String(raw).trim().toLowerCase();
    const junk = ['', 'null', 'n/a', 'na', '-', '0'];
    if (junk.includes(str)) return null;
    if (!str.includes('@')) return null;
    return str;
  }

  /** Infer nationality from country code in phone number */
  static inferNationalityFromPhone(phoneData) {
    if (!phoneData || !phoneData.countryInfo) return null;
    return phoneData.countryInfo.nationality;
  }

  /** Run full enrichment on all customer_segments rows */
  static async enrichAllCustomers() {
    const { rows } = await query(`
      SELECT email, full_name, phone, mobile, whatsapp_id, country, nationality, gender, phone_clean
      FROM customer_segments
      ORDER BY email
    `);

    let enriched = 0;
    const batchSize = 100;
    const enrichments = [];

    for (const row of rows) {
      const updates = {};
      const logs = [];

      // 1. Clean phone
      const phoneRaw = row.phone || row.mobile || row.whatsapp_id;
      const phoneData = DataCleaningService.cleanPhone(phoneRaw);
      if (phoneData && !row.phone_clean) {
        updates.phone_clean = phoneData.cleaned;
        updates.phone_country_code = phoneData.countryCode;
        logs.push({ field: 'phone_clean', old: row.phone, new: phoneData.cleaned, source: 'normalization', confidence: 0.95 });
      }

      // 2. Infer nationality from phone country code (if missing)
      if (!row.nationality && phoneData && phoneData.countryInfo) {
        updates.nationality = phoneData.countryInfo.nationality;
        logs.push({ field: 'nationality', old: null, new: phoneData.countryInfo.nationality, source: 'country_code', confidence: 0.7 });
      }

      // 3. Infer gender from name (if missing)
      if (!row.gender && row.full_name) {
        const gender = DataCleaningService.inferGender(row.full_name);
        if (gender) {
          updates.gender = gender;
          logs.push({ field: 'gender', old: null, new: gender, source: 'name_inference', confidence: 0.65 });
        }
      }

      // 4. Compute enrichment score
      const fields = ['full_name', 'phone_clean', 'nationality', 'gender', 'country'];
      const filled = fields.filter(f => updates[f] || row[f]).length;
      updates.enrichment_score = (filled / fields.length).toFixed(2);

      if (Object.keys(updates).length > 1) { // more than just enrichment_score
        enrichments.push({ email: row.email, updates, logs });
        enriched++;
      }
    }

    // Batch update
    await transaction(async (client) => {
      for (const { email, updates, logs } of enrichments) {
        const setClauses = [];
        const values = [];
        let i = 1;
        for (const [key, val] of Object.entries(updates)) {
          setClauses.push(`${key} = $${i}`);
          values.push(val);
          i++;
        }
        values.push(email);
        await client.query(
          `UPDATE customer_segments SET ${setClauses.join(', ')} WHERE email = $${i}`,
          values
        );

        // Log enrichments
        for (const log of logs) {
          await client.query(
            `INSERT INTO enrichment_log (customer_email, field_name, old_value, new_value, source, confidence)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [email, log.field, log.old, log.new, log.source, log.confidence]
          );
        }
      }
    });

    return { total: rows.length, enriched };
  }

  /** Get enrichment stats */
  static async getEnrichmentStats() {
    const { rows } = await query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE phone_clean IS NOT NULL) AS has_clean_phone,
        COUNT(*) FILTER (WHERE gender IS NOT NULL) AS has_gender,
        COUNT(*) FILTER (WHERE nationality IS NOT NULL) AS has_nationality,
        COUNT(*) FILTER (WHERE phone_country_code IS NOT NULL) AS has_country_code,
        ROUND(AVG(COALESCE(enrichment_score, 0))::numeric, 2) AS avg_enrichment_score,
        COUNT(*) FILTER (WHERE gender = 'male') AS male_count,
        COUNT(*) FILTER (WHERE gender = 'female') AS female_count
      FROM customer_segments
    `);
    return rows[0];
  }
}
