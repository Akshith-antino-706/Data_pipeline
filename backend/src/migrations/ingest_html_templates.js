import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, '../../../mail_templates');

const TEMPLATES = [
  {
    file: 'rayna_day1_email_stacked_light.html',
    name: 'Day 1 — Welcome & Brand Intro',
    type: 'static',
    category: 'welcome',
    preview_text: 'Welcome to Rayna Tours — Dubai\'s #1 travel experience platform',
    placeholders: ['first_name', 'utm_link'],
  },
  {
    file: 'day2-cruise-emailer.html',
    name: 'Day 2 — Cruise Spotlight',
    type: 'static',
    category: 'cruise',
    preview_text: 'Set sail on unforgettable cruise experiences',
    placeholders: ['first_name', 'utm_link'],
  },
  {
    file: 'day3-visa-emailer-1.html',
    name: 'Day 3 — Visa Made Easy',
    type: 'static',
    category: 'visa',
    preview_text: 'Your passport to every destination — visa made easy',
    placeholders: ['first_name', 'utm_link'],
  },
  {
    file: 'day4-holidays-emailer.html',
    name: 'Day 4 — Holiday Packages',
    type: 'static',
    category: 'holidays',
    preview_text: 'Trending holiday packages & destinations',
    placeholders: ['first_name', 'utm_link'],
  },
  {
    file: 'day5-activities-emailer.html',
    name: 'Day 5 — Activities & Experiences',
    type: 'static',
    category: 'activities',
    preview_text: 'Top activities & experiences in Dubai',
    placeholders: ['first_name', 'utm_link'],
  },
];

async function ingest() {
  console.log('Ingesting HTML email templates...');

  // Clear old templates
  await pool.query('TRUNCATE email_html_templates CASCADE');
  console.log('Cleared old HTML templates');

  for (const t of TEMPLATES) {
    try {
      const filePath = join(TEMPLATE_DIR, t.file);
      const html = await readFile(filePath, 'utf-8');

      await pool.query(`
        INSERT INTO email_html_templates (name, type, category, html_body, placeholders, preview_text)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (name) DO UPDATE SET
          type = EXCLUDED.type, category = EXCLUDED.category, html_body = EXCLUDED.html_body,
          placeholders = EXCLUDED.placeholders, preview_text = EXCLUDED.preview_text, updated_at = NOW()
      `, [t.name, t.type, t.category, html, t.placeholders, t.preview_text]);

      console.log(`  ✓ ${t.name} (${(html.length / 1024).toFixed(1)}KB)`);
    } catch (err) {
      console.error(`  ✗ ${t.name}: ${err.message}`);
    }
  }

  // Now rebuild content_templates linked to HTML designs
  console.log('\nRebuilding content_templates...');
  await pool.query('TRUNCATE content_templates CASCADE');

  // Get HTML template IDs
  const { rows: htmlTemplates } = await pool.query('SELECT id, name, category FROM email_html_templates ORDER BY id');
  const htmlMap = Object.fromEntries(htmlTemplates.map(t => [t.category, t]));

  // B2C Email templates — linked to HTML designs
  const emailTemplates = [
    // PROSPECT journey
    { name: 'PROSPECT — Day 0 Welcome', segment: 'PROSPECT', subject: 'Welcome to Rayna Tours — your next adventure starts here', htmlCat: 'welcome', variables: ['first_name'] },
    { name: 'PROSPECT — Day 3 Holiday Inspiration', segment: 'PROSPECT', subject: 'Trending destinations & holiday packages', htmlCat: 'holidays', variables: ['first_name'] },
    { name: 'PROSPECT — Day 6 Cruise Spotlight', segment: 'PROSPECT', subject: 'Set sail — unforgettable cruise experiences', htmlCat: 'cruise', variables: ['first_name'] },
    { name: 'PROSPECT — Day 9 Activities Offer', segment: 'PROSPECT', subject: '20% off your first activity — exclusive offer', htmlCat: 'activities', variables: ['first_name', 'offer_tag'] },

    // ACTIVE_ENQUIRY journey
    { name: 'ACTIVE_ENQUIRY — Day 2 Cart Abandonment', segment: 'ACTIVE_ENQUIRY', subject: '{{first_name}}, you left something behind!', htmlCat: 'activities', variables: ['first_name', 'offer_tag'] },
    { name: 'ACTIVE_ENQUIRY — Day 5 Alternatives', segment: 'ACTIVE_ENQUIRY', subject: 'Still thinking? Here are more options you\'ll love', htmlCat: 'activities', variables: ['first_name'] },

    // FUTURE_TRAVEL journey
    { name: 'FUTURE_TRAVEL — Day 0 Pre-Trip Guide', segment: 'FUTURE_TRAVEL', subject: 'Your trip is coming! Here\'s your personalised guide', htmlCat: 'holidays', variables: ['first_name'] },
    { name: 'FUTURE_TRAVEL — Day 4 Visa Upsell', segment: 'FUTURE_TRAVEL', subject: 'Need a visa? We handle it end-to-end', htmlCat: 'visa', variables: ['first_name'] },

    // ON_TRIP journey
    { name: 'ON_TRIP — Day 3 Mid-Trip Upsell', segment: 'ON_TRIP', subject: '{{first_name}}, exclusive mid-trip offer — 15% off today', htmlCat: 'activities', variables: ['first_name', 'offer_tag'] },
    { name: 'ON_TRIP — Day 6 Airport Transfer', segment: 'ON_TRIP', subject: 'Leaving soon? Don\'t forget your airport transfer', htmlCat: 'activities', variables: ['first_name'] },

    // PAST_BOOKING journey
    { name: 'PAST_BOOKING — Day 3 Review + Discount', segment: 'PAST_BOOKING', subject: 'Rate your trip & get 10% off next booking', htmlCat: 'welcome', variables: ['first_name'] },
    { name: 'PAST_BOOKING — Day 7 Cruise Cross-Sell', segment: 'PAST_BOOKING', subject: 'Have you tried a cruise? Unforgettable experiences', htmlCat: 'cruise', variables: ['first_name'] },
    { name: 'PAST_BOOKING — Day 14 Holiday Rebook', segment: 'PAST_BOOKING', subject: 'Planning your next adventure? Early-bird deals', htmlCat: 'holidays', variables: ['first_name'] },

    // PAST_ENQUIRY journey
    { name: 'PAST_ENQUIRY — Day 0 Win-Back', segment: 'PAST_ENQUIRY', subject: 'We missed you! New experiences & deals inside', htmlCat: 'holidays', variables: ['first_name', 'offer_tag'] },
    { name: 'PAST_ENQUIRY — Day 7 Trending Activities', segment: 'PAST_ENQUIRY', subject: 'Trending now — top experiences this month', htmlCat: 'activities', variables: ['first_name'] },

    // OCCASION journey
    { name: 'OCCASION — Day 0 Festive Intro', segment: 'OCCASION', subject: '{{holiday_name}} is coming! Special offers inside', htmlCat: 'holidays', variables: ['first_name', 'holiday_name', 'offer_tag'] },
    { name: 'OCCASION — Day 7 Curated Deals', segment: 'OCCASION', subject: '{{holiday_name}} week — curated experiences', htmlCat: 'activities', variables: ['first_name', 'holiday_name', 'offer_tag'] },
    { name: 'OCCASION — Day 13 Final Push', segment: 'OCCASION', subject: '{{holiday_name}} is TOMORROW — final offers!', htmlCat: 'holidays', variables: ['first_name', 'holiday_name', 'offer_tag'] },
  ];

  // WhatsApp templates (plain text)
  const waTemplates = [
    { name: 'PROSPECT — WA Welcome', segment: 'PROSPECT', body: 'Hi {{first_name}}! Welcome to Rayna Tours 🌟\n\nWe\'re Dubai\'s #1 travel platform with 500+ tours, holidays, cruises & visa services.\n\n🎁 First-time offer: 20% off with code WELCOME20\n\nReply EXPLORE to see our top experiences!', variables: ['first_name'] },
    { name: 'ACTIVE_ENQUIRY — WA Quote', segment: 'ACTIVE_ENQUIRY', body: 'Hi {{first_name}}, thanks for your enquiry! 😊\n\nHere\'s your personalised quote. Book within 48 hours and get 10% off with code ENQUIRY10.\n\nWant to customise anything? Just reply here!', variables: ['first_name'] },
    { name: 'ACTIVE_ENQUIRY — WA Urgency', segment: 'ACTIVE_ENQUIRY', body: 'Hi {{first_name}}, only 3 spots left! 🔥\n\nYour 10% code ENQUIRY10 expires today at midnight.\n\nReply YES and I\'ll book it for you right now! 🎯', variables: ['first_name'] },
    { name: 'FUTURE_TRAVEL — WA Activity Picks', segment: 'FUTURE_TRAVEL', body: 'Hi {{first_name}}! Your trip is coming up soon 🎉\n\nHave you planned activities yet? Top picks:\n🏜️ Desert Safari — AED 149\n🚤 Yacht Cruise — AED 299\n🏙️ Burj Khalifa — AED 169\n\nReply with the activity name to book!', variables: ['first_name'] },
    { name: 'ON_TRIP — WA Welcome', segment: 'ON_TRIP', body: 'Hi {{first_name}}! Welcome to Dubai 🌟\n\nHere are today\'s top activities near you. Book any with 10% off code ONTRIP10.\n\nNeed help? Reply here — we\'re available 24/7.', variables: ['first_name'] },
    { name: 'ON_TRIP — WA Review Request', segment: 'ON_TRIP', body: 'Hi {{first_name}}, hope you had an amazing trip! 🎉\n\n⭐ Leave a review and get 10% off your next booking.\n\nThank you for choosing Rayna Tours!', variables: ['first_name'] },
    { name: 'PAST_BOOKING — WA Review', segment: 'PAST_BOOKING', body: 'Hi {{first_name}}! Hope you had an amazing experience 🌟\n\nWould you share a quick review? It helps other travellers.\n\n⭐ Review now and get 10% off your next booking!', variables: ['first_name'] },
    { name: 'PAST_BOOKING — WA Visa Cross-Sell', segment: 'PAST_BOOKING', body: 'Hi {{first_name}}! Planning your next trip? 🌍\n\nWe handle visas end-to-end:\n🛂 UAE visa — from AED 299\n🛂 Schengen — from AED 499\n\nJust send your passport copy!', variables: ['first_name'] },
    { name: 'PAST_BOOKING — WA Loyalty', segment: 'PAST_BOOKING', body: 'Hi {{first_name}}! As a loyal customer 💎\n\n🎁 12% OFF any experience this month\n🔑 Code: LOYAL12\n\nReply BOOK to get started 🎯', variables: ['first_name'] },
    { name: 'PAST_ENQUIRY — WA Comeback', segment: 'PAST_ENQUIRY', body: 'Hi {{first_name}}! 👋\n\nSpecial comeback offer: 15% OFF any booking\n🔑 Code: COMEBACK15\n⏰ Valid for 7 days\n\nReply BOOK to find the perfect experience!', variables: ['first_name'] },
    { name: 'PAST_ENQUIRY — WA Final', segment: 'PAST_ENQUIRY', body: 'Hi {{first_name}}, your 15% comeback code (COMEBACK15) expires in 48 hours! ⏰\n\nDon\'t miss this one!\n\nReply if you need help choosing 🎯', variables: ['first_name'] },
    { name: 'OCCASION — WA Festive Offer', segment: 'OCCASION', body: 'Hi {{first_name}}! 🎉\n\n{{holiday_name}} is around the corner! Exclusive deals:\n🏜️ Desert Safari — festive edition\n🚤 Yacht Cruise — celebration cruise\n\n🎁 Code {{offer_tag}} for extra discount!\n\nReply BOOK!', variables: ['first_name', 'holiday_name', 'offer_tag'] },
    { name: 'OCCASION — WA Urgency', segment: 'OCCASION', body: 'Hi {{first_name}}! ⏰\n\nOnly 4 days until {{holiday_name}}! 80% sold out.\n\n🎁 Code {{offer_tag}} — last few days!\n\nReply YES to lock your spot 🎯', variables: ['first_name', 'holiday_name', 'offer_tag'] },
  ];

  // B2B templates
  const b2bTemplates = [
    { name: 'B2B_ACTIVE — Product Update', segment: 'B2B_ACTIVE_PARTNER', channel: 'email', subject: 'New products & updated commission rates', body: 'Dear {{first_name}},\n\nHere are this month\'s new products and your updated commission rates...', variables: ['first_name'] },
    { name: 'B2B_ACTIVE — WA Volume Incentive', segment: 'B2B_ACTIVE_PARTNER', channel: 'whatsapp', body: 'Hi {{first_name}}! Great month so far 📊\n\nHit 50 bookings and unlock 15% commission on ALL products!\n\nNeed marketing materials? Reply MATERIALS', variables: ['first_name'] },
    { name: 'B2B_DORMANT — Re-engage', segment: 'B2B_DORMANT_PARTNER', channel: 'email', subject: 'We miss working with you! Here\'s what\'s new', body: 'Dear {{first_name}},\n\nIt\'s been a while. We\'ve added 45+ new products...\n\n🎁 Reactivation offer: 2% EXTRA commission for 30 days', variables: ['first_name'] },
    { name: 'B2B_DORMANT — WA Reactivation', segment: 'B2B_DORMANT_PARTNER', channel: 'whatsapp', body: 'Hi {{first_name}}! 👋\n\n2% EXTRA commission for 30 days!\n\nReply ACTIVATE to claim your bonus!', variables: ['first_name'] },
    { name: 'B2B_NEW_LEAD — Partnership Proposal', segment: 'B2B_NEW_LEAD', channel: 'email', subject: 'Your Rayna Tours partnership proposal — earn up to 18%', body: 'Dear {{first_name}},\n\nThank you for your interest!\n\n💰 Commission: 12-18%\n🚀 500+ products\n📞 Dedicated account manager', variables: ['first_name'] },
    { name: 'B2B_NEW_LEAD — WA Trial', segment: 'B2B_NEW_LEAD', channel: 'whatsapp', body: 'Hi {{first_name}}! I\'m your Rayna Tours account manager 🤝\n\n🎁 First 5 bookings at 0% commission — FREE to test\n\nReply START to set up your account!', variables: ['first_name'] },
    { name: 'B2B_PROSPECT — Introduction', segment: 'B2B_PROSPECT', channel: 'email', subject: 'Partner with Dubai\'s #1 travel platform — earn up to 18%', body: 'Dear {{first_name}},\n\nPartner with Rayna Tours:\n✓ 500+ products\n✓ Up to 18% commission\n✓ Weekly payments', variables: ['first_name'] },
    { name: 'B2B_PROSPECT — Commission Details', segment: 'B2B_PROSPECT', channel: 'email', subject: 'Earn up to 18% commission — here\'s how', body: 'Dear {{first_name}},\n\n💰 Commission tiers:\n• 1-49/month: 12%\n• 50-99/month: 15%\n• 100+/month: 18%', variables: ['first_name'] },
  ];

  // Insert email templates with HTML link
  for (const t of emailTemplates) {
    const htmlTpl = htmlMap[t.htmlCat];
    await pool.query(`
      INSERT INTO content_templates (name, channel, status, segment_label, subject, body, variables, html_template_id)
      VALUES ($1, 'email', 'approved', $2, $3, $4, $5, $6)
    `, [t.name, t.segment, t.subject, t.subject, t.variables, htmlTpl?.id || null]);
  }
  console.log(`  ✓ ${emailTemplates.length} email templates (HTML-linked)`);

  // Insert WhatsApp templates
  for (const t of waTemplates) {
    await pool.query(`
      INSERT INTO content_templates (name, channel, status, segment_label, body, variables)
      VALUES ($1, 'whatsapp', 'approved', $2, $3, $4)
    `, [t.name, t.segment, t.body, t.variables]);
  }
  console.log(`  ✓ ${waTemplates.length} WhatsApp templates`);

  // Insert B2B templates
  for (const t of b2bTemplates) {
    await pool.query(`
      INSERT INTO content_templates (name, channel, status, segment_label, subject, body, variables)
      VALUES ($1, $2, 'approved', $3, $4, $5, $6)
    `, [t.name, t.channel, t.segment, t.subject || null, t.body, t.variables]);
  }
  console.log(`  ✓ ${b2bTemplates.length} B2B templates`);

  // Summary
  const { rows: [counts] } = await pool.query(`
    SELECT (SELECT COUNT(*) FROM email_html_templates) as html,
      (SELECT COUNT(*) FROM content_templates WHERE html_template_id IS NOT NULL) as linked,
      (SELECT COUNT(*) FROM content_templates) as total
  `);
  console.log(`\nDone! ${counts.html} HTML templates, ${counts.linked}/${counts.total} content templates linked to HTML.`);

  process.exit(0);
}

ingest().catch(err => { console.error(err); process.exit(1); });
