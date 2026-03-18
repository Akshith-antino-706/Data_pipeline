-- ═══════════════════════════════════════════════════════════════════
-- Migration 009: COMPLETE SEGMENTATION REBUILD
-- Source of truth: complete-segmentation-with-data-schema.html
-- Drops all segment data and rebuilds from scratch
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

-- ══════════════════════════════════════════════════════════════
-- STEP 1: CLEAN SLATE — Remove all existing segment data
-- ══════════════════════════════════════════════════════════════
DELETE FROM segment_customers;
DELETE FROM conversion_tracking;
DELETE FROM journey_entries;

-- Remove journey_flows FK to segment_definitions
DELETE FROM journey_events;
DELETE FROM journey_entries;
DELETE FROM journey_flows;

-- Remove campaigns FK to strategies
UPDATE campaigns SET strategy_id = NULL;
DELETE FROM ai_optimization_log;
DELETE FROM omnichannel_strategies;

-- Now drop segment definitions
DELETE FROM segment_definitions;
DELETE FROM funnel_stages;

-- ══════════════════════════════════════════════════════════════
-- STEP 2: Recreate funnel stages (7 stages exactly per HTML)
-- ══════════════════════════════════════════════════════════════
INSERT INTO funnel_stages (stage_id, stage_number, stage_name, stage_color, stage_description) VALUES
(1, 1, 'Cold Leads - B2C',                  '#ff6b6b', 'No registration, no enquiry, minimal engagement'),
(2, 2, 'Warm Leads - B2C',                  '#ffa726', 'Registered or enquired but never booked'),
(3, 3, 'Existing Customers - Reactivation',  '#4caf50', 'Booked before but inactive now'),
(4, 4, 'Active B2C - Upsell/Cross-Sell',    '#5c7cfa', 'Recently booked customers, maximize value'),
(5, 5, 'B2B & Corporate',                   '#b794f6', 'Business accounts, travel agencies, corporate clients'),
(6, 6, 'Advocacy & Referral',               '#26de81', 'Happy customers, turn them into advocates'),
(7, 7, 'Special Behavioral',                '#fc5c65', 'Unique patterns requiring specific strategies');

-- Reset sequence
SELECT setval('funnel_stages_stage_id_seq', 7);

-- ══════════════════════════════════════════════════════════════
-- STEP 3: Recreate all 28 segment definitions
-- SQL criteria must be valid WHERE clauses on customers table
-- ══════════════════════════════════════════════════════════════

-- ──── STAGE 1: Cold Leads B2C (2 segments) ────
INSERT INTO segment_definitions (segment_id, segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points) VALUES
(1, 1, 1, 'Meta Ads → WhatsApp Direct',
 'Clicked Meta ads and went straight to WhatsApp without visiting website or registering. Hot lead with immediate intent.',
 'B2C', 'Critical',
 'lead_source = ''Meta Ads'' AND whatsapp_enquiry_date IS NOT NULL AND registration_date IS NULL AND first_booking_date IS NULL',
 '["Stop if customer books at any point", "Move to monthly nurture if no response by Day 14", "Track which channel drove conversion"]'::jsonb),

(2, 2, 1, 'Website Browsers (No Registration)',
 'Visited website, viewed products, but never registered or enquired. Anonymous but identifiable via device/cookie.',
 'B2C', 'High',
 'website_sessions_total >= 1 AND registration_date IS NULL AND last_enquiry_date IS NULL AND first_booking_date IS NULL',
 '["Move to warm leads once they register/provide contact", "Use dynamic retargeting with exact products viewed", "A/B test urgency vs discount messaging"]'::jsonb);

-- ──── STAGE 2: Warm Leads B2C (6 segments) ────
INSERT INTO segment_definitions (segment_id, segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points) VALUES
(3, 3, 2, 'Recent Cart Abandoners (0-3 days)',
 'Added items to cart in last 3 days but didn''t complete booking. Very high intent.',
 'B2C', 'Critical',
 'last_abandoned_cart_date IS NOT NULL AND (NOW()::date - last_abandoned_cart_date::date) <= 3 AND first_booking_date IS NULL',
 '["Manual call if cart > AED 1000 on Day 2", "Include trust signals: Free cancellation, 24/7 support", "Send direct payment link to reduce friction"]'::jsonb),

(4, 4, 2, 'Enquired - Never Booked (0-7 days)',
 'Submitted enquiry in last 7 days but hasn''t booked. Still hot, needs personalization.',
 'B2C', 'Critical',
 'last_enquiry_date IS NOT NULL AND (NOW()::date - last_enquiry_date::date) <= 7 AND first_booking_date IS NULL',
 '["Agent follow-up within 2 hours with detailed proposal", "WhatsApp + Email combination for custom holidays", "Manager call on Day 5 if high-value enquiry", "AED 500 discount on Day 7 as final push"]'::jsonb),

(5, 5, 2, 'Price Watchers (Repeated Views)',
 'Views same product 3+ times but never books. Waiting for better price or deal.',
 'B2C', 'High',
 'product_views_count >= 3 AND first_booking_date IS NULL',
 '["Price drop alert: Save 15% on product", "Create urgency: Only 3 spots left at this price", "Offer price match guarantee"]'::jsonb),

(6, 6, 2, 'Multiple Enquiries, Zero Bookings',
 'Enquired about 3+ different products/destinations but never converted. Trust or decision paralysis issue.',
 'B2C', 'High',
 'enquiry_count >= 3 AND first_booking_date IS NULL',
 '["Manager call to understand concerns and objections", "Send comparison guide for products they enquired about", "Offer free consultation call with travel expert", "Aggressive discount: 25% off + Free cancellation"]'::jsonb),

(7, 7, 2, 'Booking Started, Payment Failed',
 'Started booking process, reached payment but transaction failed. Technical or payment method issue.',
 'B2C', 'High',
 'payment_failed = true AND first_booking_date IS NULL',
 '["Immediate WhatsApp: Payment issue? We can help complete your booking!", "Offer alternative payment methods: Wallet, installments, bank transfer", "Phone call within 1 hour to assist with payment", "Hold booking for 24 hours at same price"]'::jsonb),

(8, 8, 2, 'Registered - Never Engaged (7-30 days)',
 'Created account but no enquiries or bookings within 30 days.',
 'B2C', 'Medium',
 'registration_date IS NOT NULL AND (NOW()::date - registration_date::date) BETWEEN 7 AND 30 AND last_enquiry_date IS NULL AND first_booking_date IS NULL',
 '["Welcome series: 3 emails with popular products", "First booking offer: AED 100 wallet credit", "Personalized recommendations based on UTM source", "WhatsApp check-in on Day 14"]'::jsonb);

-- ──── STAGE 3: Existing Customers Reactivation (2 segments) ────
INSERT INTO segment_definitions (segment_id, segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points) VALUES
(9, 9, 3, 'High-Value Dormant (6+ months)',
 'High lifetime value (AED 5000+) but no booking in 6+ months. VIP treatment required.',
 'B2C', 'Critical',
 'days_since_last_booking >= 180 AND total_revenue >= 5000',
 '["Personal manager call: We miss you! 25% VIP offer", "Free upgrade to premium experience", "AED 500 wallet credit on Day 14", "Move to quarterly VIP newsletter if no conversion"]'::jsonb),

(10, 10, 3, 'One-Time Bookers (90+ days ago)',
 'Booked once, 90+ days ago, never returned. Critical to convert to repeat customer.',
 'B2C', 'Critical',
 'total_bookings = 1 AND days_since_last_booking >= 90',
 '["20% comeback discount campaign", "Highlight loyalty rewards they are missing", "Recommend complementary products to first booking", "AED 200 wallet credit on Day 14"]'::jsonb);

-- ──── STAGE 4: Active B2C Upsell/Cross-Sell (5 segments) ────
INSERT INTO segment_definitions (segment_id, segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points) VALUES
(11, 11, 4, 'Recent Bookers (0-30 days) - Cross-Sell',
 'Completed booking in last 30 days. Add complementary services before travel date.',
 'B2C', 'High',
 'days_since_last_booking <= 30 AND total_bookings >= 1',
 '["Day 1: Email with add-on services (transfers, activities)", "Day 3: WhatsApp with 15% discount on transfers", "Day 7: Bundle offer for complementary activities", "3 days before travel: Last-minute essentials (insurance, SIM)"]'::jsonb),

(12, 12, 4, 'Post-Trip (0-7 days) - Immediate Rebook',
 'Just completed trip. Hot window for rebooking while experience is fresh.',
 'B2C', 'Critical',
 'travel_date IS NOT NULL AND travel_date < NOW()::date AND (NOW()::date - travel_date) <= 7',
 '["Day 1: Review request for 500 R Points", "Day 2: 25% off next booking (48-hour validity)", "Day 3-5: Personalized recommendations based on recent trip", "Day 7: Last chance for 25% discount"]'::jsonb),

(13, 13, 4, 'Visa-Only Customers - Tour Cross-Sell',
 'Only books visa services. Perfect cross-sell opportunity for tours/activities.',
 'B2C', 'High',
 'visa_services_used >= 1 AND total_bookings = visa_services_used',
 '["Immediately after visa approval: 20% off tours", "Destination-specific activity recommendations", "Bundle visa + tour packages for future bookings", "Add transfers as natural upsell"]'::jsonb),

(14, 14, 4, 'Tour-Only - Visa Service Cross-Sell',
 'Only books tours/activities. May need visa services for international travel.',
 'B2C', 'Medium',
 'total_bookings > 0 AND visa_services_used = 0',
 '["After booking: Need visa assistance? We handle everything", "Educate on visa requirements for different destinations", "Bundle international trips with visa + tours", "Monthly newsletter featuring international destinations"]'::jsonb),

(15, 15, 4, 'Frequent Bookers (4+) - VIP Upgrade',
 'Loyal customers with 4+ bookings. Upgrade to premium experiences and maximize LTV.',
 'B2C', 'High',
 'total_bookings >= 4 AND days_since_last_booking <= 60',
 '["VIP manager assigned for personalized service", "Exclusive access to luxury experiences", "Highlight next loyalty tier benefits", "Invite to exclusive events/early access to new destinations"]'::jsonb);

-- ──── STAGE 5: B2B & Corporate (4 segments) ────
INSERT INTO segment_definitions (segment_id, segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points) VALUES
(16, 16, 5, 'Corporate Prospects (Cold)',
 'Companies enquired about corporate packages but never signed contract.',
 'Corporate', 'Critical',
 'customer_type = ''Corporate'' AND total_bookings = 0',
 '["Day 0: Formal proposal with corporate rates + case studies", "Day 5: Follow-up with ROI calculator", "Day 15: Request for 15-min call", "Day 30+: Quarterly check-ins with industry insights", "Sales cycle: 6-12 months typical"]'::jsonb),

(17, 17, 5, 'Active Corporate - Upsell',
 'Existing contracts but booking volume declining or expansion opportunity.',
 'Corporate', 'High',
 'customer_type = ''Corporate'' AND total_bookings >= 5 AND days_since_last_booking >= 60',
 '["Quarterly business review with usage analytics", "Introduce new services: Visa, airport services, hotels", "Volume discount incentives for increased bookings", "Identify expansion opportunities (new departments)"]'::jsonb),

(18, 18, 5, 'B2B Partners (Travel Agencies)',
 'Travel agencies, tour operators, resellers booking for their customers.',
 'B2B', 'High',
 'customer_type = ''B2B''',
 '["Onboarding: Portal access + commission structure + marketing materials", "Weekly newsletter with new products and inventory", "If inactive 30 days: Support check-in + higher commission offer", "Monthly performance reports with optimization tips"]'::jsonb),

(19, 19, 5, 'School/University Groups',
 'Educational institutions booking group trips. Seasonal pattern.',
 'Corporate', 'Medium',
 'customer_type = ''Educational'' OR average_travelers_count >= 15',
 '["Seasonal outreach: Sep, Jan, May (pre-season)", "Early bird group rates + Free teacher spots", "Emphasis on safety, supervision, educational value", "Post-trip: Immediate booking for next year"]'::jsonb);

-- ──── STAGE 6: Advocacy & Referral (3 segments) ────
INSERT INTO segment_definitions (segment_id, segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points) VALUES
(20, 20, 6, 'Happy Customers (Post-Trip 7-30 days)',
 'Completed trip 7-30 days ago. Perfect time for referral requests.',
 'B2C', 'High',
 'travel_date IS NOT NULL AND travel_date < NOW()::date AND (NOW()::date - travel_date) BETWEEN 7 AND 30',
 '["Email: Refer a friend, both get AED 200 credit!", "WhatsApp: Share personalized referral link", "Track referrals and reward promptly", "Create referral leaderboard with monthly prizes"]'::jsonb),

(21, 21, 6, 'Review Writers (4-5 Stars)',
 'Customers who left 4-5 star reviews. Incentivize them to refer friends.',
 'B2C', 'High',
 'average_rating_given >= 4 AND reviews_submitted >= 1',
 '["Thank you message with bonus R Points", "Exclusive referral offer: Both parties get 20% off", "Feature their review in marketing materials (with permission)", "VIP early access to new destinations"]'::jsonb),

(22, 22, 6, 'Social Media Advocates',
 'Customers who tag Rayna on social media posts about their trips.',
 'B2C', 'Medium',
 'social_media_mentions >= 1',
 '["Immediate response: Comment, repost, thank them", "Surprise gift: AED 500 wallet credit or free upgrade", "Invite to brand ambassador program", "Feature their content in official Rayna channels"]'::jsonb);

-- ──── STAGE 7: Special Behavioral (6 segments) ────
INSERT INTO segment_definitions (segment_id, segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points) VALUES
(23, 23, 7, 'Birthday Month Customers',
 'Customers celebrating birthday this month. Perfect for special offers.',
 'B2C', 'Medium',
 'date_of_birth IS NOT NULL AND EXTRACT(MONTH FROM date_of_birth) = EXTRACT(MONTH FROM NOW())',
 '["Birthday email: Celebrate with 25% off any booking!", "WhatsApp: Birthday wish + exclusive offer", "Bonus R Points (500) as birthday gift", "Valid for entire birthday month"]'::jsonb),

(24, 24, 7, 'Holiday Travelers (Eid/Diwali/Christmas)',
 'Customers who typically book around major holidays. Target them 45 days in advance.',
 'B2C', 'High',
 'total_bookings >= 1 AND holiday_traveler = true',
 '["45 days before holiday: Early bird special offers", "Holiday-specific packages and family deals", "Emphasize limited availability during peak season", "Flexible cancellation for uncertain holiday plans"]'::jsonb),

(25, 25, 7, 'Local UAE Residents',
 'UAE residents (different messaging than tourists). Focus on staycations and weekend getaways.',
 'B2C', 'Medium',
 'residence_country IN (''UAE'', ''United Arab Emirates'')',
 '["Weekend packages and last-minute deals", "Abu Dhabi, Ras Al Khaimah, Fujairah staycations", "Resident-only special rates", "Partner with hotels for exclusive UAE resident packages"]'::jsonb),

(26, 26, 7, 'Wallet Heavy Users',
 'Prefers wallet over cards. Offer wallet top-up bonuses to encourage spending.',
 'B2C', 'Medium',
 'wallet_spent_total >= 500 OR wallet_usage_rate >= 70',
 '["Wallet top-up bonus: Add AED 1000, get AED 100 free", "Exclusive wallet-only flash sales", "Faster checkout with wallet = convenience messaging", "Wallet balance reminders when low"]'::jsonb),

(27, 27, 7, 'WhatsApp-Only Responders',
 'Never opens emails, only engages via WhatsApp. Adjust channel strategy accordingly.',
 'B2C', 'Medium',
 'whatsapp_response_rate >= 70 AND email_engagement_score <= 20',
 '["Stop email campaigns, focus 100% on WhatsApp", "All offers, updates, and bookings via WhatsApp", "Send WhatsApp catalog for easy browsing", "Use WhatsApp Business features: Quick replies, product messages"]'::jsonb),

(28, 28, 7, 'High Cancellation Risk',
 'Multiple past cancellations. Manage expectations and offer flexibility.',
 'B2C', 'Medium',
 'cancellation_rate >= 40 OR total_cancelled_bookings >= 2',
 '["Always offer flexible cancellation options", "Require partial deposit instead of full payment", "Send multiple pre-trip reminders and confirmations", "Offer easy date change options"]'::jsonb);

-- Reset sequence
SELECT setval('segment_definitions_segment_id_seq', 28);

-- ══════════════════════════════════════════════════════════════
-- STEP 4: Add missing columns to customers table
-- ══════════════════════════════════════════════════════════════
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_failed BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS holiday_traveler BOOLEAN DEFAULT false;

-- ══════════════════════════════════════════════════════════════
-- STEP 5: RESET & RESEED CUSTOMER DATA for all 28 segments
-- We'll update the existing ~7000 customers to ensure each
-- segment has real matching data
-- ══════════════════════════════════════════════════════════════

-- Reset all computed fields first
UPDATE customers SET
  payment_failed = false,
  holiday_traveler = false;

-- ── Seg 1: Meta Ads → WhatsApp Direct (Cold, no registration, no booking) ──
-- Need: lead_source='Meta Ads', whatsapp_enquiry_date set, registration_date NULL, first_booking_date NULL
UPDATE customers SET
  lead_source = 'Meta Ads',
  whatsapp_enquiry_date = NOW() - (random() * interval '14 days'),
  registration_date = NULL,
  first_booking_date = NULL,
  total_bookings = 0,
  total_revenue = 0,
  website_sessions_total = 0
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE first_booking_date IS NULL AND registration_date IS NULL
  ORDER BY customer_id LIMIT 150
);

-- ── Seg 2: Website Browsers (no registration, no enquiry) ──
UPDATE customers SET
  website_sessions_total = 1 + (customer_id % 10),
  registration_date = NULL,
  last_enquiry_date = NULL,
  first_booking_date = NULL,
  total_bookings = 0,
  lead_source = CASE customer_id % 3 WHEN 0 THEN 'Google Ads' WHEN 1 THEN 'Organic' ELSE 'Social Media' END
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE first_booking_date IS NULL AND lead_source IS DISTINCT FROM 'Meta Ads'
    AND (registration_date IS NULL OR whatsapp_enquiry_date IS NULL)
  ORDER BY customer_id LIMIT 200
);

-- ── Seg 3: Recent Cart Abandoners (0-3 days, no booking) ──
UPDATE customers SET
  last_abandoned_cart_date = NOW() - (random() * interval '2 days'),
  first_booking_date = NULL,
  total_bookings = 0,
  registration_date = COALESCE(registration_date, NOW() - interval '30 days')
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE first_booking_date IS NULL
    AND lead_source IS DISTINCT FROM 'Meta Ads'
    AND website_sessions_total = 0
  ORDER BY customer_id LIMIT 120
);

-- ── Seg 4: Enquired but Never Booked (0-7 days) ──
UPDATE customers SET
  last_enquiry_date = NOW() - (random() * interval '6 days'),
  first_booking_date = NULL,
  total_bookings = 0,
  enquiry_count = GREATEST(enquiry_count, 1),
  registration_date = COALESCE(registration_date, NOW() - interval '30 days')
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE first_booking_date IS NULL
    AND last_abandoned_cart_date IS NULL
    AND lead_source IS DISTINCT FROM 'Meta Ads'
    AND website_sessions_total = 0
  ORDER BY customer_id LIMIT 200
);

-- ── Seg 5: Price Watchers (product_views >= 3, no booking) ──
UPDATE customers SET
  product_views_count = 3 + (customer_id % 8),
  first_booking_date = NULL,
  total_bookings = 0
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE first_booking_date IS NULL
    AND product_views_count < 3
    AND last_abandoned_cart_date IS NULL
    AND (last_enquiry_date IS NULL OR (NOW()::date - last_enquiry_date::date) > 7)
  ORDER BY customer_id LIMIT 180
);

-- ── Seg 6: Multiple Enquiries, Zero Bookings (enquiry_count >= 3) ──
UPDATE customers SET
  enquiry_count = 3 + (customer_id % 5),
  first_booking_date = NULL,
  total_bookings = 0
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE first_booking_date IS NULL
    AND enquiry_count < 3
    AND product_views_count < 3
  ORDER BY customer_id LIMIT 100
);

-- ── Seg 7: Booking Started, Payment Failed ──
UPDATE customers SET
  payment_failed = true,
  first_booking_date = NULL,
  total_bookings = 0,
  registration_date = COALESCE(registration_date, NOW() - interval '15 days')
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE first_booking_date IS NULL
    AND product_views_count < 3
    AND enquiry_count < 3
    AND last_abandoned_cart_date IS NULL
    AND lead_source IS DISTINCT FROM 'Meta Ads'
  ORDER BY customer_id LIMIT 90
);

-- ── Seg 8: Registered - Never Engaged (7-30 days) ──
UPDATE customers SET
  registration_date = NOW() - ((7 + customer_id % 23) * interval '1 day'),
  last_enquiry_date = NULL,
  first_booking_date = NULL,
  total_bookings = 0,
  lead_source = COALESCE(lead_source, 'Website')
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE first_booking_date IS NULL
    AND payment_failed = false
    AND product_views_count < 3
    AND enquiry_count < 3
    AND last_abandoned_cart_date IS NULL
    AND lead_source IS DISTINCT FROM 'Meta Ads'
    AND (registration_date IS NULL OR (NOW()::date - registration_date::date) NOT BETWEEN 7 AND 30)
  ORDER BY customer_id LIMIT 500
);

-- ══════════════════════════════════════════════════════════════
-- STAGE 3: Existing Customers Reactivation
-- ══════════════════════════════════════════════════════════════

-- ── Seg 9: High-Value Dormant (6+ months, revenue >= 5000) ──
UPDATE customers SET
  days_since_last_booking = (180 + (customer_id % 180))::INT,
  total_revenue = 5000 + (customer_id % 10000)::INT,
  total_bookings = GREATEST(total_bookings, 2),
  first_booking_date = COALESCE(first_booking_date, NOW()::date - 365),
  last_booking_date = NOW()::date - (180 + (customer_id % 180))::INT
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE total_bookings >= 1 AND total_revenue >= 3000
  ORDER BY total_revenue DESC LIMIT 40
);

-- ── Seg 10: One-Time Bookers (90+ days ago) ──
UPDATE customers SET
  total_bookings = 1,
  days_since_last_booking = (90 + (customer_id % 200))::INT,
  first_booking_date = COALESCE(first_booking_date, NOW()::date - (90 + (customer_id % 200))::INT),
  last_booking_date = NOW()::date - (90 + (customer_id % 200))::INT
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE total_bookings = 1 AND (days_since_last_booking IS NULL OR days_since_last_booking < 90)
  ORDER BY customer_id LIMIT 150
);
-- Also set some who have bookings=1 but no recency
UPDATE customers SET
  days_since_last_booking = (90 + (customer_id % 200))::INT
WHERE total_bookings = 1 AND days_since_last_booking < 90;

-- ══════════════════════════════════════════════════════════════
-- STAGE 4: Active B2C Upsell/Cross-Sell
-- ══════════════════════════════════════════════════════════════

-- ── Seg 11: Recent Bookers (0-30 days) ──
UPDATE customers SET
  days_since_last_booking = (customer_id % 30)::INT,
  total_bookings = GREATEST(total_bookings, 1),
  first_booking_date = COALESCE(first_booking_date, NOW()::date - 60)
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE total_bookings >= 1 AND days_since_last_booking > 30
  ORDER BY customer_id LIMIT 140
);

-- ── Seg 12: Post-Trip (0-7 days) ──
UPDATE customers SET
  travel_date = (NOW()::date - (customer_id % 6)::INT)
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE total_bookings >= 1 AND (travel_date IS NULL OR travel_date >= NOW()::date)
  ORDER BY customer_id LIMIT 50
);

-- ── Seg 13: Visa-Only Customers ──
UPDATE customers SET
  visa_services_used = GREATEST(1, visa_services_used),
  total_bookings = visa_services_used
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE visa_services_used >= 1 AND total_bookings = visa_services_used
  ORDER BY customer_id LIMIT 50
);
-- Also create some visa-only if not enough
UPDATE customers SET
  visa_services_used = 1 + (customer_id % 3),
  total_bookings = 1 + (customer_id % 3),
  first_booking_date = COALESCE(first_booking_date, NOW()::date - 60)
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE visa_services_used = 0 AND total_bookings >= 1
  ORDER BY customer_id LIMIT 50
);

-- ── Seg 14: Tour-Only (no visa) ──
-- Already many customers with total_bookings > 0 and visa_services_used = 0
-- Just make sure we have enough
UPDATE customers SET
  visa_services_used = 0
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE total_bookings > 0 AND visa_services_used > 0 AND visa_services_used < total_bookings
  ORDER BY customer_id LIMIT 200
);

-- ── Seg 15: Frequent Bookers (4+, active within 60 days) ──
UPDATE customers SET
  total_bookings = (4 + (customer_id % 6))::INT,
  days_since_last_booking = (customer_id % 59)::INT,
  first_booking_date = COALESCE(first_booking_date, NOW()::date - 365),
  total_revenue = GREATEST(total_revenue, 2000 + (customer_id % 5000))
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE total_bookings >= 3
  ORDER BY total_bookings DESC LIMIT 40
);

-- ══════════════════════════════════════════════════════════════
-- STAGE 5: B2B & Corporate
-- ══════════════════════════════════════════════════════════════

-- ── Seg 16: Corporate Prospects (Cold, 0 bookings) ──
UPDATE customers SET
  customer_type = 'Corporate',
  total_bookings = 0,
  first_booking_date = NULL,
  lead_source = 'Corporate Enquiry'
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE customer_type = 'Corporate' AND total_bookings = 0
  ORDER BY customer_id LIMIT 80
);
-- Ensure at least 80 corporate prospects
UPDATE customers SET
  customer_type = 'Corporate',
  total_bookings = 0,
  first_booking_date = NULL,
  lead_source = 'Corporate Enquiry'
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE total_bookings = 0 AND customer_type = 'B2C' AND payment_failed = false
    AND product_views_count < 3 AND enquiry_count < 3
    AND last_abandoned_cart_date IS NULL
    AND lead_source IS DISTINCT FROM 'Meta Ads'
  ORDER BY customer_id LIMIT GREATEST(0, 80 - (SELECT COUNT(*) FROM customers WHERE customer_type = 'Corporate' AND total_bookings = 0))
);

-- ── Seg 17: Active Corporate Upsell (5+ bookings, 60+ days since last) ──
UPDATE customers SET
  customer_type = 'Corporate',
  total_bookings = GREATEST(total_bookings, 5),
  days_since_last_booking = GREATEST(60, days_since_last_booking),
  first_booking_date = COALESCE(first_booking_date, NOW()::date - 365)
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE customer_type = 'Corporate' AND total_bookings >= 3
  ORDER BY total_bookings DESC LIMIT 40
);

-- ── Seg 18: B2B Partners ──
-- Already have B2B customers from seed data
UPDATE customers SET customer_type = 'B2B'
WHERE customer_id IN (
  SELECT customer_id FROM customers WHERE customer_type = 'B2B'
  ORDER BY customer_id LIMIT 500
);

-- ── Seg 19: School/University Groups ──
UPDATE customers SET
  customer_type = 'Educational',
  average_travelers_count = 15 + (customer_id % 30)
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE customer_type = 'Educational'
  ORDER BY customer_id LIMIT 30
);
-- Ensure we have enough by also flagging some with high traveler counts
UPDATE customers SET average_travelers_count = 15 + (customer_id % 25)
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE average_travelers_count < 15 AND customer_type NOT IN ('Corporate', 'B2B')
  ORDER BY customer_id LIMIT 30
);

-- ══════════════════════════════════════════════════════════════
-- STAGE 6: Advocacy & Referral
-- ══════════════════════════════════════════════════════════════

-- ── Seg 20: Happy Customers (Post-Trip 7-30 days) ──
UPDATE customers SET
  travel_date = (NOW()::date - (7 + customer_id % 23)::INT)
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE total_bookings >= 1
    AND (travel_date IS NULL OR (NOW()::date - travel_date) NOT BETWEEN 7 AND 30)
  ORDER BY customer_id LIMIT 500
);

-- ── Seg 21: Review Writers (4-5 stars) ──
UPDATE customers SET
  average_rating_given = 4.0 + (customer_id % 10)::numeric / 10.0,
  reviews_submitted = 1 + (customer_id % 4)
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE total_bookings >= 1 AND reviews_submitted = 0
  ORDER BY customer_id LIMIT 100
);

-- ── Seg 22: Social Media Advocates ──
UPDATE customers SET
  social_media_mentions = 1 + (customer_id % 5)
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE total_bookings >= 1 AND social_media_mentions = 0
  ORDER BY customer_id LIMIT 60
);

-- ══════════════════════════════════════════════════════════════
-- STAGE 7: Special Behavioral
-- ══════════════════════════════════════════════════════════════

-- ── Seg 23: Birthday Month ──
UPDATE customers SET
  date_of_birth = MAKE_DATE(
    (1985 + (customer_id % 25))::INT,
    EXTRACT(MONTH FROM NOW())::INT,
    (1 + (customer_id % 27))::INT
  )
WHERE customer_id IN (
  SELECT customer_id FROM customers WHERE date_of_birth IS NULL
  ORDER BY customer_id LIMIT 200
);
-- Also set random birthdays for rest
UPDATE customers SET
  date_of_birth = MAKE_DATE(
    (1980 + (customer_id % 30))::INT,
    (1 + (customer_id % 12))::INT,
    (1 + (customer_id % 27))::INT
  )
WHERE date_of_birth IS NULL;

-- ── Seg 24: Holiday Travelers ──
UPDATE customers SET
  holiday_traveler = true
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE total_bookings >= 1
  ORDER BY RANDOM() LIMIT 800
);

-- ── Seg 25: Local UAE Residents ──
UPDATE customers SET
  residence_country = CASE customer_id % 2 WHEN 0 THEN 'UAE' ELSE 'United Arab Emirates' END
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE residence_country NOT IN ('UAE', 'United Arab Emirates')
  ORDER BY customer_id LIMIT 2200
);

-- ── Seg 26: Wallet Heavy Users ──
UPDATE customers SET
  wallet_spent_total = 500 + (customer_id % 2000),
  wallet_usage_rate = 70 + (customer_id % 30)
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE wallet_spent_total < 500 AND wallet_usage_rate < 70
  ORDER BY customer_id LIMIT 60
);

-- ── Seg 27: WhatsApp-Only Responders ──
UPDATE customers SET
  whatsapp_response_rate = 70 + (customer_id % 30),
  email_engagement_score = (customer_id % 20)
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE whatsapp_response_rate < 70 OR email_engagement_score > 20
  ORDER BY customer_id LIMIT 80
);

-- ── Seg 28: High Cancellation Risk ──
UPDATE customers SET
  cancellation_rate = 40 + (customer_id % 40),
  total_cancelled_bookings = 2 + (customer_id % 4)
WHERE customer_id IN (
  SELECT customer_id FROM customers
  WHERE total_bookings >= 1 AND cancellation_rate < 40 AND total_cancelled_bookings < 2
  ORDER BY customer_id LIMIT 120
);

-- ══════════════════════════════════════════════════════════════
-- STEP 6: Rebuild strategies for all 28 segments
-- ══════════════════════════════════════════════════════════════
INSERT INTO omnichannel_strategies (name, description, segment_label, channels, status, flow_steps, ai_score) VALUES
('Win-back: Meta Ads WhatsApp Leads',
 'Win-back cold leads from Meta/Instagram ads. Immediate WhatsApp response within 2 mins, then multi-channel urgency sequence. Goal: Convert ad clickers within 14 days.',
 'Meta Ads → WhatsApp Direct', '{whatsapp,email,sms,push,rcs}', 'active',
 '[{"day":0,"label":"IMMEDIATE","actions":[{"channel":"whatsapp","message":"Response within 2 mins: Hi [Name]! Saw your interest in [Product]. Here''s instant 10% off: [Link]"}]},{"day":0,"label":"HOUR 1","actions":[{"channel":"email","message":"Your 10% discount is waiting! [Product Name] + Customer reviews"},{"channel":"sms","message":"Hi [Name], your 10% off code: WELCOME10. Valid for 24hrs. Book now: [Short Link]"}]},{"day":1,"label":"DAY 1","actions":[{"channel":"whatsapp","message":"Did you have questions about [Product]? Happy to help!"},{"channel":"push","message":"Your discount expires in 23 hours!"}]},{"day":3,"label":"DAY 3","actions":[{"channel":"email","message":"Last Chance! Extended 12 hours. Plus: Similar products you might love"},{"channel":"rcs","message":"Rich message with product image carousel + Book Now button"}]},{"day":7,"label":"DAY 7","actions":[{"channel":"whatsapp","message":"Still planning your trip? Here''s 15% off if you book this week!"}]},{"day":14,"label":"DAY 14","actions":[{"channel":"email","message":"Final offer: 20% off + Free cancellation"}]}]'::jsonb, 87.5),

('Capture: Anonymous Website Visitors',
 'Capture anonymous website visitors with exit-intent popups and retargeting ads. Goal: Convert browsers to registered leads.',
 'Website Browsers (No Registration)', '{web}', 'active',
 '[{"day":0,"label":"REAL-TIME","actions":[{"channel":"web","message":"Sign up now for 10% off your first booking!"}]},{"day":1,"label":"DAY 1-7","actions":[{"channel":"web","message":"Meta/Google ads showing viewed products + urgency messaging"}]}]'::jsonb, 72.0),

('Recovery: Cart Abandonment 0-3 Days',
 'Recover abandoned carts with escalating urgency + discount. Manual call if cart > AED 1000. Goal: Recover 25%+ of abandoned carts.',
 'Recent Cart Abandoners (0-3 days)', '{whatsapp,email,sms,push,rcs}', 'active',
 '[{"day":0,"label":"HOUR 1","actions":[{"channel":"email","message":"You left items in cart! Complete with 10% off: CODE10"},{"channel":"whatsapp","message":"Need help completing your booking?"}]},{"day":0,"label":"HOUR 6","actions":[{"channel":"push","message":"Your cart is waiting!"},{"channel":"sms","message":"Cart expires soon! CODE10 for 10% off: [Link]"}]},{"day":1,"label":"DAY 1-3","actions":[{"channel":"email","message":"Increasing discount to 15% + Payment options + Trust signals"},{"channel":"rcs","message":"Interactive Complete Booking button + Cart preview"}]}]'::jsonb, 91.2),

('Convert: Hot Enquiry Follow-up',
 'Convert hot enquiry leads within 7 days. Agent follow-up within 2 hours, manager call on Day 5 for high-value. Goal: Convert 15%+.',
 'Enquired - Never Booked (0-7 days)', '{whatsapp,email,sms}', 'active',
 '[{"day":0,"label":"HOUR 2","actions":[{"channel":"whatsapp","message":"Agent follow-up within 2 hours with detailed proposal"},{"channel":"email","message":"WhatsApp + Email combination for custom holidays"}]},{"day":5,"label":"DAY 5","actions":[{"channel":"whatsapp","message":"Manager call if high-value enquiry"}]},{"day":7,"label":"DAY 7","actions":[{"channel":"email","message":"AED 500 discount as final push"}]}]'::jsonb, 84.3),

('Convert: Price Drop Alert',
 'Trigger price-drop alerts for repeat product viewers. Create urgency with scarcity messaging. Goal: Convert 20%+ when price drops.',
 'Price Watchers (Repeated Views)', '{whatsapp,email}', 'active',
 '[{"day":0,"label":"PRICE DROP","actions":[{"channel":"email","message":"Price drop alert! Save 15% on [Product]"},{"channel":"whatsapp","message":"Noticed you''re interested in [Product]. Here''s exclusive 20% off!"}]},{"day":1,"label":"DAY 1","actions":[{"channel":"whatsapp","message":"Create urgency: Only 3 spots left at this price"}]}]'::jsonb, 88.7),

('Convert: Decision Paralysis Resolver',
 'Help indecisive customers with manager calls, comparison guides, and aggressive discounts. Goal: Convert 12%+ with personalized curation.',
 'Multiple Enquiries, Zero Bookings', '{whatsapp,email,sms}', 'active',
 '[{"day":0,"label":"IMMEDIATE","actions":[{"channel":"whatsapp","message":"Manager call to understand concerns and objections"}]},{"day":1,"label":"DAY 1","actions":[{"channel":"email","message":"Comparison guide for products they enquired about"}]},{"day":3,"label":"DAY 3","actions":[{"channel":"whatsapp","message":"Free consultation call with travel expert"}]},{"day":7,"label":"DAY 7","actions":[{"channel":"email","message":"Aggressive discount: 25% off + Free cancellation"}]}]'::jsonb, 79.4),

('Recovery: Payment Failure Rescue',
 'Rescue failed payments with immediate support, alternative payment methods, and phone call within 1 hour. Goal: Recover 40%+.',
 'Booking Started, Payment Failed', '{whatsapp,email,sms}', 'active',
 '[{"day":0,"label":"IMMEDIATE","actions":[{"channel":"whatsapp","message":"Payment issue? We can help complete your booking!"}]},{"day":0,"label":"HOUR 1","actions":[{"channel":"email","message":"Alternative payment methods: Wallet, installments, bank transfer"},{"channel":"whatsapp","message":"Phone call within 1 hour to assist with payment"}]},{"day":1,"label":"DAY 1","actions":[{"channel":"sms","message":"Hold booking for 24 hours at same price"}]}]'::jsonb, 93.1),

('Nurture: Welcome Series',
 '30-day welcome nurture with wallet credit incentive and popular product showcase. Goal: Activate 10%+ within 30 days.',
 'Registered - Never Engaged (7-30 days)', '{whatsapp,email,push}', 'active',
 '[{"day":7,"label":"DAY 7","actions":[{"channel":"email","message":"Welcome series: 3 emails with popular products"}]},{"day":10,"label":"DAY 10","actions":[{"channel":"email","message":"First booking offer: AED 100 wallet credit"}]},{"day":14,"label":"DAY 14","actions":[{"channel":"whatsapp","message":"WhatsApp check-in"}]},{"day":21,"label":"DAY 21","actions":[{"channel":"push","message":"Personalized recommendations based on UTM source"}]}]'::jsonb, 76.8),

('Win-back: VIP Dormant Reactivation',
 'Win back high-value VIP customers dormant 6+ months. Personal manager call, free upgrades, AED 500 wallet credit. Goal: Reactivate 30%+.',
 'High-Value Dormant (6+ months)', '{whatsapp,email,sms,push}', 'active',
 '[{"day":0,"label":"DAY 0","actions":[{"channel":"whatsapp","message":"Personal manager call: We miss you! 25% VIP offer"}]},{"day":3,"label":"DAY 3","actions":[{"channel":"email","message":"Free upgrade to premium experience"}]},{"day":14,"label":"DAY 14","actions":[{"channel":"email","message":"AED 500 wallet credit"}]},{"day":30,"label":"DAY 30","actions":[{"channel":"email","message":"Move to quarterly VIP newsletter if no conversion"}]}]'::jsonb, 90.5),

('Win-back: One-Time Booker Reactivation',
 '20% comeback discount + wallet credit to convert one-time bookers into repeat customers. Goal: Convert 15%+ to second booking.',
 'One-Time Bookers (90+ days ago)', '{whatsapp,email,push}', 'active',
 '[{"day":0,"label":"DAY 0","actions":[{"channel":"email","message":"20% comeback discount campaign"}]},{"day":3,"label":"DAY 3","actions":[{"channel":"whatsapp","message":"Highlight loyalty rewards they are missing"}]},{"day":7,"label":"DAY 7","actions":[{"channel":"email","message":"Recommend complementary products to first booking"}]},{"day":14,"label":"DAY 14","actions":[{"channel":"push","message":"AED 200 wallet credit"}]}]'::jsonb, 82.1),

('Upsell: Recent Booker Cross-Sell',
 'Cross-sell add-ons to recent bookers before their trip: transfers, activities, insurance. Goal: Increase AOV by 25%+.',
 'Recent Bookers (0-30 days) - Cross-Sell', '{whatsapp,email,push}', 'active',
 '[{"day":1,"label":"DAY 1","actions":[{"channel":"email","message":"Add-on services: transfers, activities"}]},{"day":3,"label":"DAY 3","actions":[{"channel":"whatsapp","message":"15% discount on transfers"}]},{"day":7,"label":"DAY 7","actions":[{"channel":"email","message":"Bundle offer for complementary activities"}]},{"day":-3,"label":"3 DAYS BEFORE","actions":[{"channel":"push","message":"Last-minute essentials: insurance, SIM"}]}]'::jsonb, 85.6),

('Rebook: Post-Trip Immediate',
 'Capture post-trip enthusiasm with review request + 25% rebook offer within 48hrs. Goal: 20%+ rebook rate.',
 'Post-Trip (0-7 days) - Immediate Rebook', '{whatsapp,email,push}', 'active',
 '[{"day":1,"label":"DAY 1","actions":[{"channel":"email","message":"Review request for 500 R Points"}]},{"day":2,"label":"DAY 2","actions":[{"channel":"whatsapp","message":"25% off next booking (48-hour validity)"}]},{"day":3,"label":"DAY 3-5","actions":[{"channel":"email","message":"Personalized recommendations based on recent trip"}]},{"day":7,"label":"DAY 7","actions":[{"channel":"push","message":"Last chance for 25% discount"}]}]'::jsonb, 86.3),

('Cross-Sell: Visa to Tours',
 'Cross-sell tours to visa-only customers. 20% off tours immediately after visa approval. Goal: Convert 35%+.',
 'Visa-Only Customers - Tour Cross-Sell', '{whatsapp,email}', 'active',
 '[{"day":0,"label":"VISA APPROVED","actions":[{"channel":"whatsapp","message":"Immediately after visa approval: 20% off tours"}]},{"day":3,"label":"DAY 3","actions":[{"channel":"email","message":"Destination-specific activity recommendations"}]},{"day":7,"label":"DAY 7","actions":[{"channel":"email","message":"Bundle visa + tour packages for future bookings"}]}]'::jsonb, 89.2),

('Cross-Sell: Tours to Visa',
 'Cross-sell visa services to tour-only customers. Educate on visa requirements. Goal: 8%+ visa uptake.',
 'Tour-Only - Visa Service Cross-Sell', '{email,whatsapp}', 'active',
 '[{"day":0,"label":"POST-BOOKING","actions":[{"channel":"email","message":"Need visa assistance? We handle everything"}]},{"day":7,"label":"DAY 7","actions":[{"channel":"email","message":"Educate on visa requirements for different destinations"}]},{"day":30,"label":"MONTHLY","actions":[{"channel":"email","message":"Newsletter featuring international destinations"}]}]'::jsonb, 74.5),

('VIP: Frequent Booker Upgrade',
 'Upgrade frequent bookers (4+) to VIP with exclusive experiences and personal manager. Goal: 95%+ VIP retention.',
 'Frequent Bookers (4+) - VIP Upgrade', '{whatsapp,email,push}', 'active',
 '[{"day":0,"label":"MILESTONE","actions":[{"channel":"email","message":"VIP manager assigned for personalized service"},{"channel":"whatsapp","message":"Exclusive access to luxury experiences"}]},{"day":7,"label":"WEEKLY","actions":[{"channel":"push","message":"Highlight next loyalty tier benefits"}]},{"day":30,"label":"MONTHLY","actions":[{"channel":"email","message":"Invite to exclusive events/early access"}]}]'::jsonb, 94.7),

('B2B: Corporate Prospect Pipeline',
 'B2B cold outreach with formal proposals, ROI calculator, and quarterly check-ins. Sales cycle 6-12 months. Goal: 5%+ meeting conversion.',
 'Corporate Prospects (Cold)', '{email,whatsapp}', 'active',
 '[{"day":0,"label":"DAY 0","actions":[{"channel":"email","message":"Formal proposal with corporate rates + case studies"}]},{"day":5,"label":"DAY 5","actions":[{"channel":"email","message":"Follow-up with ROI calculator"}]},{"day":15,"label":"DAY 15","actions":[{"channel":"whatsapp","message":"Request for 15-min call"}]},{"day":30,"label":"DAY 30+","actions":[{"channel":"email","message":"Quarterly check-ins with industry insights"}]}]'::jsonb, 71.3),

('B2B: Corporate Upsell & Retention',
 'Quarterly business reviews, new service introductions, and volume discount incentives for active corporates. Goal: 20%+ AOV increase.',
 'Active Corporate - Upsell', '{email,whatsapp}', 'active',
 '[{"day":0,"label":"QUARTERLY","actions":[{"channel":"email","message":"Quarterly business review with usage analytics"}]},{"day":7,"label":"DAY 7","actions":[{"channel":"email","message":"Introduce new services: Visa, airport services, hotels"}]},{"day":14,"label":"DAY 14","actions":[{"channel":"whatsapp","message":"Volume discount incentives for increased bookings"}]}]'::jsonb, 83.9),

('B2B: Travel Agency Partner Program',
 'Partner onboarding with portal access, commission structure, and performance reports. Goal: 10%+ new partner onboarding monthly.',
 'B2B Partners (Travel Agencies)', '{email,whatsapp}', 'active',
 '[{"day":0,"label":"ONBOARDING","actions":[{"channel":"email","message":"Portal access + commission structure + marketing materials"}]},{"day":7,"label":"WEEKLY","actions":[{"channel":"email","message":"Weekly newsletter with new products and inventory"}]},{"day":30,"label":"IF INACTIVE","actions":[{"channel":"whatsapp","message":"Support check-in + higher commission offer"}]},{"day":30,"label":"MONTHLY","actions":[{"channel":"email","message":"Monthly performance reports with optimization tips"}]}]'::jsonb, 78.4),

('B2B: School Group Seasonal Outreach',
 'Seasonal outreach to schools with educational packages and group rates. Goal: 15+ school group bookings per term.',
 'School/University Groups', '{email}', 'active',
 '[{"day":0,"label":"SEP/JAN/MAY","actions":[{"channel":"email","message":"Seasonal outreach: Early bird group rates + Free teacher spots"}]},{"day":14,"label":"DAY 14","actions":[{"channel":"email","message":"Emphasis on safety, supervision, educational value"}]},{"day":0,"label":"POST-TRIP","actions":[{"channel":"email","message":"Immediate booking for next year"}]}]'::jsonb, 70.2),

('Advocacy: Happy Customer Referral',
 'Convert happy post-trip customers into advocates. Give AED 200 / Get AED 200 referral program. Goal: 10%+ referral rate.',
 'Happy Customers (Post-Trip 7-30 days)', '{whatsapp,email}', 'active',
 '[{"day":7,"label":"POST-TRIP 7D","actions":[{"channel":"email","message":"Refer a friend, both get AED 200 credit!"},{"channel":"whatsapp","message":"Share personalized referral link"}]},{"day":14,"label":"DAY 14","actions":[{"channel":"whatsapp","message":"Track referrals and reward promptly"}]},{"day":30,"label":"MONTHLY","actions":[{"channel":"email","message":"Referral leaderboard with monthly prizes"}]}]'::jsonb, 81.6),

('Advocacy: Review Writer VIP',
 'Reward and retain positive review writers with bonus R Points and exclusive referral offers. Goal: 60%+ reviewer retention.',
 'Review Writers (4-5 Stars)', '{whatsapp,email}', 'active',
 '[{"day":0,"label":"REVIEW POSTED","actions":[{"channel":"whatsapp","message":"Thank you with bonus R Points"}]},{"day":1,"label":"DAY 1","actions":[{"channel":"email","message":"Exclusive referral offer: Both parties get 20% off"}]},{"day":7,"label":"DAY 7","actions":[{"channel":"email","message":"VIP early access to new destinations"}]}]'::jsonb, 77.8),

('Advocacy: Social Media Ambassador',
 'Recruit social media advocates as brand ambassadors with surprise gifts and reposting. Goal: 20+ active ambassadors monthly.',
 'Social Media Advocates', '{whatsapp,email}', 'active',
 '[{"day":0,"label":"DETECTED","actions":[{"channel":"whatsapp","message":"Immediate response: Comment, repost, thank them"}]},{"day":1,"label":"DAY 1","actions":[{"channel":"whatsapp","message":"Surprise gift: AED 500 wallet credit or free upgrade"}]},{"day":7,"label":"DAY 7","actions":[{"channel":"email","message":"Invite to brand ambassador program"}]}]'::jsonb, 75.3),

('Special: Birthday Month',
 'Celebrate customer birthdays with 25% off + 500 bonus R Points valid entire birthday month. Goal: 25%+ birthday booking rate.',
 'Birthday Month Customers', '{whatsapp,email,push}', 'active',
 '[{"day":1,"label":"MONTH START","actions":[{"channel":"email","message":"Celebrate with 25% off any booking!"},{"channel":"whatsapp","message":"Birthday wish + exclusive offer"}]},{"day":1,"label":"MONTH START","actions":[{"channel":"push","message":"Bonus R Points (500) as birthday gift"}]}]'::jsonb, 80.1),

('Special: Holiday Season Pre-sell',
 'Pre-sell holiday activities 45 days before Eid, Diwali, Christmas. Early bird specials and family deals. Goal: 40%+ holiday capacity pre-sold.',
 'Holiday Travelers (Eid/Diwali/Christmas)', '{whatsapp,email,sms}', 'active',
 '[{"day":-45,"label":"45 DAYS BEFORE","actions":[{"channel":"email","message":"Early bird special offers"}]},{"day":-30,"label":"30 DAYS BEFORE","actions":[{"channel":"whatsapp","message":"Holiday-specific packages and family deals"}]},{"day":-14,"label":"14 DAYS BEFORE","actions":[{"channel":"sms","message":"Limited availability during peak season"}]}]'::jsonb, 86.9),

('Special: UAE Resident Weekender',
 'Weekly weekend escape offers exclusive to UAE residents with resident-only rates. Goal: 30%+ weekend booking rate.',
 'Local UAE Residents', '{whatsapp,email,push}', 'active',
 '[{"day":0,"label":"WEDNESDAY","actions":[{"channel":"email","message":"Weekend packages and last-minute deals"}]},{"day":0,"label":"WEDNESDAY PM","actions":[{"channel":"whatsapp","message":"Resident-only special rates + staycations"}]},{"day":1,"label":"THURSDAY","actions":[{"channel":"push","message":"Partner hotels for exclusive UAE resident packages"}]}]'::jsonb, 83.2),

('Special: Wallet Power User',
 'Reward wallet power users with top-up bonuses and wallet-only flash sales. Goal: 50%+ top-up rate.',
 'Wallet Heavy Users', '{whatsapp,email,push}', 'active',
 '[{"day":0,"label":"WEEKLY","actions":[{"channel":"whatsapp","message":"Add AED 1000, get AED 100 free"}]},{"day":3,"label":"MID-WEEK","actions":[{"channel":"email","message":"Exclusive wallet-only flash sales"}]},{"day":5,"label":"FRIDAY","actions":[{"channel":"push","message":"Wallet balance reminder + convenience messaging"}]}]'::jsonb, 79.5),

('Special: WhatsApp-First Strategy',
 'WhatsApp-only engagement for customers who never open emails. Catalog browsing and quick replies. Goal: 35%+ response rate.',
 'WhatsApp-Only Responders', '{whatsapp}', 'active',
 '[{"day":0,"label":"WEEKLY","actions":[{"channel":"whatsapp","message":"All offers, updates, and bookings via WhatsApp"}]},{"day":3,"label":"MID-WEEK","actions":[{"channel":"whatsapp","message":"WhatsApp catalog for easy browsing + quick replies"}]}]'::jsonb, 84.0),

('Special: Cancellation Risk Management',
 'Proactive retention for high-cancellation customers. Flexible options, partial deposits, and pre-trip reminders. Goal: Save 45%+ of at-risk bookings.',
 'High Cancellation Risk', '{whatsapp,email}', 'active',
 '[{"day":0,"label":"BOOKING MADE","actions":[{"channel":"email","message":"Flexible cancellation options + partial deposit option"}]},{"day":-7,"label":"7 DAYS BEFORE","actions":[{"channel":"whatsapp","message":"Pre-trip reminders and confirmations"}]},{"day":-3,"label":"3 DAYS BEFORE","actions":[{"channel":"whatsapp","message":"Easy date change options"}]}]'::jsonb, 92.4);

-- ══════════════════════════════════════════════════════════════
-- STEP 7: Link campaigns to new strategies
-- ══════════════════════════════════════════════════════════════
UPDATE campaigns c SET strategy_id = (
  SELECT s.id FROM omnichannel_strategies s
  WHERE s.segment_label = c.segment_label
  ORDER BY s.id LIMIT 1
);

-- ══════════════════════════════════════════════════════════════
-- STEP 8: Link content templates to match segment labels
-- ══════════════════════════════════════════════════════════════
-- Content templates already have segment_label from migration 007
-- Just ensure campaigns have correct template_id
UPDATE campaigns c SET template_id = (
  SELECT ct.id FROM content_templates ct
  WHERE ct.segment_label = c.segment_label
  AND ct.channel::TEXT = c.channel::TEXT
  ORDER BY ct.id LIMIT 1
)
WHERE c.template_id IS NULL OR c.template_id NOT IN (SELECT id FROM content_templates);

COMMIT;
