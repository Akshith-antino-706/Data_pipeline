-- ============================================================
-- Migration 014: Product Affinity Engine
-- Maps departments → product categories → segment recommendations
-- Answers: WHAT to sell, WHEN to sell, HOW to sell per segment
-- ============================================================

-- ── 1. Department-Product Mapping Table ─────────────────────
CREATE TABLE IF NOT EXISTS department_product_map (
  id SERIAL PRIMARY KEY,
  department_pattern TEXT NOT NULL,         -- regex or ILIKE pattern to match dept names
  product_category TEXT NOT NULL,           -- normalized category
  product_line TEXT NOT NULL,               -- Tours, Visa, Cruises, Hotels, Packages, Transfers, Activities
  avg_ticket_value NUMERIC DEFAULT 0,
  priority INT DEFAULT 5,                   -- 1=highest
  created_at TIMESTAMPTZ DEFAULT NOW()
);

TRUNCATE department_product_map CASCADE;

INSERT INTO department_product_map (department_pattern, product_category, product_line, avg_ticket_value, priority) VALUES
-- Tours & Activities
('tours',           'Desert Safari & Tours',      'Tours',      350, 1),
('cruises',         'Cruises & Sailing',          'Cruises',    2500, 2),
('cruise',          'Cruises & Sailing',          'Cruises',    2500, 2),
('b2b',             'B2B Wholesale',              'B2B',        1500, 3),
('b2c',             'Direct Consumer Tours',      'Tours',      400, 1),
('visa',            'Visa Services',              'Visa',       200, 4),
('intvisas',        'International Visa',         'Visa',       300, 4),
('intvisatyping',   'International Visa',         'Visa',       300, 4),
('uaevisa',         'UAE Visa',                   'Visa',       150, 4),
('dxbvisa',         'Dubai Visa',                 'Visa',       150, 4),
('online',          'Online Bookings',            'Tours',      300, 1),
('sales',           'Sales',                      'Tours',      500, 1),
('inquiry',         'General Inquiry',            'Tours',      300, 5),
('query',           'General Inquiry',            'Tours',      300, 5),
('booking',         'Bookings',                   'Tours',      400, 1),
('topup',           'Top-up & Wallet',            'Payments',   100, 6),
('payments',        'Payments & Refunds',         'Payments',   0, 7),
('refund',          'Payments & Refunds',         'Payments',   0, 7),
('billing',         'Billing',                    'Payments',   0, 7),
('hotel',           'Hotel Stays',                'Hotels',     800, 2),
('reservations',    'Hotel Reservations',         'Hotels',     800, 2),
('reservation',     'Hotel Reservations',         'Hotels',     800, 2),
('res',             'Hotel Reservations',         'Hotels',     800, 2),
('staycation',      'Staycation',                 'Hotels',     600, 2),
('packages',        'Holiday Packages',           'Packages',   2000, 2),
('holidays',        'Holiday Packages',           'Packages',   2000, 2),
('vacations',       'Holiday Packages',           'Packages',   2000, 2),
('mice',            'MICE & Corporate',           'Corporate',  5000, 3),
('grouprates',      'Group Rates',                'Corporate',  3000, 3),
('contracting',     'Contracting',                'Corporate',  2000, 3),
('outbound',        'Outbound Tours',             'Packages',   1500, 2),
('inbound',         'Inbound Tours',              'Tours',      500, 1),
('singapore',       'Singapore Packages',         'Packages',   1500, 2),
('thailand',        'Thailand Packages',          'Packages',   1200, 2),
('operations',      'Operations',                 'Tours',      0, 7),
('transfer',        'Airport Transfers',          'Transfers',  250, 5),
('forex',           'Forex & Currency',           'Payments',   0, 7),
('marketing',       'Marketing',                  'Tours',      0, 7),
('promotions',      'Promotions',                 'Tours',      0, 7),
('cs',              'Customer Service',           'Tours',      0, 7),
('support',         'Customer Support',           'Tours',      0, 7),
('tickets',         'Theme Park Tickets',         'Activities', 200, 1),
('activities',      'Activities & Adventures',    'Activities', 300, 1);


-- ── 2. Product Affinity per Segment Table ───────────────────
CREATE TABLE IF NOT EXISTS segment_product_affinity (
  id SERIAL PRIMARY KEY,
  segment_id INT REFERENCES segment_definitions(segment_id) ON DELETE CASCADE,

  -- WHAT to sell
  primary_products TEXT[] NOT NULL,          -- top 3 product categories to push
  cross_sell_products TEXT[] DEFAULT '{}',   -- complementary products
  upsell_products TEXT[] DEFAULT '{}',       -- premium upgrades
  hero_product TEXT,                         -- single best product for this segment
  hero_product_url TEXT,                     -- link to the hero product
  hero_product_image TEXT,                   -- CDN image URL

  -- WHEN to sell
  best_send_day TEXT DEFAULT 'Tuesday',       -- best day of week
  best_send_time TEXT DEFAULT '10:00',        -- best time (HH:MM)
  urgency_level TEXT DEFAULT 'medium',        -- low, medium, high, critical
  send_frequency TEXT DEFAULT 'weekly',       -- daily, twice_weekly, weekly, biweekly, monthly
  trigger_event TEXT,                         -- what triggers the campaign (cart_abandon, post_booking, etc.)
  follow_up_days INT[] DEFAULT '{3,7,14}',   -- follow-up sequence in days

  -- HOW to sell
  recommended_channel TEXT DEFAULT 'email',   -- primary channel
  secondary_channel TEXT DEFAULT 'whatsapp',  -- fallback channel
  tone TEXT DEFAULT 'friendly',               -- urgent, friendly, premium, casual, professional
  discount_strategy TEXT,                     -- no_discount, percentage, fixed, bundle, coupon
  discount_value TEXT,                        -- e.g. "10%", "AED 50", "RAYNOW"
  cta_text TEXT DEFAULT 'Book Now',           -- call-to-action text
  cta_style TEXT DEFAULT 'button',            -- button, link, reply
  personalization_fields TEXT[],              -- fields to personalize: first_name, nationality, etc.
  social_proof BOOLEAN DEFAULT false,         -- include ratings/reviews
  scarcity_messaging BOOLEAN DEFAULT false,   -- "Only 3 left!", "Selling fast!"

  -- Affinity scores
  affinity_score NUMERIC DEFAULT 0,           -- composite score 0-100
  expected_conversion_rate NUMERIC DEFAULT 0, -- estimated %
  expected_aov NUMERIC DEFAULT 0,             -- average order value

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

TRUNCATE segment_product_affinity CASCADE;

-- ── 3. Seed Product Affinity for ALL 28 Segments ────────────

-- Get segment IDs dynamically
DO $$
DECLARE
  s RECORD;
BEGIN
  FOR s IN SELECT segment_id, segment_number, segment_name FROM segment_definitions ORDER BY segment_number
  LOOP
    CASE s.segment_number

    -- ═══ STAGE 1: AWARENESS ═══════════════════════════════
    WHEN 1 THEN -- Social Ad Leads
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Desert Safari & Tours', 'Theme Park Tickets', 'Activities & Adventures'],
        ARRAY['Dhow Cruise', 'City Tour', 'Airport Transfers'],
        'Desert Safari Dubai', 'https://www.raynatours.com/dubai/desert-safari-tours', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg',
        'Thursday', '18:00', 'high', 'daily', 'ad_click', '{1,3,7}',
        'whatsapp', 'email', 'urgent', 'percentage', '15%', 'Grab This Deal →',
        ARRAY['first_name', 'lead_source'], true, true, 75, 8.5, 350);

    WHEN 2 THEN -- Website Browsers
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Desert Safari & Tours', 'Activities & Adventures', 'Cruises & Sailing'],
        ARRAY['Holiday Packages', 'Visa Services'],
        'Dubai City Tour', 'https://www.raynatours.com/dubai/city-tours', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Half-Day-Abu-Dhabi-City-Tour-19392/1760092859715_3_2.jpg',
        'Tuesday', '11:00', 'medium', 'twice_weekly', 'page_view', '{2,5,10}',
        'email', 'whatsapp', 'friendly', 'percentage', '5%', 'Explore Dubai →',
        ARRAY['first_name'], true, false, 55, 4.2, 280);

    WHEN 3 THEN -- WhatsApp First-Touch
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Desert Safari & Tours', 'Visa Services', 'Theme Park Tickets'],
        ARRAY['Airport Transfers', 'City Tour'],
        'Desert Safari + BBQ Dinner', 'https://www.raynatours.com/dubai/desert-safari-tours', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg',
        'Wednesday', '10:00', 'high', 'daily', 'whatsapp_enquiry', '{1,2,5}',
        'whatsapp', 'email', 'casual', 'coupon', 'RAYNOW', 'Reply YES to Book!',
        ARRAY['first_name', 'nationality'], false, true, 70, 12.0, 320);

    -- ═══ STAGE 2: CONSIDERATION ═══════════════════════════
    WHEN 4 THEN -- Fresh Cart Abandoners (0-3 days)
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, upsell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Abandoned Cart Product'],  -- dynamic: whatever they left in cart
        ARRAY['Airport Transfers', 'Dhow Cruise'],
        ARRAY['VIP Desert Safari', 'Private Tour Upgrade'],
        'Their Abandoned Product', '', '',
        'Same Day', '19:00', 'critical', 'daily', 'cart_abandon', '{0,1,3}',
        'whatsapp', 'email', 'urgent', 'percentage', '10%', 'Complete Your Booking →',
        ARRAY['first_name', 'abandoned_product'], false, true, 95, 22.0, 400);

    WHEN 5 THEN -- Stale Cart Abandoners (4-14 days)
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, upsell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Abandoned Cart Product', 'Desert Safari & Tours', 'Theme Park Tickets'],
        ARRAY['Combo Packages', 'Holiday Packages'],
        ARRAY['Premium Packages'],
        'Their Abandoned Product + Alternative', '', '',
        'Monday', '10:00', 'high', 'twice_weekly', 'cart_abandon_stale', '{1,4,7}',
        'email', 'whatsapp', 'friendly', 'percentage', '20%', 'Still Interested? Save 20% →',
        ARRAY['first_name', 'abandoned_product'], true, true, 80, 15.0, 380);

    WHEN 6 THEN -- Active Enquirers
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Enquired Product Category', 'Desert Safari & Tours', 'Visa Services'],
        ARRAY['Airport Transfers', 'Hotel Stays'],
        'Product They Enquired About', '', '',
        'Same Day', '14:00', 'high', 'daily', 'enquiry_received', '{0,2,5}',
        'whatsapp', 'email', 'professional', 'coupon', 'RAYNOW', 'Book Now, Pay Later →',
        ARRAY['first_name', 'enquiry_topic'], true, false, 85, 18.0, 450);

    WHEN 7 THEN -- Hesitant Browsers
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Most Viewed Products', 'Desert Safari & Tours', 'Theme Park Tickets'],
        ARRAY['Combo Packages', 'Cruises & Sailing'],
        'Bestselling Tour', 'https://www.raynatours.com/dubai/desert-safari-tours', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg',
        'Wednesday', '20:00', 'medium', 'twice_weekly', 'browse_threshold', '{3,7,14}',
        'email', 'whatsapp', 'friendly', 'percentage', '10%', 'Thousands Have Loved This →',
        ARRAY['first_name'], true, true, 65, 6.5, 300);

    WHEN 8 THEN -- Payment Failed
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Failed Payment Product', 'Desert Safari & Tours', 'Theme Park Tickets'],
        ARRAY['Airport Transfers'],
        'Same Product — Retry Payment', '', '',
        'Same Day', '09:00', 'critical', 'daily', 'payment_failed', '{0,1,2}',
        'whatsapp', 'email', 'helpful', 'no_discount', NULL, 'Try Again — We Saved Your Booking →',
        ARRAY['first_name'], false, true, 90, 35.0, 420);

    -- ═══ STAGE 3: CONVERSION ══════════════════════════════
    WHEN 9 THEN -- Registered Not Booked
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Desert Safari & Tours', 'Theme Park Tickets', 'Activities & Adventures'],
        ARRAY['Visa Services', 'Holiday Packages'],
        'Desert Safari Dubai', 'https://www.raynatours.com/dubai/desert-safari-tours', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg',
        'Tuesday', '10:00', 'medium', 'weekly', 'registration_stale', '{7,14,21}',
        'email', 'whatsapp', 'friendly', 'coupon', 'WELCOME10', 'Start Your Adventure →',
        ARRAY['first_name', 'registration_source'], true, false, 60, 5.0, 300);

    WHEN 10 THEN -- New Customers (0-30 days)
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, upsell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Complementary to Last Booking', 'Cruises & Sailing', 'Activities & Adventures'],
        ARRAY['Dhow Cruise', 'City Tour', 'Theme Park Tickets'],
        ARRAY['Premium Desert Safari', 'Private Tour', 'Yacht Tour'],
        'Dhow Cruise Dubai', 'https://www.raynatours.com/dubai/dhow-cruise', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/false-241/dhow-cruise-dinner-in-abu-dhabi-front.jpg',
        'Thursday', '18:00', 'medium', 'weekly', 'post_first_booking', '{2,7,14}',
        'email', 'whatsapp', 'friendly', 'bundle', '15% combo', 'Complete Your Dubai Experience →',
        ARRAY['first_name', 'last_booking'], true, false, 80, 15.0, 500);

    WHEN 11 THEN -- Post-Trip Review Window
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Next Experience', 'Cruises & Sailing', 'Holiday Packages'],
        ARRAY['Review Incentive', 'Referral Program'],
        'Abu Dhabi Day Trip', 'https://www.raynatours.com/abu-dhabi/city-tours', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Half-Day-Abu-Dhabi-City-Tour-19392/1760092859715_3_2.jpg',
        'Monday', '10:00', 'low', 'once', 'trip_completed', '{1,3}',
        'email', 'whatsapp', 'grateful', 'coupon', 'THANKYOU10', 'Leave a Review & Get 10% Off →',
        ARRAY['first_name', 'trip_name'], false, false, 70, 12.0, 400);

    WHEN 12 THEN -- One-Time Buyers (31-90 days)
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, upsell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Different Category from First', 'Cruises & Sailing', 'Visa Services'],
        ARRAY['Holiday Packages', 'Activities & Adventures'],
        ARRAY['Combo Packages', 'Premium Tours'],
        'Bestselling Combo', 'https://www.raynatours.com/dubai/desert-safari-tours', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg',
        'Tuesday', '11:00', 'medium', 'biweekly', 'days_since_booking', '{14,30,60}',
        'email', 'whatsapp', 'friendly', 'coupon', 'RAYNOW', 'Your Next Adventure Awaits →',
        ARRAY['first_name', 'last_booking'], true, false, 65, 8.0, 380);

    -- ═══ STAGE 4: GROWTH ══════════════════════════════════
    WHEN 13 THEN -- Repeat Buyers
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, upsell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Untried Categories', 'Cruises & Sailing', 'Holiday Packages'],
        ARRAY['Visa Services', 'Airport Transfers'],
        ARRAY['Premium Desert Safari', 'Private Yacht Tour', 'Helicopter Ride'],
        'Cruise Experience', 'https://www.raynatours.com/dubai/dhow-cruise', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/false-241/dhow-cruise-dinner-in-abu-dhabi-front.jpg',
        'Thursday', '12:00', 'low', 'weekly', 'repeat_booking', '{7,21}',
        'email', 'whatsapp', 'premium', 'bundle', '15% on combos', 'Explore Something New →',
        ARRAY['first_name', 'total_bookings'], false, false, 85, 20.0, 600);

    WHEN 14 THEN -- Frequent Travelers (4+ bookings)
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, upsell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Premium Experiences', 'Cruises & Sailing', 'Holiday Packages'],
        ARRAY['MICE & Corporate', 'Referral Program'],
        ARRAY['Private Charter', 'Luxury Yacht', 'VIP Experience'],
        'Premium Desert Safari VIP', 'https://www.raynatours.com/dubai/desert-safari-tours', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg',
        'Tuesday', '10:00', 'low', 'weekly', 'loyalty_milestone', '{7,14}',
        'email', 'whatsapp', 'premium', 'fixed', 'AED 100 off', 'Your VIP Reward →',
        ARRAY['first_name', 'total_bookings', 'loyalty_tier'], false, false, 90, 25.0, 800);

    WHEN 15 THEN -- High Spenders (5000+ AED)
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, upsell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Luxury Experiences', 'Cruises & Sailing', 'Holiday Packages'],
        ARRAY['Private Charters', 'Concierge Service'],
        ARRAY['Helicopter Tour', 'Luxury Yacht Charter', 'Exclusive Dining'],
        'Luxury Yacht Dubai', 'https://www.raynatours.com/dubai/water-activities', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Ski-Dubai-from-Abu-Dhabi-5832/1760080735059_3_2.jpg',
        'Wednesday', '11:00', 'low', 'biweekly', 'high_value_trigger', '{7,30}',
        'email', 'whatsapp', 'premium', 'no_discount', NULL, 'Exclusive Invitation →',
        ARRAY['first_name', 'total_revenue'], false, true, 92, 22.0, 1500);

    WHEN 16 THEN -- Visa-Only → Tour Cross-Sell
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Desert Safari & Tours', 'Theme Park Tickets', 'Activities & Adventures'],
        ARRAY['Airport Transfers', 'City Tour', 'Hotel Stays'],
        'Desert Safari + City Tour Combo', 'https://www.raynatours.com/dubai/desert-safari-tours', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg',
        'Monday', '10:00', 'high', 'twice_weekly', 'visa_approved', '{1,3,7}',
        'whatsapp', 'email', 'helpful', 'coupon', 'VISABONUS', 'You Have the Visa — Now Book the Fun! →',
        ARRAY['first_name', 'visa_type', 'travel_date'], true, true, 88, 25.0, 500);

    WHEN 17 THEN -- Tour-Only → Visa Cross-Sell
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Visa Services', 'Holiday Packages', 'International Visa'],
        ARRAY['Airport Transfers', 'Hotel Stays'],
        'UAE Tourist Visa', 'https://www.raynatours.com/uae-visa', '',
        'Tuesday', '10:00', 'medium', 'biweekly', 'multi_booking', '{7,14}',
        'email', 'whatsapp', 'professional', 'bundle', 'Visa + Tour combo', 'Need a Visa for Friends/Family? →',
        ARRAY['first_name', 'nationality'], false, false, 72, 12.0, 350);

    -- ═══ STAGE 5: WIN-BACK ════════════════════════════════
    WHEN 18 THEN -- Cooling Down (31-60 days)
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['New Experiences', 'Cruises & Sailing', 'Seasonal Tours'],
        ARRAY['Activities & Adventures', 'Theme Park Tickets'],
        'Whats New in Dubai', 'https://www.raynatours.com/dubai', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg',
        'Tuesday', '18:00', 'medium', 'weekly', 'inactivity_30d', '{7,14,21}',
        'email', 'whatsapp', 'friendly', 'no_discount', NULL, 'See What is New →',
        ARRAY['first_name', 'last_booking'], false, false, 68, 10.0, 400);

    WHEN 19 THEN -- At Risk (61-120 days)
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Past Favorites', 'Desert Safari & Tours', 'Cruises & Sailing'],
        ARRAY['Combo Packages', 'Holiday Packages'],
        'Desert Safari + Dhow Cruise Combo', 'https://www.raynatours.com/dubai/desert-safari-tours', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg',
        'Thursday', '10:00', 'high', 'twice_weekly', 'inactivity_60d', '{3,7,14,28}',
        'email', 'whatsapp', 'warm', 'coupon', 'WEMISSYOU15', 'We Miss You — 15% Off →',
        ARRAY['first_name', 'last_booking', 'days_since'], true, true, 72, 8.0, 420);

    WHEN 20 THEN -- Hibernating (121-180 days)
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Bestsellers', 'Desert Safari & Tours', 'Theme Park Tickets'],
        ARRAY['Activities & Adventures', 'Visa Services'],
        'Dubai Bestsellers Bundle', 'https://www.raynatours.com/dubai', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg',
        'Monday', '10:00', 'high', 'weekly', 'inactivity_120d', '{3,7,14,28}',
        'email', 'whatsapp', 'warm', 'percentage', '20%', 'Come Back & Save 20% →',
        ARRAY['first_name', 'days_since'], true, true, 55, 5.0, 350);

    WHEN 21 THEN -- Lost High-Value (180+ days, 3000+ AED)
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, upsell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Premium Past Favorites', 'Cruises & Sailing', 'Luxury Experiences'],
        ARRAY['Holiday Packages', 'Private Charters'],
        ARRAY['VIP Experience', 'Exclusive Access'],
        'VIP Desert Safari', 'https://www.raynatours.com/dubai/desert-safari-tours', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg',
        'Wednesday', '11:00', 'critical', 'biweekly', 'inactivity_180d', '{3,7,14,28}',
        'email', 'whatsapp', 'premium', 'fixed', 'AED 200 off', 'VIP Exclusive: AED 200 Off →',
        ARRAY['first_name', 'total_revenue', 'days_since'], false, true, 45, 3.5, 800);

    WHEN 22 THEN -- Lost Regular (180+ days, <3000 AED)
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Bestsellers', 'Desert Safari & Tours', 'Theme Park Tickets'],
        ARRAY['Activities & Adventures', 'Visa Services'],
        'Desert Safari — Best Price', 'https://www.raynatours.com/dubai/desert-safari-tours', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg',
        'Tuesday', '10:00', 'high', 'monthly', 'inactivity_180d', '{7,14,30}',
        'email', 'whatsapp', 'casual', 'percentage', '25%', 'Last Chance: 25% Off →',
        ARRAY['first_name'], true, true, 35, 2.0, 280);

    -- ═══ STAGE 6: ADVOCACY ════════════════════════════════
    WHEN 23 THEN -- Happy Reviewers (4-5 Stars)
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Untried Experiences', 'Cruises & Sailing', 'Holiday Packages'],
        ARRAY['Referral Program', 'Review Incentive'],
        'Share & Earn Program', 'https://www.raynatours.com', '',
        'Monday', '10:00', 'low', 'biweekly', 'positive_review', '{7,30}',
        'email', 'whatsapp', 'grateful', 'coupon', 'REFER20', 'Refer a Friend, Get 20% Off →',
        ARRAY['first_name', 'review_count'], false, false, 78, 15.0, 500);

    WHEN 24 THEN -- Social Media Advocates
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Instagrammable Experiences', 'Premium Tours', 'Cruises & Sailing'],
        ARRAY['Influencer Partnership', 'Early Access'],
        'Most Photogenic Experiences', 'https://www.raynatours.com', '',
        'Friday', '12:00', 'low', 'weekly', 'social_mention', '{3,14}',
        'whatsapp', 'email', 'casual', 'coupon', 'SOCIAL15', 'Share Your Next Adventure →',
        ARRAY['first_name', 'social_handle'], false, false, 82, 18.0, 450);

    WHEN 25 THEN -- NPS Promoters
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Premium Experiences', 'Cruises & Sailing', 'Holiday Packages'],
        ARRAY['Referral Program', 'Loyalty Rewards'],
        'Ambassador Program', 'https://www.raynatours.com', '',
        'Tuesday', '10:00', 'low', 'monthly', 'nps_submitted', '{14,30}',
        'email', 'whatsapp', 'premium', 'fixed', 'AED 50 off', 'You Are a Rayna Ambassador! →',
        ARRAY['first_name', 'nps_score'], false, false, 85, 20.0, 600);

    -- ═══ STAGE 7: SPECIAL ═════════════════════════════════
    WHEN 26 THEN -- B2B & Corporate
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, upsell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['MICE & Corporate', 'Group Rates', 'Holiday Packages'],
        ARRAY['Airport Transfers', 'Hotel Stays', 'Visa Services'],
        ARRAY['Team Building Packages', 'Conference Add-ons'],
        'Corporate Team Building', 'https://www.raynatours.com', '',
        'Monday', '09:00', 'low', 'monthly', 'b2b_inquiry', '{3,7,14}',
        'email', 'whatsapp', 'professional', 'volume', 'Group discount', 'Request Corporate Quote →',
        ARRAY['company_name', 'group_size'], false, false, 75, 12.0, 3000);

    WHEN 27 THEN -- Birthday Month
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Celebration Experiences', 'Cruises & Sailing', 'Premium Tours'],
        ARRAY['Dining Experiences', 'Yacht Tour', 'Photography Package'],
        'Birthday Special Cruise', 'https://www.raynatours.com/dubai/dhow-cruise', 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/false-241/dhow-cruise-dinner-in-abu-dhabi-front.jpg',
        'Birthday-5d', '10:00', 'high', 'once', 'birthday_approaching', '{-5,0,3}',
        'whatsapp', 'email', 'celebratory', 'coupon', 'HAPPYBDAY', 'Celebrate with Rayna — Free Upgrade! →',
        ARRAY['first_name', 'date_of_birth'], false, false, 80, 20.0, 500);

    WHEN 28 THEN -- High Cancellation Risk
      INSERT INTO segment_product_affinity (segment_id, primary_products, cross_sell_products, hero_product, hero_product_url, hero_product_image,
        best_send_day, best_send_time, urgency_level, send_frequency, trigger_event, follow_up_days,
        recommended_channel, secondary_channel, tone, discount_strategy, discount_value, cta_text,
        personalization_fields, social_proof, scarcity_messaging, affinity_score, expected_conversion_rate, expected_aov)
      VALUES (s.segment_id,
        ARRAY['Flexible Booking Products', 'Desert Safari & Tours', 'Theme Park Tickets'],
        ARRAY['Travel Insurance', 'Flexible Dates'],
        'Free Cancellation Tours', 'https://www.raynatours.com', '',
        'Wednesday', '10:00', 'medium', 'weekly', 'booking_made', '{1,3}',
        'whatsapp', 'email', 'reassuring', 'no_discount', NULL, 'Your Booking is Flexible →',
        ARRAY['first_name', 'booking_date'], false, false, 50, 60.0, 350);

    ELSE NULL;
    END CASE;
  END LOOP;
END $$;

-- ── 4. Create VIEW for easy segment + affinity lookup ───────
CREATE OR REPLACE VIEW v_segment_affinity AS
SELECT
  sd.segment_id,
  sd.segment_number,
  sd.segment_name,
  sd.segment_description,
  fs.stage_name,
  fs.stage_color,
  spa.primary_products,
  spa.cross_sell_products,
  spa.upsell_products,
  spa.hero_product,
  spa.hero_product_url,
  spa.hero_product_image,
  spa.best_send_day,
  spa.best_send_time,
  spa.urgency_level,
  spa.send_frequency,
  spa.trigger_event,
  spa.follow_up_days,
  spa.recommended_channel,
  spa.secondary_channel,
  spa.tone,
  spa.discount_strategy,
  spa.discount_value,
  spa.cta_text,
  spa.personalization_fields,
  spa.social_proof,
  spa.scarcity_messaging,
  spa.affinity_score,
  spa.expected_conversion_rate,
  spa.expected_aov,
  (SELECT COUNT(*) FROM segment_customers sc WHERE sc.segment_id = sd.segment_id) AS customer_count
FROM segment_definitions sd
JOIN funnel_stages fs ON sd.stage_id = fs.stage_id
LEFT JOIN segment_product_affinity spa ON spa.segment_id = sd.segment_id
ORDER BY sd.segment_number;

-- ── 5. Update customer product_affinity from department interactions ──
-- Map department interactions → product affinity JSONB
UPDATE customers c SET product_affinity = sub.affinity
FROM (
  SELECT customer_id, jsonb_agg(DISTINCT jsonb_build_object(
    'category', CASE
      WHEN visa_services_used >= 1 THEN 'Visa Services'
      WHEN total_revenue >= 5000 THEN 'Premium Experiences'
      WHEN total_bookings >= 4 THEN 'Frequent Traveler'
      WHEN total_bookings >= 2 THEN 'Repeat Explorer'
      WHEN total_bookings >= 1 THEN 'Tour Experience'
      WHEN last_abandoned_cart_date IS NOT NULL THEN 'Cart Interest'
      WHEN whatsapp_enquiry_date IS NOT NULL THEN 'WhatsApp Enquiry'
      WHEN website_sessions_total >= 1 THEN 'Web Browser'
      ELSE 'Unknown'
    END,
    'score', CASE
      WHEN total_revenue >= 5000 THEN 95
      WHEN total_bookings >= 4 THEN 90
      WHEN total_bookings >= 2 THEN 75
      WHEN total_bookings >= 1 THEN 60
      WHEN visa_services_used >= 1 THEN 55
      WHEN last_abandoned_cart_date IS NOT NULL THEN 50
      WHEN whatsapp_enquiry_date IS NOT NULL THEN 40
      WHEN website_sessions_total >= 1 THEN 25
      ELSE 10
    END,
    'products', CASE
      WHEN visa_services_used >= 1 AND total_bookings > visa_services_used THEN '["Visa","Tours","Transfers"]'
      WHEN visa_services_used >= 1 THEN '["Visa","Tours","Desert Safari"]'
      WHEN total_revenue >= 5000 THEN '["Premium Safari","Yacht","Cruise","Private Tour"]'
      WHEN total_bookings >= 4 THEN '["Cruise","Holiday Package","Premium Tours"]'
      WHEN total_bookings >= 2 THEN '["Combo Package","Cruise","Activities"]'
      WHEN total_bookings >= 1 THEN '["Desert Safari","City Tour","Activities"]'
      ELSE '["Desert Safari","Theme Parks","City Tour"]'
    END
  )) AS affinity
  FROM customers
  GROUP BY customer_id
) sub
WHERE c.customer_id = sub.customer_id;

-- ── 6. Update preferred_products based on behavioral signals ──
UPDATE customers SET preferred_products = CASE
  WHEN visa_services_used >= 1 AND total_bookings > visa_services_used
    THEN '{"Visa Services","Desert Safari","Airport Transfers","City Tour"}'::TEXT[]
  WHEN visa_services_used >= 1
    THEN '{"Visa Services","Desert Safari","Theme Parks"}'::TEXT[]
  WHEN total_revenue >= 5000
    THEN '{"Premium Safari","Yacht Tour","Cruise","Private Charter"}'::TEXT[]
  WHEN total_bookings >= 4
    THEN '{"Cruise","Holiday Package","Premium Tours","Activities"}'::TEXT[]
  WHEN total_bookings >= 2
    THEN '{"Combo Packages","Cruise","Desert Safari","Activities"}'::TEXT[]
  WHEN total_bookings >= 1
    THEN '{"Desert Safari","City Tour","Theme Parks","Dhow Cruise"}'::TEXT[]
  WHEN last_abandoned_cart_date IS NOT NULL
    THEN '{"Desert Safari","Theme Parks","Activities"}'::TEXT[]
  WHEN whatsapp_enquiry_date IS NOT NULL
    THEN '{"Desert Safari","Visa Services","Theme Parks"}'::TEXT[]
  WHEN website_sessions_total >= 3
    THEN '{"Desert Safari","City Tour","Theme Parks"}'::TEXT[]
  ELSE '{"Desert Safari","City Tour"}'::TEXT[]
END;

SELECT 'Migration 014 complete: ' || COUNT(*) || ' segment affinity records created'
FROM segment_product_affinity;
