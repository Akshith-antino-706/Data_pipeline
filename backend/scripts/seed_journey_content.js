/**
 * Seed authoritative content for every journey action node.
 *
 * Why: journey_flows reference templateIds that never existed (40 stale IDs).
 * Action: wipe legacy content_templates, insert a dedicated template per node
 *         with real copy, and remap journey_flows.nodes[].templateId to match.
 *
 * Preserves template 568 (referenced by campaigns + utm_tracking) and the
 * single email_html_templates row (id=23, the hand-crafted Day 5 layout).
 *
 * Run: node scripts/seed_journey_content.js
 */
import 'dotenv/config';
import db from '../src/config/database.js';

// ──────────────────────────────────────────────────────────────
// Email HTML wrapper — injected with {{first_name}}, {{utm_link}}, {{unsubscribe_link}}
// by EmailRenderer at send time. Keep inline CSS only (email-safe).
// ──────────────────────────────────────────────────────────────
function emailHtml({ heading, paragraphs, cta }) {
  const paras = paragraphs.map(p => `<p style="margin:0 0 16px;line-height:1.55;">${p}</p>`).join('\n    ');
  const ctaBtn = cta
    ? `<p style="margin:28px 0 20px;"><a href="{{utm_link}}" style="background:#C9A96E;color:#fff;padding:13px 28px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;letter-spacing:0.3px;">${cta}</a></p>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f1ec;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#fff;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
        <tr><td style="background:#0a0a0a;padding:18px 28px;border-radius:10px 10px 0 0;">
          <div style="color:#C9A96E;font-size:20px;font-weight:700;letter-spacing:1px;">RAYNA TOURS</div>
        </td></tr>
        <tr><td style="padding:32px 28px 8px;">
          <h1 style="margin:0 0 20px;font-size:22px;color:#0a0a0a;line-height:1.3;">${heading}</h1>
          <p style="margin:0 0 16px;line-height:1.55;">Hi {{first_name}},</p>
          ${paras}
          ${ctaBtn}
        </td></tr>
        <tr><td style="padding:20px 28px 28px;border-top:1px solid #eee;color:#888;font-size:12px;line-height:1.5;">
          Rayna Tours — Your gateway to UAE experiences.<br>
          <a href="{{unsubscribe_link}}" style="color:#888;text-decoration:underline;">Unsubscribe</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ──────────────────────────────────────────────────────────────
// Content definitions — one entry per action node across all journeys.
// Keyed by { journey_id, node_id }. channel mirrors the journey node.
// ──────────────────────────────────────────────────────────────
const CONTENT = [
  // ═══ Journey 106 — On Trip Upsell ═══════════════════════════
  { journey_id: 106, node_id: 'action-1', channel: 'whatsapp',
    body: "Welcome to the UAE, {{first_name}}! 🎉 We've hand-picked a few things you shouldn't miss today. Reply 'YES' and we'll send you our Day 1 hit-list." },
  { journey_id: 106, node_id: 'action-2', channel: 'whatsapp',
    body: "🏜️ Desert Safari tonight — 20% off when you book through Rayna. Dune bashing, camel ride, BBQ & belly dance. Tap: {{utm_link}}" },
  { journey_id: 106, node_id: 'action-3', channel: 'whatsapp',
    body: "Hope you're having a blast, {{first_name}}! Quick check-in — anything we can help with? Transfers, last-minute bookings, or a second activity this week?" },
  { journey_id: 106, node_id: 'action-4', channel: 'email',
    subject: "15% off your next UAE experience 🎁",
    html_heading: "Your next adventure, on us.",
    paragraphs: [
      "Since you're already in town, we'd love to send you off with one more unforgettable experience.",
      "Use code <strong>STAY15</strong> at checkout for 15% off any activity — valid for the rest of your trip only.",
      "Dhow cruises, helicopter tours, Abu Dhabi day trips, and more are all one tap away."
    ],
    cta_text: "Explore with 15% off" },
  { journey_id: 106, node_id: 'action-5', channel: 'whatsapp',
    body: "Thank you for riding with Rayna, {{first_name}}! 🌟 We hope your UAE trip was everything you imagined. We'd love a quick review — {{utm_link}}" },
  { journey_id: 106, node_id: 'action-6', channel: 'whatsapp',
    body: "Last day tips 📝 Check out at 12pm? Grab a beach hour at JBR, lunch at The Beach, then airport via Metro in 45 min. Need a transfer? Reply and we'll book you." },
  { journey_id: 106, node_id: 'action-7', channel: 'email',
    subject: "Your airport transfer — sorted in 60 seconds",
    html_heading: "Smooth ride to the airport.",
    paragraphs: [
      "Don't let your last day turn into a scramble for a cab.",
      "Book a private Rayna transfer from your hotel straight to DXB or AUH — fixed price, English-speaking driver, no surprise fares.",
      "Pick-up 3 hours before wheels-up is standard; we can go earlier if you prefer."
    ],
    cta_text: "Book my airport transfer" },

  // ═══ Journey 107 — Future Travel Pre-Trip ═══════════════════
  { journey_id: 107, node_id: 'action-1', channel: 'email',
    subject: "Your Rayna pre-trip guide is here 🧳",
    html_heading: "Everything you need, in one place.",
    paragraphs: [
      "Your trip is around the corner — time to plan the fun part.",
      "We've put together a pre-trip guide with the must-know details: visa reminders, local SIM tips, what to wear, and the handful of activities you'd regret missing.",
      "Skim it on your flight — or now, whichever works."
    ],
    cta_text: "Open the pre-trip guide" },
  { journey_id: 107, node_id: 'action-2', channel: 'whatsapp',
    body: "Trip getting close, {{first_name}}? 🗓️ Based on your dates, here are 3 activities most of our travellers loved. Tap to preview: {{utm_link}}" },
  { journey_id: 107, node_id: 'action-3', channel: 'email',
    subject: "5 UAE experiences you'd regret skipping",
    html_heading: "The must-do list.",
    paragraphs: [
      "Our travellers keep telling us the same thing — they wish they'd booked more before they landed.",
      "Here are five experiences that sell out first during peak season: Burj Khalifa at sunset, Desert Safari with BBQ, Dhow Cruise Marina, Abu Dhabi Mosque tour, and Atlantis Aquaventure.",
      "Lock them in now so you're not scrambling on arrival."
    ],
    cta_text: "See all 5 experiences" },
  { journey_id: 107, node_id: 'action-4', channel: 'email',
    subject: "Your UAE travel checklist ✅",
    html_heading: "Pack smart. Travel smarter.",
    paragraphs: [
      "One week to go — here's the checklist we send every Rayna traveller.",
      "Passport valid 6+ months, Type G adapters, modest dress for mosques, an unlocked phone for a local eSIM, and sunscreen (summer sun here doesn't play).",
      "Print it, screenshot it, or forward to a travel buddy."
    ],
    cta_text: "Open the checklist" },
  { journey_id: 107, node_id: 'action-5', channel: 'whatsapp',
    body: "✈️ Flying in soon? Pre-book your airport transfer and skip the taxi queue. Fixed price, meet & greet at arrivals. {{utm_link}}" },
  { journey_id: 107, node_id: 'action-6', channel: 'whatsapp',
    body: "🎒 Trip tomorrow, {{first_name}}! Quick reminder: we can have a driver waiting at arrivals with a name board. Reply 'TRANSFER' and we'll set it up in 2 min." },

  // ═══ Journey 108 — Active Enquiry Conversion Sprint ═════════
  { journey_id: 108, node_id: 'action-1', channel: 'whatsapp',
    body: "Hi {{first_name}}! 👋 Got your enquiry — here's a personalised quote tailored to your dates and group size. Any questions? Just reply. {{utm_link}}" },
  { journey_id: 108, node_id: 'action-2', channel: 'whatsapp',
    body: "⭐ 4.9/5 from 12,000+ travellers. Here's what Sarah from London said last week: \"Rayna made our Dubai trip — honestly couldn't have done it without them.\" Ready to book? {{utm_link}}" },
  { journey_id: 108, node_id: 'action-3', channel: 'email',
    subject: "10% off, just for you — expires in 48h",
    html_heading: "A little nudge, with 10% off.",
    paragraphs: [
      "We noticed you were checking out one of our experiences — still interested?",
      "Use <strong>BOOK10</strong> to knock 10% off your next booking. Works on any activity, any date. Expires in 48 hours.",
      "Worth booking now — prices tend to climb as dates get closer."
    ],
    cta_text: "Claim 10% off" },
  { journey_id: 108, node_id: 'action-4', channel: 'whatsapp',
    body: "⏰ Heads up {{first_name}} — your 10% off expires tomorrow. Need help choosing? Reply and I'll send you 2 picks based on your dates." },
  { journey_id: 108, node_id: 'action-5', channel: 'email',
    subject: "Not quite right? Here are 3 alternatives",
    html_heading: "Maybe one of these fits better.",
    paragraphs: [
      "If the first activity wasn't quite the vibe, no worries — we have 400+ experiences across the UAE.",
      "Based on your browse history, here are three that travellers with similar tastes booked instead.",
      "Preview each, pick what clicks, book in one tap."
    ],
    cta_text: "Show me alternatives" },
  { journey_id: 108, node_id: 'action-6', channel: 'whatsapp',
    body: "Final offer 🎯 Book today and we'll throw in a free airport transfer (worth AED 120). Code: FREERIDE. Valid only for the next 24h. {{utm_link}}" },

  // ═══ Journey 109 — Past Enquiry Win Back ════════════════════
  { journey_id: 109, node_id: 'action-1', channel: 'email',
    subject: "We missed you, {{first_name}} 👋",
    html_heading: "Long time no see.",
    paragraphs: [
      "You enquired with us a while back and we never heard from you again — that's on us.",
      "If you're still dreaming of a UAE trip, we'd love a second chance. Prices have dropped on some of our top experiences, and we've added 40+ new ones since you last looked.",
      "No pressure — just pop back and see what's new."
    ],
    cta_text: "Browse what's new" },
  { journey_id: 109, node_id: 'action-2', channel: 'email',
    subject: "Trending in the UAE this week 🔥",
    html_heading: "What everyone's booking right now.",
    paragraphs: [
      "A snapshot of what our travellers are loving this week:",
      "🏜️ Premium Desert Safari (up 38%), 🏙️ Burj Khalifa at sunset (sold out most evenings), 🌊 Dhow Marina Dinner Cruise (top rated all month).",
      "Get in while availability lasts."
    ],
    cta_text: "See what's trending" },
  { journey_id: 109, node_id: 'action-3', channel: 'whatsapp',
    body: "{{first_name}}, welcome back offer just for you — 15% off your first booking with code COMEBACK15 🎁 Valid 7 days. {{utm_link}}" },
  { journey_id: 109, node_id: 'action-4', channel: 'email',
    subject: "Our full UAE catalogue — 400+ experiences",
    html_heading: "Everything, in one place.",
    paragraphs: [
      "No pitches, just the catalogue — every experience we offer across Dubai, Abu Dhabi, Sharjah, RAK and Fujairah.",
      "Filter by city, category, price, or rating. Save what you like. Come back when you're ready.",
      "No enquiries required until you actually want to book."
    ],
    cta_text: "Open the full catalogue" },
  { journey_id: 109, node_id: 'action-5', channel: 'whatsapp',
    body: "Hey {{first_name}} 😊 This is a personal follow-up — if there was a reason you didn't book, I'd genuinely love to hear it. Just reply, no script." },
  { journey_id: 109, node_id: 'action-6', channel: 'email',
    subject: "Why 12,000+ travellers choose Rayna",
    html_heading: "What our past travellers say.",
    paragraphs: [
      "We don't blame you for being cautious — there's no shortage of tour operators in the UAE.",
      "Here's what sets us apart: 4.9/5 on TripAdvisor across 12,000+ reviews, 24/7 WhatsApp support, and a no-questions-asked refund policy if plans change.",
      "If you ever come back, we'll make sure it's worth it."
    ],
    cta_text: "Read real traveller stories" },
  { journey_id: 109, node_id: 'action-7', channel: 'whatsapp',
    body: "⏳ Last heads-up, {{first_name}} — your COMEBACK15 code expires tonight. No strings. If UAE isn't in the cards, just say 'pass' and we'll stop nudging. {{utm_link}}" },

  // ═══ Journey 110 — Past Booking Cross-Sell & Loyalty ════════
  { journey_id: 110, node_id: 'action-1', channel: 'whatsapp',
    body: "{{first_name}}, hope you loved your Rayna experience! 🌟 A quick 30-second review would mean the world to us — and to the next traveller deciding. {{utm_link}}" },
  { journey_id: 110, node_id: 'action-2', channel: 'email',
    subject: "Leave a review → get 10% off your next trip",
    html_heading: "Your words, our thank-you.",
    paragraphs: [
      "Reviews are the lifeblood of what we do — they help future travellers decide, and they help us keep getting better.",
      "Take 60 seconds to share your experience and we'll send you <strong>LOYAL10</strong> — 10% off anything, anytime, no expiry.",
      "Fair trade?"
    ],
    cta_text: "Leave a review" },
  { journey_id: 110, node_id: 'action-3', channel: 'email',
    subject: "Loved that? You'll love these 3 too",
    html_heading: "Picks based on your last trip.",
    paragraphs: [
      "Since you enjoyed your last experience with us, our team pulled 3 activities we think you'd love next time.",
      "Same curation, same quality, different vibe. From sky-high views to deep-sea dives.",
      "Save them to your wishlist — book whenever you're back."
    ],
    cta_text: "See your picks" },
  { journey_id: 110, node_id: 'action-4', channel: 'whatsapp',
    body: "🛂 Heading somewhere next? Rayna handles visas for 40+ countries. Fast-track processing, 24h status checks, real humans on WhatsApp. {{utm_link}}" },
  { journey_id: 110, node_id: 'action-5', channel: 'email',
    subject: "Refer a friend — both of you save AED 100",
    html_heading: "Good travel is shared.",
    paragraphs: [
      "Know someone planning a UAE trip? Send them your unique referral link.",
      "When they book, they get AED 100 off — and so do you, credited straight to your Rayna account.",
      "No caps, no expiries. Refer as many as you like."
    ],
    cta_text: "Get my referral link" },
  { journey_id: 110, node_id: 'action-6', channel: 'email',
    subject: "Early-bird prices for next season",
    html_heading: "Lock in before everyone else does.",
    paragraphs: [
      "Next peak season is already filling up — and prices will go up as it gets closer.",
      "Book now with our early-bird rates and freeze today's prices on any experience, any date up to 6 months out.",
      "Small deposit to hold, full flexibility to reschedule."
    ],
    cta_text: "Lock in early-bird pricing" },
  { journey_id: 110, node_id: 'action-7', channel: 'whatsapp',
    body: "🎁 Rayna loyalty perk for you: 15% off your next 3 bookings with code LOYAL15. No expiry. Use it whenever. Booking link → {{utm_link}}" },

  // ═══ Journey 111 — Prospect Awareness Nurture ═══════════════
  { journey_id: 111, node_id: 'action-1', channel: 'email',
    subject: "Welcome to Rayna — your UAE starts here 🌴",
    html_heading: "Hello and welcome.",
    paragraphs: [
      "Great to have you, {{first_name}}. We're Rayna — the team 12,000+ travellers trust to plan their UAE experiences.",
      "No spam, no pressure. Just hand-picked experiences, real humans on WhatsApp, and prices that actually make sense.",
      "Take a look around — start with our top 10 Dubai experiences below."
    ],
    cta_text: "Explore top 10 experiences" },
  { journey_id: 111, node_id: 'action-2', channel: 'email',
    subject: "Top 10 experiences in the UAE (2026)",
    html_heading: "The greatest hits, curated.",
    paragraphs: [
      "Burj Khalifa, Desert Safari, Atlantis Aquaventure, Abu Dhabi Mosque, Ski Dubai, Dhow Cruise, Helicopter Tour, Ain Dubai, Yas Waterworld, Museum of the Future.",
      "Not all at once — but at least three of these should be on your list.",
      "Each one's been tested, timed, and rated by our team."
    ],
    cta_text: "See all 10 with prices" },
  { journey_id: 111, node_id: 'action-3', channel: 'email',
    subject: "What real travellers say about Rayna",
    html_heading: "Proof over promises.",
    paragraphs: [
      "We could tell you we're great, but that's what every tour operator says.",
      "Instead — 4.9/5 across 12,000+ verified reviews, Certificate of Excellence on TripAdvisor 4 years running, and 38% of our bookings come from returning travellers.",
      "Read the reviews, then decide."
    ],
    cta_text: "See what people say" },
  { journey_id: 111, node_id: 'action-4', channel: 'email',
    subject: "First-booking offer: 20% off, on us 🎁",
    html_heading: "A welcome discount, with meaning.",
    paragraphs: [
      "Ready to try Rayna? Use <strong>FIRST20</strong> for 20% off your first booking — any activity, any date.",
      "Valid for 14 days. No minimum spend. One-time use per account.",
      "Most travellers who use it book a Desert Safari or Burj Khalifa — both are perfect entry points."
    ],
    cta_text: "Book with 20% off" },
  { journey_id: 111, node_id: 'action-5', channel: 'email',
    subject: "Our full experience catalogue — 400+ activities",
    html_heading: "Everything we offer, one scroll away.",
    paragraphs: [
      "400+ experiences across Dubai, Abu Dhabi, Sharjah, RAK, Fujairah, and beyond.",
      "Filter by category (adventure, culture, family, romance), by budget, by duration, or just by what's trending this week.",
      "Save what you like to your wishlist — no account needed to browse."
    ],
    cta_text: "Open the catalogue" },
  { journey_id: 111, node_id: 'action-6', channel: 'email',
    subject: "Last call — 20% off expires tonight ⏰",
    html_heading: "A heads up, nothing more.",
    paragraphs: [
      "Your <strong>FIRST20</strong> code expires at midnight tonight.",
      "If UAE's not on your mind right now, no worries — we'll be here whenever you're ready.",
      "But if you were on the fence, this is the nudge."
    ],
    cta_text: "Use FIRST20 before it's gone" },

  // ═══ Journey 112 — Holiday Festive Journey ══════════════════
  { journey_id: 112, node_id: 'action-1', channel: 'email',
    subject: "{{holiday_name}} is 3 months away — let's plan 🎉",
    html_heading: "Plan the festive trip, early.",
    paragraphs: [
      "{{holiday_name}} is coming up in 3 months, and the best UAE experiences always fill up first.",
      "We've lined up our curated festive collection: hotel + activity bundles, family-friendly day trips, and private chef dinners for the big day.",
      "Early-bird prices are open now — save up to 25% vs on-the-day rates."
    ],
    cta_text: "See festive picks" },
  { journey_id: 112, node_id: 'action-1b', channel: 'whatsapp',
    body: "✨ {{first_name}}, here's our {{holiday_name}} inspiration gallery — real travellers, real moments from past years. Swipe through, save a favourite. {{utm_link}}" },
  { journey_id: 112, node_id: 'action-2', channel: 'whatsapp',
    body: "🎁 {{holiday_name}} offer: book any experience today and lock in last year's prices. Code: FEST2026. {{utm_link}}" },
  { journey_id: 112, node_id: 'action-2b', channel: 'email',
    subject: "Early-bird {{holiday_name}} deals — save up to 25%",
    html_heading: "The sooner, the cheaper.",
    paragraphs: [
      "Festive season prices are already climbing. Book now for up to 25% off our most-wanted experiences for {{holiday_name}}.",
      "Hotel + activity bundles, family packages, and private-group rates are all part of the early-bird window.",
      "Window closes 30 days before the holiday — don't wait."
    ],
    cta_text: "Shop early-bird" },
  { journey_id: 112, node_id: 'action-3', channel: 'email',
    subject: "Your curated {{holiday_name}} deals",
    html_heading: "Hand-picked for the season.",
    paragraphs: [
      "Our team curated these deals specifically for travellers planning around {{holiday_name}}.",
      "From fireworks cruises to festive buffets at Atlantis, to private desert camps under a holiday sky — these are the ones we'd book ourselves.",
      "Limited spots per experience."
    ],
    cta_text: "See curated deals" },
  { journey_id: 112, node_id: 'action-4', channel: 'whatsapp',
    body: "⏰ {{first_name}}, two weeks to {{holiday_name}}. Most festive experiences have <30% availability left. Don't get stuck with leftovers. {{utm_link}}" },
  { journey_id: 112, node_id: 'action-4b', channel: 'email',
    subject: "{{holiday_name}} — what our travellers say",
    html_heading: "Real stories from past festive trips.",
    paragraphs: [
      "\"We did the festive Dhow cruise for our anniversary and it was magical\" — Priya, Mumbai",
      "\"Private chef at our villa for Eid dinner — our kids still talk about it\" — Ahmed, Riyadh",
      "\"Booked the Burj Khalifa fireworks package last minute and it saved our trip\" — Lena, Berlin"
    ],
    cta_text: "See more stories" },
  { journey_id: 112, node_id: 'action-5', channel: 'email',
    subject: "Final push — {{holiday_name}} is days away 🎇",
    html_heading: "Last call for festive bookings.",
    paragraphs: [
      "If you've been waiting to book your {{holiday_name}} experience, this is it.",
      "Most hotels and top activities will be fully booked within 48 hours.",
      "We've kept a small inventory aside for last-minute bookers — use code FESTLAST for an extra 10% off."
    ],
    cta_text: "Book before sold out" },
  { journey_id: 112, node_id: 'action-5b', channel: 'whatsapp',
    body: "🚨 Last chance, {{first_name}} — {{holiday_name}} is 2 days away. Literally 3-4 spots left across our top 10 festive experiences. {{utm_link}}" },

  // ═══ Journey 113 — B2B Active Partner Nurture ═══════════════
  { journey_id: 113, node_id: 'action-1', channel: 'email',
    subject: "Rayna product update — Q2 2026",
    html_heading: "What's new in your dashboard.",
    paragraphs: [
      "Hi {{first_name}}, here's what the Rayna partner team shipped this quarter.",
      "New: real-time inventory webhooks, markup editor v2, auto-refund workflow, and a rebuilt reporting suite with CSV + API access.",
      "Full changelog in your partner portal."
    ],
    cta_text: "Open partner portal" },
  { journey_id: 113, node_id: 'action-2', channel: 'whatsapp',
    body: "{{first_name}}, Q2 volume incentive is live 📈 Hit 50+ bookings this quarter → 3% extra commission on every booking. Dashboard: {{utm_link}}" },
  { journey_id: 113, node_id: 'action-3', channel: 'email',
    subject: "UAE travel market intel — Q2",
    html_heading: "What's moving in the market.",
    paragraphs: [
      "Shared quarterly with Rayna partners only.",
      "Top trends this quarter: (1) GCC shoulder-season demand up 22%, (2) private group bookings now 31% of volume, (3) visa-on-arrival changes for 4 new markets.",
      "Full deck + raw data attached in the partner portal."
    ],
    cta_text: "Read the full intel report" },
  { journey_id: 113, node_id: 'action-4', channel: 'email',
    subject: "Your Rayna monthly partner report",
    html_heading: "Last month, at a glance.",
    paragraphs: [
      "Your snapshot for last month: bookings, revenue, top-performing products, and the experiences your customers kept asking about.",
      "We've also flagged 3 opportunities where we think you can lift your margin without touching price.",
      "Full interactive report in the portal — commentary inside."
    ],
    cta_text: "Open monthly report" },

  // ═══ Journey 114 — B2B Dormant Reactivation ═════════════════
  { journey_id: 114, node_id: 'action-1', channel: 'email',
    subject: "{{first_name}}, we miss your bookings 👋",
    html_heading: "Long time no book.",
    paragraphs: [
      "It's been a few months since your last booking with Rayna. Whatever changed, we'd love to win you back.",
      "Your partner account is still active — same commission rates, same API keys, same team on WhatsApp.",
      "If something wasn't working, just reply. We read every one."
    ],
    cta_text: "Back to the partner portal" },
  { journey_id: 114, node_id: 'action-2', channel: 'whatsapp',
    body: "{{first_name}}, reactivation offer for dormant partners: 2% extra commission on your next 20 bookings, no strings. Valid 30 days. {{utm_link}}" },
  { journey_id: 114, node_id: 'action-3', channel: 'email',
    subject: "Free training session — rebuild your pipeline",
    html_heading: "Complimentary partner training.",
    paragraphs: [
      "We're running a 45-minute session on 'How top Rayna partners grew 40% in 2025' — free for dormant partners.",
      "We'll cover: product mix, markup strategy, the booking funnel most partners get wrong, and a live Q&A.",
      "Pick a slot that works for you."
    ],
    cta_text: "Reserve my training slot" },
  { journey_id: 114, node_id: 'action-4', channel: 'whatsapp',
    body: "⏰ Last chance, {{first_name}} — your 2% bonus commission offer expires Friday. If UAE bookings aren't a fit anymore, just reply 'DONE' and we'll stop reaching out." },

  // ═══ Journey 115 — B2B New Lead Onboarding ══════════════════
  { journey_id: 115, node_id: 'action-1', channel: 'email',
    subject: "Welcome to Rayna Partners — your proposal inside",
    html_heading: "Let's build something.",
    paragraphs: [
      "Thanks for your interest, {{first_name}}. Attached is our standard partner proposal — commission tiers, API access, branded booking pages, and the full experience catalogue.",
      "Nothing locked — happy to tweak terms based on your volume and focus markets.",
      "Team call this week? Reply with 2-3 time windows."
    ],
    cta_text: "Open the partnership proposal" },
  { journey_id: 115, node_id: 'action-2', channel: 'whatsapp',
    body: "Hi {{first_name}}, I'll be your account manager at Rayna — direct line right here on WhatsApp. Any question, any hour. {{utm_link}}" },
  { journey_id: 115, node_id: 'action-3', channel: 'email',
    subject: "Your Rayna onboarding guide (step-by-step)",
    html_heading: "Get set up in a week.",
    paragraphs: [
      "Here's the onboarding checklist we walk every new partner through:",
      "1) API credentials + sandbox access, 2) markup + commission config, 3) first 10 products go-live, 4) booking test + payment reconciliation, 5) team training.",
      "Most partners complete it inside 5 working days."
    ],
    cta_text: "Start onboarding" },
  { journey_id: 115, node_id: 'action-4', channel: 'whatsapp',
    body: "🎁 Trial offer for new partners: 0% platform fee on your first 30 bookings + dedicated setup support. Ready to activate? {{utm_link}}" },
  { journey_id: 115, node_id: 'action-5', channel: 'whatsapp',
    body: "⏳ Your 0% trial window closes in 5 days, {{first_name}}. Need a hand getting the first bookings live? Reply and we'll jump on it together." },

  // ═══ Journey 116 — B2B Prospect Outreach ════════════════════
  { journey_id: 116, node_id: 'action-1', channel: 'email',
    subject: "Rayna x {{company}} — partnership intro",
    html_heading: "A quick intro.",
    paragraphs: [
      "Hi {{first_name}}, I'm reaching out because {{company}} looks like a strong fit for Rayna's partner programme.",
      "We supply 400+ UAE experiences with real-time inventory, B2B commissions up to 25%, and a no-code booking widget you can drop into your site in an afternoon.",
      "Worth a 15-minute chat?"
    ],
    cta_text: "Book a 15-min intro call" },
  { journey_id: 116, node_id: 'action-2', channel: 'email',
    subject: "Our B2B commission structure — transparent & tiered",
    html_heading: "The numbers, upfront.",
    paragraphs: [
      "Straightforward commissions, no haggling: 15% starter, 20% at 50 bookings/month, 25% at 200+.",
      "Paid weekly, no minimum threshold, detailed statements in the partner portal.",
      "Full fee schedule inside."
    ],
    cta_text: "See full commission structure" },
  { journey_id: 116, node_id: 'action-3', channel: 'email',
    subject: "What other travel partners say about Rayna",
    html_heading: "From partners like {{company}}.",
    paragraphs: [
      "\"Rayna's real-time inventory is the only one in UAE we actually trust\" — Head of Product, top MENA OTA.",
      "\"Commission reliability alone made the switch worth it\" — Founder, boutique DMC.",
      "\"Their API is the easiest we've integrated. Three days.\" — Engineering Lead, travel tech startup."
    ],
    cta_text: "See more partner stories" },
  { journey_id: 116, node_id: 'action-4', channel: 'email',
    subject: "Ready to apply? 2 minutes, no call required",
    html_heading: "Apply when it suits.",
    paragraphs: [
      "If a call feels premature, just apply — it's a 2-minute form.",
      "We'll review within 1 business day and only get on a call once we know there's a real fit.",
      "No pressure, no spam follow-ups."
    ],
    cta_text: "Apply to become a partner" },
];

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🌱 Seeding ${CONTENT.length} journey content templates\n`);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. Decouple dependent rows so we can wipe content_templates
    const { rowCount: campaignsDetached } = await client.query('UPDATE campaigns SET template_id = NULL WHERE template_id IS NOT NULL');
    const { rowCount: utmDetached } = await client.query('UPDATE utm_tracking SET template_id = NULL WHERE template_id IS NOT NULL');
    console.log(`  Detached: ${campaignsDetached} campaigns, ${utmDetached} utm_tracking`);

    // 2. Wipe all existing content_templates (clears the 22 legacy rows)
    const { rowCount: deleted } = await client.query('DELETE FROM content_templates');
    console.log(`  Deleted: ${deleted} legacy templates`);

    // 3. Insert new templates and remember the mapping {journey_id + node_id → new id}
    const nodeToTemplateId = new Map();
    for (const item of CONTENT) {
      const isEmail = item.channel === 'email';
      const name = `J${item.journey_id}-${item.node_id}`;
      const subject = isEmail ? item.subject : null;
      const bodyPlain = isEmail
        ? `Hi {{first_name}},\n\n${item.paragraphs.join('\n\n').replace(/<[^>]+>/g, '')}\n\nVisit: {{utm_link}}`
        : item.body;
      const bodyHtml = isEmail
        ? emailHtml({ heading: item.html_heading, paragraphs: item.paragraphs, cta: item.cta_text })
        : item.body;

      const { rows: [tpl] } = await client.query(
        `INSERT INTO content_templates (name, channel, status, subject, body, body_plain)
         VALUES ($1, $2, 'approved', $3, $4, $5) RETURNING id`,
        [name, item.channel, subject, bodyHtml, isEmail ? bodyPlain : null]
      );
      nodeToTemplateId.set(`${item.journey_id}::${item.node_id}`, tpl.id);
    }
    console.log(`  Inserted: ${CONTENT.length} new templates`);

    // 4. Remap every journey's action nodes to the new templateIds
    const { rows: journeys } = await client.query('SELECT journey_id, nodes FROM journey_flows');
    let nodesUpdated = 0, journeysUpdated = 0;

    for (const journey of journeys) {
      let changed = false;
      const newNodes = (journey.nodes || []).map(node => {
        if (node.type !== 'action') return node;
        const key = `${journey.journey_id}::${node.id}`;
        const newId = nodeToTemplateId.get(key);
        if (!newId) return node; // node not in our content set

        const newData = { ...node.data, templateId: String(newId) };

        // If the node has a restChannel auto-pair, remap restTemplateId too.
        // Find the matching fallback node by label (or reuse same id as a basic default).
        if (node.data?.restChannel) {
          // For simplicity, point restTemplateId at the same new template id —
          // the auto-pair was a channel switch, not different content.
          newData.restTemplateId = String(newId);
        }

        changed = true;
        nodesUpdated++;
        return { ...node, data: newData };
      });

      if (changed) {
        await client.query('UPDATE journey_flows SET nodes = $1 WHERE journey_id = $2',
          [JSON.stringify(newNodes), journey.journey_id]);
        journeysUpdated++;
      }
    }
    console.log(`  Remapped: ${nodesUpdated} nodes across ${journeysUpdated} journeys`);

    await client.query('COMMIT');
    console.log(`\n✅ Done.`);

    // Verify
    const { rows: [stats] } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM content_templates) AS templates,
        (SELECT COUNT(*) FROM journey_flows) AS journeys,
        (SELECT COUNT(*) FROM journey_flows, jsonb_array_elements(nodes) n
          WHERE n->>'type' = 'action'
            AND (n->'data'->>'templateId') IS NOT NULL
            AND (n->'data'->>'templateId')::bigint NOT IN (SELECT id FROM content_templates)
        ) AS stale_refs
    `);
    console.log(`\n  Templates in DB: ${stats.templates}`);
    console.log(`  Journeys: ${stats.journeys}`);
    console.log(`  Stale templateId refs remaining: ${stats.stale_refs}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
