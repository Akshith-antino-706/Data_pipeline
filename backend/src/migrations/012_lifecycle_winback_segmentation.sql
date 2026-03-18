-- ═══════════════════════════════════════════════════════════════════
-- Migration 012: LIFECYCLE + WIN-BACK SEGMENTATION REBUILD
-- Based on industry-standard Customer Lifecycle Marketing Funnel
-- with RFM scoring and Win-Back as a dedicated stage
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

-- ══════════════════════════════════════════════════════════════
-- STEP 1: Clean all dependent data
-- ══════════════════════════════════════════════════════════════
DELETE FROM utm_tracking;
DELETE FROM campaign_analytics;
DELETE FROM message_log;
DELETE FROM campaigns;
DELETE FROM content_templates;
DELETE FROM omnichannel_strategies;
DELETE FROM segment_customers;
DELETE FROM conversion_tracking;
DELETE FROM journey_entries;
DELETE FROM journey_events;
DELETE FROM journey_flows;
DELETE FROM ai_agent_logs;
DELETE FROM ai_optimization_log;
DELETE FROM approval_queue;
DELETE FROM segment_definitions;
DELETE FROM funnel_stages;

TRUNCATE customers CASCADE;
ALTER SEQUENCE customers_customer_id_seq RESTART WITH 1;

-- ══════════════════════════════════════════════════════════════
-- STEP 2: New Lifecycle Funnel Stages
-- ══════════════════════════════════════════════════════════════
INSERT INTO funnel_stages (stage_number, stage_name, stage_description, stage_color) VALUES
(1, 'Awareness',    'Unknown visitors — convert to registered leads',           '#94a3b8'),
(2, 'Consideration','Registered/enquired — convert to first purchase',          '#f59e0b'),
(3, 'Conversion',   'First-time buyers — nurture to repeat purchase',           '#3b82f6'),
(4, 'Growth',       'Active repeat customers — maximize lifetime value',        '#22c55e'),
(5, 'Win-Back',     'Lapsed customers — reactivate before permanently lost',    '#ef4444'),
(6, 'Advocacy',     'Happy customers — turn into brand ambassadors',            '#a855f7'),
(7, 'Special',      'Unique behavioral groups requiring targeted strategies',   '#ec4899');

-- ══════════════════════════════════════════════════════════════
-- STEP 3: 28 Lifecycle Segments
-- ══════════════════════════════════════════════════════════════

-- ── STAGE 1: AWARENESS (3 segments) ──────────────────────────
INSERT INTO segment_definitions (segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points, winback_goal, end_goal, recommended_coupon, rfm_profile) VALUES
(1, (SELECT stage_id FROM funnel_stages WHERE stage_number=1),
 'Social Ad Leads',
 'Clicked Meta/Google/Instagram ad, may have messaged WhatsApp, but never registered or booked.',
 'B2C', 'High',
 $$lead_source IN ('Meta Ads','Google Ads','Instagram','Facebook') AND registration_date IS NULL AND first_booking_date IS NULL$$,
 '["Retarget within 24h of click","Use dynamic creative with viewed products","A/B test urgency vs discount messaging"]',
 'Convert to registered lead', 'Registration', 'WELCOME5',
 '{"recency":"N/A","frequency":"N/A","monetary":"N/A"}'),

(2, (SELECT stage_id FROM funnel_stages WHERE stage_number=1),
 'Website Browsers',
 'Visited website, viewed products, but never registered or enquired. Anonymous but trackable.',
 'B2C', 'Medium',
 $$website_sessions_total >= 1 AND registration_date IS NULL AND first_booking_date IS NULL AND lead_source IS NULL$$,
 '["Use exit-intent popup with 5% discount","Retarget on Meta/Google with viewed products","Track device fingerprint for cross-session targeting"]',
 'Convert to registered lead', 'Registration', 'WELCOME5',
 '{"recency":"N/A","frequency":"N/A","monetary":"N/A"}'),

(3, (SELECT stage_id FROM funnel_stages WHERE stage_number=1),
 'WhatsApp First-Touch',
 'Messaged on WhatsApp directly without registering. High intent but not yet in system.',
 'B2C', 'Critical',
 $$whatsapp_enquiry_date IS NOT NULL AND registration_date IS NULL AND first_booking_date IS NULL$$,
 '["Respond within 5 min on WhatsApp","Send product catalog via WA","Capture email for multi-channel nurture"]',
 'Convert to enquiry + registration', 'Registration', 'WELCOME5',
 '{"recency":"N/A","frequency":"N/A","monetary":"N/A"}');

-- ── STAGE 2: CONSIDERATION (5 segments) ──────────────────────
INSERT INTO segment_definitions (segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points, winback_goal, end_goal, recommended_coupon, rfm_profile) VALUES
(4, (SELECT stage_id FROM funnel_stages WHERE stage_number=2),
 'Fresh Cart Abandoners (0-3 days)',
 'Added to cart in last 3 days but did not complete. Very high purchase intent.',
 'B2C', 'Critical',
 $$last_abandoned_cart_date IS NOT NULL AND (NOW()::date - last_abandoned_cart_date::date) <= 3 AND first_booking_date IS NULL$$,
 '["Send WA reminder within 1h","Email with cart items + social proof at 4h","Offer 10% off at 24h if no conversion"]',
 'Complete abandoned booking', 'First Purchase', 'CART20',
 '{"recency":"high","frequency":"N/A","monetary":"N/A"}'),

(5, (SELECT stage_id FROM funnel_stages WHERE stage_number=2),
 'Stale Cart Abandoners (4-14 days)',
 'Cart abandoned 4-14 days ago. Still recoverable with the right incentive.',
 'B2C', 'High',
 $$last_abandoned_cart_date IS NOT NULL AND (NOW()::date - last_abandoned_cart_date::date) BETWEEN 4 AND 14 AND first_booking_date IS NULL$$,
 '["Stronger discount than fresh abandoners","Show alternative products at similar price","Create urgency with limited availability"]',
 'Win back with incentive', 'First Purchase', 'CART20',
 '{"recency":"medium","frequency":"N/A","monetary":"N/A"}'),

(6, (SELECT stage_id FROM funnel_stages WHERE stage_number=2),
 'Active Enquirers',
 'Enquired in last 7 days but never booked. Hot lead needing personalized follow-up.',
 'B2C', 'Critical',
 $$last_enquiry_date IS NOT NULL AND (NOW()::date - last_enquiry_date::date) <= 7 AND first_booking_date IS NULL$$,
 '["Personal WA follow-up with tailored options","Share reviews from similar travelers","Offer free cancellation to reduce risk"]',
 'Convert enquiry to booking', 'First Purchase', 'RAYNOW',
 '{"recency":"high","frequency":"N/A","monetary":"N/A"}'),

(7, (SELECT stage_id FROM funnel_stages WHERE stage_number=2),
 'Hesitant Browsers',
 'Viewed 5+ products without booking or enquiring. Comparing options, needs a push.',
 'B2C', 'Medium',
 $$product_views_count >= 5 AND first_booking_date IS NULL AND last_abandoned_cart_date IS NULL$$,
 '["Trigger price-drop alert emails","Send curated top-3 recommendation","Use scarcity messaging on popular items"]',
 'Convert browser to booker', 'First Purchase', 'RAYNOW',
 '{"recency":"N/A","frequency":"N/A","monetary":"N/A"}'),

(8, (SELECT stage_id FROM funnel_stages WHERE stage_number=2),
 'Payment Failed',
 'Started booking but payment failed. Technical or financial barrier to conversion.',
 'B2C', 'Critical',
 $$payment_failed = true AND first_booking_date IS NULL$$,
 '["Send immediate WA with payment retry link","Offer alternative payment methods","Provide customer support contact"]',
 'Resolve payment and complete booking', 'First Purchase', 'RAYNOW',
 '{"recency":"high","frequency":"N/A","monetary":"N/A"}');

-- ── STAGE 3: CONVERSION (4 segments) ─────────────────────────
INSERT INTO segment_definitions (segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points, winback_goal, end_goal, recommended_coupon, rfm_profile) VALUES
(9, (SELECT stage_id FROM funnel_stages WHERE stage_number=3),
 'Registered Not Booked',
 'Created account 7+ days ago but never purchased. Activation needed.',
 'B2C', 'High',
 $$registration_date IS NOT NULL AND first_booking_date IS NULL AND last_enquiry_date IS NULL AND last_abandoned_cart_date IS NULL AND (NOW()::date - registration_date::date) >= 7$$,
 '["Welcome email series with best-sellers","WA message with first-booking discount","Show trending experiences in their city"]',
 'Activate dormant account', 'First Purchase', 'WELCOME5',
 '{"recency":"N/A","frequency":"0","monetary":"0"}'),

(10, (SELECT stage_id FROM funnel_stages WHERE stage_number=3),
 'New Customers (0-30 days)',
 'Made first purchase within last 30 days. Critical delight window to secure loyalty.',
 'B2C', 'High',
 $$total_bookings >= 1 AND days_since_last_booking IS NOT NULL AND days_since_last_booking <= 30$$,
 '["Send booking confirmation + travel tips","Cross-sell add-ons for upcoming trip","Request review after travel date"]',
 'Drive second purchase', 'Repeat Purchase', 'RAYNOW',
 '{"recency":"5","frequency":"1","monetary":"varies"}'),

(11, (SELECT stage_id FROM funnel_stages WHERE stage_number=3),
 'Post-Trip Review Window',
 'Traveled within last 7 days. Perfect moment to capture review and drive rebooking.',
 'B2C', 'Critical',
 $$travel_date IS NOT NULL AND travel_date < NOW()::date AND (NOW()::date - travel_date) <= 7$$,
 '["Request review within 24h post-trip","Offer 15% off next booking if they review","Share photo/video request for UGC"]',
 'Capture review + drive rebook', 'Review + Repeat Purchase', 'RAYNOW',
 '{"recency":"5","frequency":"1+","monetary":"varies"}'),

(12, (SELECT stage_id FROM funnel_stages WHERE stage_number=3),
 'One-Time Buyers (31-90 days)',
 'Booked once, 31-90 days ago. Critical window to convert into repeat customer.',
 'B2C', 'High',
 $$total_bookings = 1 AND days_since_last_booking BETWEEN 31 AND 90$$,
 '["Send personalized recommendations based on first booking","Offer loyalty points for second booking","Share what similar travelers booked next"]',
 'Drive second purchase before lapse', 'Repeat Purchase', 'RAYNOW',
 '{"recency":"3-4","frequency":"1","monetary":"varies"}');

-- ── STAGE 4: GROWTH (5 segments) ─────────────────────────────
INSERT INTO segment_definitions (segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points, winback_goal, end_goal, recommended_coupon, rfm_profile) VALUES
(13, (SELECT stage_id FROM funnel_stages WHERE stage_number=4),
 'Repeat Buyers',
 '2-3 bookings, last within 90 days. Building loyalty — nurture into frequent travelers.',
 'B2C', 'High',
 $$total_bookings BETWEEN 2 AND 3 AND days_since_last_booking <= 90$$,
 '["Introduce loyalty program benefits","Recommend premium upgrades","Cross-sell complementary experiences"]',
 'Increase booking frequency', 'Loyalty Program Join', 'VIPEXTRA',
 '{"recency":"4-5","frequency":"2-3","monetary":"medium"}'),

(14, (SELECT stage_id FROM funnel_stages WHERE stage_number=4),
 'Frequent Travelers (4+ bookings)',
 'Booked 4+ times, active within 120 days. VIP candidates deserving premium treatment.',
 'B2C', 'Critical',
 $$total_bookings >= 4 AND days_since_last_booking <= 120$$,
 '["Assign VIP status with exclusive perks","Early access to new experiences","Personal concierge WA contact"]',
 'Maintain high frequency + upsell', 'VIP Retention', 'VIPEXTRA',
 '{"recency":"4-5","frequency":"5","monetary":"high"}'),

(15, (SELECT stage_id FROM funnel_stages WHERE stage_number=4),
 'High Spenders (5000+ AED)',
 'Lifetime revenue >= 5000 AED with recent activity. Premium segment for luxury upsell.',
 'B2C', 'Critical',
 $$total_revenue >= 5000 AND days_since_last_booking <= 150$$,
 '["Offer premium/luxury experiences","Exclusive yacht and helicopter tours","Personal travel advisor outreach"]',
 'Maximize lifetime value', 'Premium Upsell', 'VIPEXTRA',
 '{"recency":"3-5","frequency":"3+","monetary":"5"}'),

(16, (SELECT stage_id FROM funnel_stages WHERE stage_number=4),
 'Visa-Only → Tour Cross-Sell',
 'Used only visa services. Huge cross-sell opportunity for tours and activities.',
 'B2C', 'High',
 $$visa_services_used >= 1 AND visa_services_used = total_bookings AND days_since_last_booking <= 120$$,
 '["Recommend top tours matching visa destination","Bundle visa+tour discount","WA message with curated tour packages"]',
 'Cross-sell tour experiences', 'Tour Booking', 'RAYNOW',
 '{"recency":"varies","frequency":"1+","monetary":"low-medium"}'),

(17, (SELECT stage_id FROM funnel_stages WHERE stage_number=4),
 'Tour-Only → Visa Cross-Sell',
 'Booked tours but never used visa services. Offer convenience of visa + tour bundle.',
 'B2C', 'Medium',
 $$total_bookings >= 2 AND visa_services_used = 0 AND days_since_last_booking <= 120$$,
 '["Highlight visa service convenience","Offer visa processing discount","Bundle with next tour booking"]',
 'Cross-sell visa services', 'Visa Service Adoption', 'RAYNOW',
 '{"recency":"varies","frequency":"2+","monetary":"medium"}');

-- ── STAGE 5: WIN-BACK (5 segments) ───────────────────────────
INSERT INTO segment_definitions (segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points, winback_goal, end_goal, recommended_coupon, rfm_profile) VALUES
(18, (SELECT stage_id FROM funnel_stages WHERE stage_number=5),
 'Cooling Down (31-60 days)',
 'Was active but slowing down. Early intervention prevents full lapse.',
 'B2C', 'High',
 $$total_bookings >= 1 AND days_since_last_booking BETWEEN 31 AND 60$$,
 '["Send whats-new content + soft reminder","Share trending experiences","Light nudge — no heavy discounting yet"]',
 'Re-engage before they go cold', 'Re-engagement Booking', 'RAYNOW',
 '{"recency":"3","frequency":"varies","monetary":"varies"}'),

(19, (SELECT stage_id FROM funnel_stages WHERE stage_number=5),
 'At Risk (61-120 days)',
 'No activity for 2-4 months. Urgent reactivation needed with personalized offer.',
 'B2C', 'Critical',
 $$total_bookings >= 1 AND days_since_last_booking BETWEEN 61 AND 120$$,
 '["Personalized email: We miss you + special offer","WA message with exclusive comeback deal","Show new experiences added since last visit"]',
 'Reactivate with targeted offer', 'Win-Back Booking', 'WINBACK15',
 '{"recency":"2","frequency":"varies","monetary":"varies"}'),

(20, (SELECT stage_id FROM funnel_stages WHERE stage_number=5),
 'Hibernating (121-180 days)',
 'Inactive 4-6 months. Needs strong incentive to return.',
 'B2C', 'High',
 $$total_bookings >= 1 AND days_since_last_booking BETWEEN 121 AND 180$$,
 '["Deep discount win-back offer (20%)","Highlight what has changed since they left","Emotional messaging: Your next adventure awaits"]',
 'Win back with strong incentive', 'Win-Back Booking', 'WINBACK15',
 '{"recency":"1","frequency":"varies","monetary":"varies"}'),

(21, (SELECT stage_id FROM funnel_stages WHERE stage_number=5),
 'Lost High-Value (180+ days, 3000+ AED)',
 'Spent 3000+ AED but gone 6+ months. Premium win-back with VIP treatment.',
 'B2C', 'Critical',
 $$total_bookings >= 1 AND days_since_last_booking > 180 AND total_revenue >= 3000$$,
 '["Personal outreach from senior team","Exclusive VIP comeback package","Premium experience invitation"]',
 'Premium reactivation campaign', 'VIP Win-Back', 'WINBACK15',
 '{"recency":"1","frequency":"varies","monetary":"4-5"}'),

(22, (SELECT stage_id FROM funnel_stages WHERE stage_number=5),
 'Lost Regular (180+ days, <3000 AED)',
 'Low-moderate spenders gone 6+ months. Standard win-back with compelling offer.',
 'B2C', 'Medium',
 $$total_bookings >= 1 AND days_since_last_booking > 180 AND total_revenue < 3000$$,
 '["Automated win-back email series","Flash sale notifications","Show budget-friendly new experiences"]',
 'Standard reactivation', 'Win-Back Booking', 'WINBACK15',
 '{"recency":"1","frequency":"1","monetary":"1-3"}');

-- ── STAGE 6: ADVOCACY (3 segments) ───────────────────────────
INSERT INTO segment_definitions (segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points, winback_goal, end_goal, recommended_coupon, rfm_profile) VALUES
(23, (SELECT stage_id FROM funnel_stages WHERE stage_number=6),
 'Happy Reviewers (4-5 Stars)',
 'Left positive reviews. Prime candidates for referral program and social proof.',
 'B2C', 'High',
 $$average_rating_given >= 4 AND reviews_submitted >= 1$$,
 '["Invite to referral program","Ask to share review on social media","Offer reward for video testimonial"]',
 'Convert reviewer into referrer', 'Referral Generation', 'REFER10',
 '{"recency":"varies","frequency":"varies","monetary":"varies"}'),

(24, (SELECT stage_id FROM funnel_stages WHERE stage_number=6),
 'Social Media Advocates',
 'Mentioned brand on social media. Amplify their reach with UGC campaigns.',
 'B2C', 'Medium',
 $$social_media_mentions >= 2$$,
 '["Feature their content on brand channels","Send surprise gift/upgrade on next booking","Invite to brand ambassador program"]',
 'Amplify social reach', 'Brand Ambassador', 'REFER10',
 '{"recency":"varies","frequency":"varies","monetary":"varies"}'),

(25, (SELECT stage_id FROM funnel_stages WHERE stage_number=6),
 'NPS Promoters',
 'NPS score 9-10. Most likely to recommend. Activate for organic growth.',
 'B2C', 'High',
 $$nps_score >= 9$$,
 '["Direct referral program enrollment","Ask for Google/TripAdvisor review","Offer exclusive ambassador perks"]',
 'Activate as growth channel', 'Active Referrer', 'REFER10',
 '{"recency":"varies","frequency":"varies","monetary":"varies"}');

-- ── STAGE 7: SPECIAL (3 segments) ────────────────────────────
INSERT INTO segment_definitions (segment_number, stage_id, segment_name, segment_description, customer_type, priority, sql_criteria, key_points, winback_goal, end_goal, recommended_coupon, rfm_profile) VALUES
(26, (SELECT stage_id FROM funnel_stages WHERE stage_number=7),
 'B2B & Corporate',
 'Business accounts, travel agencies, and corporate clients. Bulk bookings and partnerships.',
 'B2B', 'High',
 $$customer_type IN ('B2B','Corporate','Educational')$$,
 '["Dedicated account manager","Volume-based pricing tiers","Custom corporate packages"]',
 'Grow corporate revenue', 'Corporate Partnership', 'CORPORATE10',
 '{"recency":"varies","frequency":"high","monetary":"high"}'),

(27, (SELECT stage_id FROM funnel_stages WHERE stage_number=7),
 'Birthday Month',
 'Customers with birthday this month. High-conversion occasion-based targeting.',
 'B2C', 'Medium',
 $$date_of_birth IS NOT NULL AND EXTRACT(MONTH FROM date_of_birth) = EXTRACT(MONTH FROM NOW())$$,
 '["Send birthday greeting + special offer","Offer birthday experience package","Personalized birthday discount code"]',
 'Drive occasion-based purchase', 'Birthday Booking', 'BIRTHDAY25',
 '{"recency":"varies","frequency":"varies","monetary":"varies"}'),

(28, (SELECT stage_id FROM funnel_stages WHERE stage_number=7),
 'High Cancellation Risk',
 'Pattern of cancellations. Needs flexible options and trust-building.',
 'B2C', 'High',
 $$cancellation_rate >= 30 OR total_cancelled_bookings >= 2$$,
 '["Highlight free cancellation policy","Offer flexible rebooking options","Build trust with reviews and guarantees"]',
 'Reduce cancellation rate', 'Completed Booking', 'RAYNOW',
 '{"recency":"varies","frequency":"varies","monetary":"varies"}');


-- ══════════════════════════════════════════════════════════════
-- STEP 4: SEED CUSTOMERS (~4500 balanced across segments)
-- ══════════════════════════════════════════════════════════════

-- ── Seg 1: Social Ad Leads (180) ────────────────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, lead_source, whatsapp_enquiry_date, registration_date, first_booking_date, total_bookings, total_revenue, whatsapp_opt_in, email_opt_in, residence_country, residence_city)
SELECT 'Lead'||n, 'Social'||(n%40), 'lead.social'||n||'@gmail.com', '+971'||(500000000+n)::TEXT, 'B2C',
  (ARRAY['India','Pakistan','UK','UAE','Philippines','Egypt','Germany'])[1+n%7],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  (ARRAY['Meta Ads','Google Ads','Instagram','Facebook'])[1+n%4],
  CASE WHEN n%3=0 THEN NOW()-(n%14||' days')::INTERVAL ELSE NULL END,
  NULL, NULL, 0, 0, n%2=0, false,
  (ARRAY['UAE','India','UK','Saudi Arabia'])[1+n%4],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','Riyadh'])[1+n%4]
FROM generate_series(1,180) AS n;

-- ── Seg 2: Website Browsers (170) ───────────────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, website_sessions_total, product_views_count, registration_date, first_booking_date, total_bookings, total_revenue, lead_source, whatsapp_opt_in, email_opt_in, residence_country, residence_city)
SELECT 'Browser'||n, 'Web'||(n%35), 'browser'||n||'@gmail.com', '+971'||(501000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','Germany','USA','Russia','China'])[1+n%6],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  1+n%6, n%4, NULL, NULL, 0, 0, NULL, false, false,
  (ARRAY['UAE','India','UK','USA','Germany'])[1+n%5],
  (ARRAY['Dubai','Mumbai','London','New York','Berlin'])[1+n%5]
FROM generate_series(1,170) AS n;

-- ── Seg 3: WhatsApp First-Touch (150) ───────────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, whatsapp_enquiry_date, registration_date, first_booking_date, total_bookings, total_revenue, lead_source, whatsapp_opt_in, email_opt_in, residence_country, residence_city)
SELECT 'WA'||n, 'Lead'||(n%30), 'wa.lead'||n||'@gmail.com', '+971'||(502000000+n)::TEXT, 'B2C',
  (ARRAY['India','Pakistan','UAE','Bangladesh','Philippines'])[1+n%5],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-(n%14||' days')::INTERVAL, NULL, NULL, 0, 0, NULL, true, false,
  (ARRAY['UAE','India','Pakistan','Philippines'])[1+n%4],
  (ARRAY['Dubai','Abu Dhabi','Sharjah','Karachi'])[1+n%4]
FROM generate_series(1,150) AS n;

-- ── Seg 4: Fresh Cart Abandoners 0-3 days (180) ────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, last_abandoned_cart_date, first_booking_date, total_bookings, total_revenue, product_views_count, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total)
SELECT 'Cart'||n, 'Fresh'||(n%30), 'cart.fresh'||n||'@gmail.com', '+971'||(510000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','Germany','UAE','Russia'])[1+n%5],
  CASE WHEN n%3=0 THEN 'female' ELSE 'male' END,
  NOW()-((10+n%60)||' days')::INTERVAL,
  NOW()-(n%3||' days')::INTERVAL,
  NULL, 0, 0, 3+n%5, true, true,
  (ARRAY['UAE','India','UK','Saudi Arabia'])[1+n%4],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','Jeddah'])[1+n%4],
  2+n%6
FROM generate_series(1,180) AS n;

-- ── Seg 5: Stale Cart Abandoners 4-14 days (150) ───────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, last_abandoned_cart_date, first_booking_date, total_bookings, total_revenue, product_views_count, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total)
SELECT 'Cart'||n, 'Stale'||(n%25), 'cart.stale'||n||'@gmail.com', '+971'||(511000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','UAE','Germany','USA'])[1+n%5],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((20+n%60)||' days')::INTERVAL,
  NOW()-((4+n%10)||' days')::INTERVAL,
  NULL, 0, 0, 2+n%4, true, true,
  (ARRAY['UAE','India','UK','Germany'])[1+n%4],
  (ARRAY['Dubai','Mumbai','London','Berlin'])[1+n%4],
  2+n%5
FROM generate_series(1,150) AS n;

-- ── Seg 6: Active Enquirers 0-7 days (180) ─────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, last_enquiry_date, enquiry_count, first_booking_date, total_bookings, total_revenue, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total)
SELECT 'Enquiry'||n, 'Hot'||(n%35), 'enquiry.hot'||n||'@gmail.com', '+971'||(520000000+n)::TEXT, 'B2C',
  (ARRAY['India','Pakistan','UK','UAE','Philippines'])[1+n%5],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((5+n%30)||' days')::INTERVAL,
  NOW()-(n%7||' days')::INTERVAL,
  1+n%3, NULL, 0, 0, true, true,
  (ARRAY['UAE','India','UK','Pakistan'])[1+n%4],
  (ARRAY['Dubai','Abu Dhabi','Sharjah','Mumbai'])[1+n%4],
  1+n%5
FROM generate_series(1,180) AS n;

-- ── Seg 7: Hesitant Browsers (160) ──────────────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, product_views_count, first_booking_date, total_bookings, total_revenue, last_abandoned_cart_date, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total)
SELECT 'Browse'||n, 'Hesitant'||(n%30), 'browse.hesitant'||n||'@gmail.com', '+971'||(521000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','Germany','USA','Russia','Australia'])[1+n%6],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((15+n%60)||' days')::INTERVAL,
  5+n%8, NULL, 0, 0, NULL, n%2=0, true,
  (ARRAY['UAE','India','UK','Germany','USA'])[1+n%5],
  (ARRAY['Dubai','Mumbai','London','Berlin','New York'])[1+n%5],
  3+n%8
FROM generate_series(1,160) AS n;

-- ── Seg 8: Payment Failed (130) ─────────────────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, payment_failed, first_booking_date, total_bookings, total_revenue, product_views_count, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total)
SELECT 'PayFail'||n, 'User'||(n%25), 'payfail'||n||'@gmail.com', '+971'||(522000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','UAE','Pakistan','Russia'])[1+n%5],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((10+n%45)||' days')::INTERVAL,
  true, NULL, 0, 0, 4+n%6, true, true,
  (ARRAY['UAE','India','UK','Russia'])[1+n%4],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','Moscow'])[1+n%4],
  3+n%5
FROM generate_series(1,130) AS n;

-- ── Seg 9: Registered Not Booked (200) ──────────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, last_enquiry_date, last_abandoned_cart_date, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total)
SELECT 'Idle'||n, 'Reg'||(n%40), 'idle.reg'||n||'@gmail.com', '+971'||(530000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','Germany','USA','UAE','China'])[1+n%6],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((7+n%50)||' days')::INTERVAL,
  NULL, 0, 0, NULL, NULL, false, true,
  (ARRAY['UAE','India','UK','USA','Germany'])[1+n%5],
  (ARRAY['Dubai','Mumbai','London','New York','Berlin'])[1+n%5],
  0
FROM generate_series(1,200) AS n;

-- ── Seg 10: New Customers 0-30 days (180) ───────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, whatsapp_opt_in, email_opt_in, sms_opt_in, residence_country, residence_city, website_sessions_total, product_views_count)
SELECT 'New'||n, 'Customer'||(n%35), 'new.customer'||n||'@gmail.com', '+971'||(540000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','Germany','USA','UAE','Russia'])[1+n%6],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((40+n%100)||' days')::INTERVAL,
  NOW()-((5+n%25)||' days')::INTERVAL,
  1+n%2, 400+n%2500, n%30, true, true, n%2=0,
  (ARRAY['UAE','India','UK','Germany','USA'])[1+n%5],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London','Berlin'])[1+n%5],
  4+n%8, 5+n%10
FROM generate_series(1,180) AS n;

-- ── Seg 11: Post-Trip Review Window (130) ───────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, travel_date, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total, product_views_count)
SELECT 'PostTrip'||n, 'Guest'||(n%25), 'posttrip'||n||'@gmail.com', '+971'||(541000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','Germany','USA','UAE','Australia','France'])[1+n%7],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((60+n%200)||' days')::INTERVAL,
  NOW()-((30+n%60)||' days')::INTERVAL,
  1+n%3, 600+n%3000, 5+n%25,
  NOW()-((1+n%6)||' days')::INTERVAL,
  true, true,
  (ARRAY['UAE','India','UK','Germany','France'])[1+n%5],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London','Paris'])[1+n%5],
  5+n%10, 5+n%8
FROM generate_series(1,130) AS n;

-- ── Seg 12: One-Time Buyers 31-90 days (190) ────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total, product_views_count)
SELECT 'OneTime'||n, 'Buyer'||(n%35), 'onetime'||n||'@gmail.com', '+971'||(542000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','UAE','Pakistan','Philippines','Egypt'])[1+n%6],
  CASE WHEN n%3=0 THEN 'female' ELSE 'male' END,
  NOW()-((60+n%150)||' days')::INTERVAL,
  NOW()-((35+n%55)||' days')::INTERVAL,
  1, 300+n%2000, 31+n%59,
  true, true,
  (ARRAY['UAE','India','UK','Russia','Pakistan'])[1+n%5],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','Moscow','Karachi'])[1+n%5],
  3+n%5, 3+n%4
FROM generate_series(1,190) AS n;

-- ── Seg 13: Repeat Buyers 2-3 bookings (160) ────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, whatsapp_opt_in, email_opt_in, sms_opt_in, residence_country, residence_city, website_sessions_total, product_views_count)
SELECT 'Repeat'||n, 'Buyer'||(n%30), 'repeat.buyer'||n||'@gmail.com', '+971'||(550000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','Germany','USA','UAE','Russia'])[1+n%6],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((120+n%200)||' days')::INTERVAL,
  NOW()-((90+n%150)||' days')::INTERVAL,
  2+n%2, 1200+n%3000, 10+n%80, true, true, n%2=0,
  (ARRAY['UAE','India','UK','Germany','USA'])[1+n%5],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London','Berlin'])[1+n%5],
  6+n%10, 5+n%8
FROM generate_series(1,160) AS n;

-- ── Seg 14: Frequent Travelers 4+ (120) ─────────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, preferred_products, whatsapp_opt_in, email_opt_in, sms_opt_in, residence_country, residence_city, website_sessions_total, product_views_count)
SELECT 'VIP'||n, 'Traveler'||(n%25), 'vip.traveler'||n||'@gmail.com', '+971'||(551000000+n)::TEXT, 'B2C',
  (ARRAY['UAE','UK','Germany','USA','India','Russia'])[1+n%6],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((200+n%300)||' days')::INTERVAL,
  NOW()-((180+n%250)||' days')::INTERVAL,
  4+n%6, 3000+n%15000, n%120,
  ARRAY['Desert Safari','Cruise','Yacht Tour'],
  true, true, true,
  (ARRAY['UAE','UK','Germany','USA'])[1+n%4],
  (ARRAY['Dubai','London','Berlin','New York'])[1+n%4],
  10+n%20, 8+n%15
FROM generate_series(1,120) AS n;

-- ── Seg 15: High Spenders 5000+ AED (100) ───────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, whatsapp_opt_in, email_opt_in, sms_opt_in, residence_country, residence_city, website_sessions_total, product_views_count)
SELECT 'Premium'||n, 'Client'||(n%20), 'premium'||n||'@gmail.com', '+971'||(552000000+n)::TEXT, 'B2C',
  (ARRAY['UAE','UK','Germany','USA','India'])[1+n%5],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((200+n%300)||' days')::INTERVAL,
  NOW()-((150+n%200)||' days')::INTERVAL,
  3+n%5, 5000+n%20000, 10+n%140,
  true, true, true,
  (ARRAY['UAE','UK','USA','Germany'])[1+n%4],
  (ARRAY['Dubai','London','New York','Berlin'])[1+n%4],
  8+n%15, 6+n%12
FROM generate_series(1,100) AS n;

-- ── Seg 16: Visa-Only Cross-Sell (120) ──────────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, visa_services_used, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total)
SELECT 'VisaOnly'||n, 'Client'||(n%25), 'visaonly'||n||'@gmail.com', '+971'||(553000000+n)::TEXT, 'B2C',
  (ARRAY['India','Pakistan','Bangladesh','Philippines','Egypt','Nigeria'])[1+n%6],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((30+n%150)||' days')::INTERVAL,
  NOW()-((20+n%100)||' days')::INTERVAL,
  1+n%2, 200+n%800, 10+n%110,
  1+n%2, true, true,
  (ARRAY['UAE','India','Pakistan','Philippines'])[1+n%4],
  (ARRAY['Dubai','Abu Dhabi','Sharjah','Manila'])[1+n%4],
  2+n%5
FROM generate_series(1,120) AS n;
-- Ensure visa_services_used = total_bookings for these
UPDATE customers SET visa_services_used = total_bookings WHERE email LIKE 'visaonly%';

-- ── Seg 17: Tour-Only Cross-Sell (140) ──────────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, visa_services_used, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total, product_views_count)
SELECT 'TourOnly'||n, 'Guest'||(n%25), 'touronly'||n||'@gmail.com', '+971'||(554000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','Germany','USA','Russia','France'])[1+n%6],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((60+n%200)||' days')::INTERVAL,
  NOW()-((50+n%150)||' days')::INTERVAL,
  2+n%2, 800+n%3000, 10+n%110,
  0, true, true,
  (ARRAY['UAE','India','UK','Germany','USA'])[1+n%5],
  (ARRAY['Dubai','Mumbai','London','Berlin','New York'])[1+n%5],
  4+n%8, 4+n%6
FROM generate_series(1,140) AS n;

-- ── Seg 18: Cooling Down 31-60 days (200) ───────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total, product_views_count)
SELECT 'Cooling'||n, 'Down'||(n%40), 'cooling'||n||'@gmail.com', '+971'||(560000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','Germany','USA','UAE','Russia','China'])[1+n%7],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((100+n%200)||' days')::INTERVAL,
  NOW()-((80+n%150)||' days')::INTERVAL,
  1+n%3, 500+n%3000, 31+n%29,
  true, true,
  (ARRAY['UAE','India','UK','Germany','USA'])[1+n%5],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London','Berlin'])[1+n%5],
  4+n%8, 3+n%6
FROM generate_series(1,200) AS n;

-- ── Seg 19: At Risk 61-120 days (200) ───────────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total, product_views_count)
SELECT 'AtRisk'||n, 'Customer'||(n%40), 'atrisk'||n||'@gmail.com', '+971'||(561000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','UAE','Germany','USA','Russia'])[1+n%6],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((200+n%300)||' days')::INTERVAL,
  NOW()-((150+n%200)||' days')::INTERVAL,
  1+n%4, 600+n%4000, 61+n%59,
  true, true,
  (ARRAY['UAE','India','UK','Germany'])[1+n%4],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London'])[1+n%4],
  5+n%10, 4+n%8
FROM generate_series(1,200) AS n;

-- ── Seg 20: Hibernating 121-180 days (180) ──────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total)
SELECT 'Hibernate'||n, 'User'||(n%35), 'hibernate'||n||'@gmail.com', '+971'||(562000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','UAE','Pakistan','Germany','USA'])[1+n%6],
  CASE WHEN n%3=0 THEN 'female' ELSE 'male' END,
  NOW()-((300+n%300)||' days')::INTERVAL,
  NOW()-((250+n%200)||' days')::INTERVAL,
  1+n%3, 400+n%3000, 121+n%59,
  true, true,
  (ARRAY['UAE','India','UK','Pakistan'])[1+n%4],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','Karachi'])[1+n%4],
  3+n%8
FROM generate_series(1,180) AS n;

-- ── Seg 21: Lost High-Value 180+ days, 3000+ AED (170) ─────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, preferred_products, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total)
SELECT 'LostVIP'||n, 'Client'||(n%30), 'lost.vip'||n||'@gmail.com', '+971'||(563000000+n)::TEXT, 'B2C',
  (ARRAY['UAE','UK','Germany','USA','India','Russia'])[1+n%6],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((400+n%300)||' days')::INTERVAL,
  NOW()-((350+n%250)||' days')::INTERVAL,
  2+n%5, 3000+(n%15)*500, 181+n%200,
  ARRAY['Desert Safari','Cruise','Yacht Tour'],
  true, true,
  (ARRAY['UAE','UK','Germany','USA'])[1+n%4],
  (ARRAY['Dubai','London','Berlin','New York'])[1+n%4],
  5+n%10
FROM generate_series(1,170) AS n;

-- ── Seg 22: Lost Regular 180+ days, <3000 AED (150) ────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total)
SELECT 'LostReg'||n, 'User'||(n%30), 'lost.reg'||n||'@gmail.com', '+971'||(564000000+n)::TEXT, 'B2C',
  (ARRAY['India','Pakistan','UK','UAE','Philippines'])[1+n%5],
  CASE WHEN n%3=0 THEN 'female' ELSE 'male' END,
  NOW()-((300+n%300)||' days')::INTERVAL,
  NOW()-((250+n%250)||' days')::INTERVAL,
  1, 300+n%2500, 181+n%300,
  true, true,
  (ARRAY['UAE','India','Pakistan','Philippines'])[1+n%4],
  (ARRAY['Dubai','Abu Dhabi','Sharjah','Manila'])[1+n%4],
  2+n%5
FROM generate_series(1,150) AS n;

-- ── Seg 23: Happy Reviewers 4-5 stars (150) ─────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, average_rating_given, reviews_submitted, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total)
SELECT 'Reviewer'||n, 'Happy'||(n%30), 'reviewer'||n||'@gmail.com', '+971'||(570000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','UAE','USA','Germany','Australia'])[1+n%6],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((60+n%200)||' days')::INTERVAL,
  NOW()-((40+n%180)||' days')::INTERVAL,
  2+n%4, 800+n%4000, 10+n%60,
  4.0+(n%2)*0.5, 1+n%5,
  true, true,
  (ARRAY['UAE','India','UK','USA'])[1+n%4],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London'])[1+n%4],
  5+n%15
FROM generate_series(1,150) AS n;

-- ── Seg 24: Social Media Advocates (130) ────────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, social_media_mentions, average_rating_given, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total)
SELECT 'Social'||n, 'Star'||(n%25), 'social.star'||n||'@gmail.com', '+971'||(571000000+n)::TEXT, 'B2C',
  (ARRAY['UAE','India','UK','USA','Germany','Russia'])[1+n%6],
  CASE WHEN n%3=0 THEN 'female' ELSE 'male' END,
  NOW()-((30+n%200)||' days')::INTERVAL,
  NOW()-((20+n%150)||' days')::INTERVAL,
  1+n%5, 500+n%5000, 10+n%90,
  2+n%8, 3.5+(n%3)*0.5,
  true, true,
  (ARRAY['UAE','India','UK','USA'])[1+n%4],
  (ARRAY['Dubai','Mumbai','London','New York'])[1+n%4],
  5+n%20
FROM generate_series(1,130) AS n;

-- ── Seg 25: NPS Promoters (120) ─────────────────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, nps_score, average_rating_given, reviews_submitted, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total)
SELECT 'NPS'||n, 'Promoter'||(n%25), 'nps.promoter'||n||'@gmail.com', '+971'||(572000000+n)::TEXT, 'B2C',
  (ARRAY['UAE','India','UK','USA','Germany'])[1+n%5],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((60+n%200)||' days')::INTERVAL,
  NOW()-((40+n%180)||' days')::INTERVAL,
  2+n%5, 1000+n%5000, 10+n%80,
  9+n%2, 4.0+(n%2)*0.5, n%4,
  true, true,
  (ARRAY['UAE','India','UK','USA'])[1+n%4],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London'])[1+n%4],
  5+n%15
FROM generate_series(1,120) AS n;

-- ── Seg 26: B2B & Corporate (200) ───────────────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, whatsapp_opt_in, email_opt_in, residence_country, residence_city)
SELECT
  CASE WHEN n%3=0 THEN 'Agency' WHEN n%3=1 THEN 'Corp' ELSE 'School' END || n,
  'Partner'||(n%40),
  CASE WHEN n%3=0 THEN 'agency'||n||'@travel.com' WHEN n%3=1 THEN 'corp'||n||'@company.com' ELSE 'school'||n||'@edu.ae' END,
  '+971'||(580000000+n)::TEXT,
  CASE WHEN n%3=0 THEN 'B2B' WHEN n%3=1 THEN 'Corporate' ELSE 'Educational' END,
  (ARRAY['UAE','India','UK','Germany','USA'])[1+n%5],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((30+n%300)||' days')::INTERVAL,
  CASE WHEN n%2=0 THEN NOW()-((20+n%200)||' days')::INTERVAL ELSE NULL END,
  CASE WHEN n%2=0 THEN 2+n%10 ELSE 0 END,
  CASE WHEN n%2=0 THEN 3000+n%30000 ELSE 0 END,
  CASE WHEN n%2=0 THEN 10+n%90 ELSE NULL END,
  true, true,
  (ARRAY['UAE','India','UK','Germany'])[1+n%4],
  (ARRAY['Dubai','Abu Dhabi','London','Berlin'])[1+n%4]
FROM generate_series(1,200) AS n;

-- ── Seg 27: Birthday Month (180) ────────────────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, date_of_birth, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total)
SELECT 'Birthday'||n, 'Celeb'||(n%35), 'birthday'||n||'@gmail.com', '+971'||(581000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','UAE','USA','Germany','Russia'])[1+n%6],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((60+n%300)||' days')::INTERVAL,
  CASE WHEN n%2=0 THEN NOW()-((30+n%200)||' days')::INTERVAL ELSE NULL END,
  CASE WHEN n%2=0 THEN 1+n%3 ELSE 0 END,
  CASE WHEN n%2=0 THEN 400+n%3000 ELSE 0 END,
  CASE WHEN n%2=0 THEN 20+n%90 ELSE NULL END,
  MAKE_DATE(1985+(n%30)::INT, EXTRACT(MONTH FROM NOW())::INT, LEAST(28,(1+n%28)::INT)),
  true, true,
  (ARRAY['UAE','India','UK','USA','Germany'])[1+n%5],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London','Berlin'])[1+n%5],
  2+n%8
FROM generate_series(1,180) AS n;

-- ── Seg 28: High Cancellation Risk (120) ────────────────────
INSERT INTO customers (first_name, last_name, email, phone_number, customer_type, nationality, gender, registration_date, first_booking_date, total_bookings, total_revenue, days_since_last_booking, cancellation_rate, total_cancelled_bookings, whatsapp_opt_in, email_opt_in, residence_country, residence_city, website_sessions_total)
SELECT 'CancelRisk'||n, 'Cust'||(n%25), 'cancel.risk'||n||'@gmail.com', '+971'||(582000000+n)::TEXT, 'B2C',
  (ARRAY['India','UK','UAE','Russia','Germany','USA'])[1+n%6],
  CASE WHEN n%2=0 THEN 'male' ELSE 'female' END,
  NOW()-((60+n%200)||' days')::INTERVAL,
  NOW()-((30+n%150)||' days')::INTERVAL,
  2+n%5, 400+n%3000, 10+n%60,
  30+n%50, 2+n%4,
  true, true,
  (ARRAY['UAE','India','UK','Russia'])[1+n%4],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','Moscow'])[1+n%4],
  3+n%8
FROM generate_series(1,120) AS n;


-- ══════════════════════════════════════════════════════════════
-- STEP 5: Set defaults + compute RFM
-- ══════════════════════════════════════════════════════════════
UPDATE customers SET
  payment_failed = COALESCE(payment_failed, false),
  holiday_traveler = COALESCE(holiday_traveler, false),
  lead_status = CASE
    WHEN total_bookings > 0 THEN 'customer'
    WHEN last_enquiry_date IS NOT NULL THEN 'qualified'
    WHEN registration_date IS NOT NULL THEN 'registered'
    ELSE 'new'
  END;

UPDATE customers SET
  rfm_recency_score = CASE
    WHEN days_since_last_booking IS NULL THEN CASE WHEN total_bookings > 0 THEN 3 ELSE 1 END
    WHEN days_since_last_booking <= 30  THEN 5
    WHEN days_since_last_booking <= 60  THEN 4
    WHEN days_since_last_booking <= 90  THEN 3
    WHEN days_since_last_booking <= 180 THEN 2
    ELSE 1
  END,
  rfm_frequency_score = CASE
    WHEN total_bookings >= 5 THEN 5
    WHEN total_bookings = 4  THEN 4
    WHEN total_bookings = 3  THEN 3
    WHEN total_bookings = 2  THEN 2
    WHEN total_bookings = 1  THEN 1
    ELSE 0
  END,
  rfm_monetary_score = CASE
    WHEN total_revenue >= 5000 THEN 5
    WHEN total_revenue >= 3000 THEN 4
    WHEN total_revenue >= 1500 THEN 3
    WHEN total_revenue >= 500  THEN 2
    WHEN total_revenue > 0     THEN 1
    ELSE 0
  END,
  rfm_updated_at = NOW();

UPDATE customers SET rfm_total_score = rfm_recency_score + rfm_frequency_score + rfm_monetary_score;

UPDATE customers SET rfm_segment_label = CASE
  WHEN rfm_total_score >= 13 THEN 'Champions'
  WHEN rfm_total_score >= 11 THEN 'Loyal Customers'
  WHEN rfm_total_score >= 9  THEN 'Potential Loyalists'
  WHEN rfm_total_score >= 7  THEN 'At Risk'
  WHEN rfm_total_score >= 5  THEN 'Need Attention'
  WHEN rfm_total_score >= 3  THEN 'Hibernating'
  ELSE 'Lost'
END;

UPDATE customers SET winback_probability = CASE
  WHEN total_bookings = 0 THEN 15.0
  WHEN rfm_segment_label = 'Champions'          THEN 95.0
  WHEN rfm_segment_label = 'Loyal Customers'     THEN 85.0
  WHEN rfm_segment_label = 'Potential Loyalists' THEN 70.0
  WHEN rfm_segment_label = 'At Risk'             THEN 50.0
  WHEN rfm_segment_label = 'Need Attention'      THEN 35.0
  WHEN rfm_segment_label = 'Hibernating'         THEN 20.0
  ELSE 10.0
END;

UPDATE customers SET winback_strategy = CASE
  WHEN rfm_segment_label IN ('Champions','Loyal Customers') THEN 'VIP Retention & Upsell'
  WHEN rfm_segment_label = 'Potential Loyalists'            THEN 'Nurture to Loyalty'
  WHEN rfm_segment_label = 'At Risk'                        THEN 'Re-engagement Campaign'
  WHEN rfm_segment_label = 'Need Attention'                 THEN 'Win-back Discount Offer'
  WHEN rfm_segment_label = 'Hibernating'                    THEN 'Aggressive Win-back'
  WHEN rfm_segment_label = 'Lost'                           THEN 'Last Chance Offer'
  ELSE 'Cold Lead Nurture'
END;


-- ══════════════════════════════════════════════════════════════
-- STEP 6: Omnichannel Strategies (28, one per segment)
-- ══════════════════════════════════════════════════════════════
INSERT INTO omnichannel_strategies (name, description, segment_label, channels, status, flow_steps) VALUES
('Social Ad Retargeting',       'Retarget social ad clickers across channels',                    'Social Ad Leads',                    '{whatsapp,email,web}',           'active', '[{"day":0,"channel":"web","action":"Retarget ad"},{"day":1,"channel":"whatsapp","action":"WA catalog"},{"day":3,"channel":"email","action":"Welcome offer"}]'),
('Website Visitor Capture',     'Convert anonymous browsers into registered leads',               'Website Browsers',                   '{web,email}',                    'active', '[{"day":0,"channel":"web","action":"Exit-intent popup"},{"day":1,"channel":"web","action":"Retarget ad"},{"day":3,"channel":"email","action":"Best sellers"}]'),
('WhatsApp Lead Nurture',       'Nurture WhatsApp first-touch leads to registration',             'WhatsApp First-Touch',               '{whatsapp,email}',               'active', '[{"day":0,"channel":"whatsapp","action":"Quick response"},{"day":1,"channel":"whatsapp","action":"Product catalog"},{"day":3,"channel":"email","action":"Register invite"}]'),
('Cart Recovery Urgent',        'Recover fresh cart abandoners with urgency',                     'Fresh Cart Abandoners (0-3 days)',    '{whatsapp,email,sms}',           'active', '[{"day":0,"channel":"whatsapp","action":"Cart reminder 1h"},{"day":0,"channel":"email","action":"Cart + social proof 4h"},{"day":1,"channel":"sms","action":"Last chance + 10% off"}]'),
('Cart Recovery Extended',      'Win back stale cart abandoners with incentives',                 'Stale Cart Abandoners (4-14 days)',   '{email,whatsapp,web}',           'active', '[{"day":0,"channel":"email","action":"Cart reminder + 15% off"},{"day":2,"channel":"whatsapp","action":"Alternative products"},{"day":5,"channel":"web","action":"Retarget ad"}]'),
('Hot Enquiry Conversion',      'Convert active enquirers to first booking',                     'Active Enquirers',                    '{whatsapp,email,sms}',           'active', '[{"day":0,"channel":"whatsapp","action":"Personal follow-up"},{"day":1,"channel":"email","action":"Tailored options"},{"day":3,"channel":"sms","action":"Limited time offer"}]'),
('Browser Activation',          'Push hesitant browsers to take action',                         'Hesitant Browsers',                   '{email,web,push}',               'active', '[{"day":0,"channel":"email","action":"Price drop alert"},{"day":2,"channel":"web","action":"Retarget with viewed items"},{"day":5,"channel":"push","action":"Flash sale"}]'),
('Payment Recovery',            'Help payment-failed customers complete booking',                 'Payment Failed',                      '{whatsapp,email,sms}',           'active', '[{"day":0,"channel":"whatsapp","action":"Payment retry link"},{"day":0,"channel":"email","action":"Alternative payment methods"},{"day":1,"channel":"sms","action":"Support contact"}]'),
('Dormant Account Activation',  'Activate registered accounts that never booked',                'Registered Not Booked',               '{email,whatsapp,push}',          'active', '[{"day":0,"channel":"email","action":"Welcome series"},{"day":3,"channel":"whatsapp","action":"Best sellers"},{"day":7,"channel":"push","action":"First booking discount"}]'),
('New Customer Delight',        'Delight new customers and drive second purchase',               'New Customers (0-30 days)',           '{email,whatsapp,sms}',           'active', '[{"day":0,"channel":"email","action":"Booking confirmation + tips"},{"day":3,"channel":"whatsapp","action":"Cross-sell add-ons"},{"day":14,"channel":"email","action":"Second booking offer"}]'),
('Post-Trip Engagement',        'Capture reviews and drive rebooking after travel',              'Post-Trip Review Window',             '{email,whatsapp,push}',          'active', '[{"day":0,"channel":"email","action":"Review request"},{"day":1,"channel":"whatsapp","action":"Photo share request"},{"day":3,"channel":"push","action":"Rebook 15% off"}]'),
('Second Purchase Push',        'Drive one-time buyers to second purchase',                      'One-Time Buyers (31-90 days)',        '{email,whatsapp,sms}',           'active', '[{"day":0,"channel":"email","action":"Personalized recommendations"},{"day":5,"channel":"whatsapp","action":"Similar traveler picks"},{"day":10,"channel":"sms","action":"Loyalty points offer"}]'),
('Loyalty Building',            'Build repeat buyer loyalty and increase frequency',             'Repeat Buyers',                       '{email,whatsapp,push}',          'active', '[{"day":0,"channel":"email","action":"Loyalty program invite"},{"day":3,"channel":"whatsapp","action":"Premium upgrade offer"},{"day":7,"channel":"push","action":"Exclusive early access"}]'),
('VIP Retention',               'Retain frequent travelers with VIP treatment',                  'Frequent Travelers (4+ bookings)',    '{whatsapp,email,sms}',           'active', '[{"day":0,"channel":"whatsapp","action":"VIP concierge welcome"},{"day":3,"channel":"email","action":"Exclusive experiences"},{"day":7,"channel":"sms","action":"Early access new products"}]'),
('High Spender Premium',        'Maximize value of high-spending customers',                     'High Spenders (5000+ AED)',           '{email,whatsapp,sms}',           'active', '[{"day":0,"channel":"email","action":"Premium catalog"},{"day":3,"channel":"whatsapp","action":"Luxury experience invite"},{"day":7,"channel":"sms","action":"Personal travel advisor"}]'),
('Visa-to-Tour Cross-Sell',     'Cross-sell tours to visa-only customers',                       'Visa-Only → Tour Cross-Sell',         '{email,whatsapp,web}',           'active', '[{"day":0,"channel":"email","action":"Tour recommendations by destination"},{"day":3,"channel":"whatsapp","action":"Bundle discount"},{"day":7,"channel":"web","action":"Retarget tours"}]'),
('Tour-to-Visa Cross-Sell',     'Cross-sell visa services to tour-only customers',               'Tour-Only → Visa Cross-Sell',         '{email,whatsapp}',               'active', '[{"day":0,"channel":"email","action":"Visa convenience pitch"},{"day":5,"channel":"whatsapp","action":"Visa + tour bundle offer"}]'),
('Cooling Down Re-engage',      'Light re-engagement for cooling customers',                     'Cooling Down (31-60 days)',            '{email,whatsapp,push}',          'active', '[{"day":0,"channel":"email","action":"Whats new content"},{"day":3,"channel":"push","action":"Trending experiences"},{"day":7,"channel":"whatsapp","action":"Soft reminder"}]'),
('At Risk Win-Back',            'Urgent reactivation for at-risk customers',                     'At Risk (61-120 days)',               '{email,whatsapp,sms}',           'active', '[{"day":0,"channel":"email","action":"We miss you + 15% off"},{"day":2,"channel":"whatsapp","action":"Exclusive comeback deal"},{"day":5,"channel":"sms","action":"Last chance offer"}]'),
('Hibernating Win-Back',        'Strong incentive win-back for hibernating customers',           'Hibernating (121-180 days)',           '{email,whatsapp,sms}',           'active', '[{"day":0,"channel":"email","action":"Deep discount 20% off"},{"day":3,"channel":"whatsapp","action":"New experiences showcase"},{"day":7,"channel":"sms","action":"Final reminder"}]'),
('Lost VIP Recovery',           'Premium win-back for lost high-value customers',                'Lost High-Value (180+ days, 3000+ AED)', '{email,whatsapp,sms}',        'active', '[{"day":0,"channel":"email","action":"Personal letter from team"},{"day":2,"channel":"whatsapp","action":"VIP comeback package"},{"day":5,"channel":"sms","action":"Exclusive invitation"}]'),
('Lost Regular Recovery',       'Standard win-back for lost regular customers',                  'Lost Regular (180+ days, <3000 AED)', '{email,whatsapp}',               'active', '[{"day":0,"channel":"email","action":"Win-back series start"},{"day":3,"channel":"whatsapp","action":"Flash sale alert"},{"day":7,"channel":"email","action":"Budget-friendly picks"}]'),
('Referral Activation',         'Convert happy reviewers into active referrers',                 'Happy Reviewers (4-5 Stars)',          '{email,whatsapp}',               'active', '[{"day":0,"channel":"email","action":"Referral program invite"},{"day":3,"channel":"whatsapp","action":"Share review for reward"}]'),
('Social Amplification',        'Amplify social media advocates reach',                          'Social Media Advocates',              '{email,whatsapp}',               'active', '[{"day":0,"channel":"email","action":"UGC feature request"},{"day":3,"channel":"whatsapp","action":"Ambassador program invite"}]'),
('NPS Promoter Activation',     'Activate NPS promoters for organic growth',                     'NPS Promoters',                       '{email,whatsapp}',               'active', '[{"day":0,"channel":"email","action":"Referral enrollment"},{"day":3,"channel":"whatsapp","action":"Google review request"}]'),
('Corporate Growth',            'Grow B2B and corporate partnerships',                           'B2B & Corporate',                     '{email,whatsapp}',               'active', '[{"day":0,"channel":"email","action":"Corporate packages catalog"},{"day":5,"channel":"whatsapp","action":"Account manager intro"}]'),
('Birthday Celebration',        'Drive occasion-based purchases for birthday month',             'Birthday Month',                      '{email,whatsapp,sms}',           'active', '[{"day":0,"channel":"email","action":"Birthday greeting + 25% off"},{"day":3,"channel":"whatsapp","action":"Birthday experience package"},{"day":7,"channel":"sms","action":"Birthday reminder"}]'),
('Cancellation Prevention',     'Reduce cancellations with flexible options',                    'High Cancellation Risk',              '{email,whatsapp}',               'active', '[{"day":0,"channel":"email","action":"Flexible booking options"},{"day":3,"channel":"whatsapp","action":"Free cancellation highlight"}]');


-- ══════════════════════════════════════════════════════════════
-- STEP 7: Content Templates (2 per segment = 56 templates)
-- One WhatsApp + One Email per segment
-- ══════════════════════════════════════════════════════════════

-- Helper: get segment labels for templates
INSERT INTO content_templates (name, channel, status, subject, body, segment_label, cta_text, cta_url) VALUES
-- Seg 1
('Social Lead WA Welcome','whatsapp','approved',NULL,'Hi {{first_name}}! 👋 Thanks for checking out Rayna Tours. Ready to explore Dubai? Here are our top experiences: 🏜️ Desert Safari, 🚢 Dhow Cruise, 🏙️ City Tour. Reply YES for a personalized recommendation!','Social Ad Leads','Explore Now','https://rayna.com?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=social_lead_welcome'),
('Social Lead Email Welcome','email','approved','Discover Dubai with Rayna Tours ✈️','Hi {{first_name}},\n\nWe noticed you were exploring Dubai experiences. Here are our most popular tours:\n\n• Desert Safari Premium - from AED 199\n• Marina Dhow Cruise - from AED 149\n• Abu Dhabi City Tour - from AED 189\n\nBook now and get 5% off your first experience!\n\nBest,\nRayna Tours Team','Social Ad Leads','Book Now','https://rayna.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=social_lead_welcome'),
-- Seg 2
('Browser Retarget WA','whatsapp','approved',NULL,'Hi there! 👋 We saw you browsing some amazing Dubai experiences. Need help picking the perfect one? Our travel experts are here to help! Reply for recommendations.','Website Browsers','Get Help','https://rayna.com?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=browser_retarget'),
('Browser Retarget Email','email','approved','Still thinking about Dubai? 🌟','Hi {{first_name}},\n\nWe noticed you were checking out some incredible Dubai experiences. Don''t miss out!\n\n🔥 Trending now:\n• Desert Safari with BBQ dinner\n• Burj Khalifa tickets\n• Dubai Marina cruise\n\nRegister now for exclusive deals!\n\nRayna Tours','Website Browsers','Register Now','https://rayna.com/register?utm_source=AI_marketer&utm_medium=email&utm_campaign=browser_retarget'),
-- Seg 3
('WA Lead Follow-up','whatsapp','approved',NULL,'Hi {{first_name}}! Thanks for reaching out on WhatsApp. I''d love to help you plan your Dubai adventure. What kind of experiences interest you? 🏜️ Adventure | 🌊 Water | 🏙️ City | 🎢 Theme Parks','WhatsApp First-Touch','Tell Me More','https://rayna.com?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=wa_lead_nurture'),
('WA Lead Email Capture','email','approved','Your Dubai Adventure Starts Here','Hi {{first_name}},\n\nGreat to connect with you! As a WhatsApp contact, here''s an exclusive 5% welcome discount.\n\nUse code: WELCOME5\n\nBrowse our top experiences and book directly!\n\nRayna Tours','WhatsApp First-Touch','Browse Tours','https://rayna.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=wa_lead_nurture'),
-- Seg 4
('Cart Recovery WA Urgent','whatsapp','approved',NULL,'Hi {{first_name}}! 🛒 You left something in your cart! Your Desert Safari booking is waiting. Complete it now before spots fill up. Need help? Reply here!','Fresh Cart Abandoners (0-3 days)','Complete Booking','https://rayna.com/cart?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=cart_recovery_urgent'),
('Cart Recovery Email Urgent','email','approved','Your cart is waiting! Don''t miss out 🛒','Hi {{first_name}},\n\nYou were so close to booking an amazing experience!\n\nYour cart items are still saved. Complete your booking now.\n\n⏰ Limited availability - book today!\n\nUse code CART20 for an extra discount.\n\nRayna Tours','Fresh Cart Abandoners (0-3 days)','Complete Booking','https://rayna.com/cart?utm_source=AI_marketer&utm_medium=email&utm_campaign=cart_recovery_urgent'),
-- Seg 5
('Cart Recovery WA Extended','whatsapp','approved',NULL,'Hi {{first_name}}! We saved your cart from last week. Prices may change soon — lock in your rate now! Plus, use code CART20 for a special discount. 🎉','Stale Cart Abandoners (4-14 days)','Get Discount','https://rayna.com/cart?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=cart_recovery_extended'),
('Cart Recovery Email Extended','email','approved','Still interested? Here''s a special offer 🎁','Hi {{first_name}},\n\nWe noticed you haven''t completed your booking from last week.\n\nGood news — we''ve got a special offer for you:\n\n🎫 Use code CART20 for an exclusive discount\n📋 Plus, check out these alternatives you might love\n\nDon''t wait too long — prices may increase!\n\nRayna Tours','Stale Cart Abandoners (4-14 days)','Shop Now','https://rayna.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=cart_recovery_extended'),
-- Seg 6
('Enquiry Follow-up WA','whatsapp','approved',NULL,'Hi {{first_name}}! Following up on your recent enquiry. I''ve put together some personalized options for you. Would you like to see them? Our team is ready to help you book the perfect experience!','Active Enquirers','View Options','https://rayna.com?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=enquiry_followup'),
('Enquiry Follow-up Email','email','approved','Your personalized Dubai recommendations 🌟','Hi {{first_name}},\n\nThanks for your enquiry! Based on your interests, here are our top picks:\n\n✅ Free cancellation on all tours\n✅ Best price guarantee\n✅ 24/7 customer support\n\nUse code RAYNOW for 10% off your first booking!\n\nRayna Tours','Active Enquirers','Book Now','https://rayna.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=enquiry_followup'),
-- Seg 7
('Hesitant Browser WA','whatsapp','approved',NULL,'Hi {{first_name}}! 🔍 We see you''ve been exploring our tours. Can''t decide? Here are our top 3 best-sellers this week. Reply DEALS for exclusive prices!','Hesitant Browsers','See Deals','https://rayna.com?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=hesitant_browser'),
('Hesitant Browser Email','email','approved','Price drop on tours you viewed! 📉','Hi {{first_name}},\n\nGreat news! Some experiences you viewed have special pricing:\n\n🏜️ Desert Safari — NOW from AED 179\n🚢 Dhow Cruise — NOW from AED 129\n\n⏰ Limited time only. Book before prices go back up!\n\nRayna Tours','Hesitant Browsers','Grab the Deal','https://rayna.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=hesitant_browser'),
-- Seg 8
('Payment Help WA','whatsapp','approved',NULL,'Hi {{first_name}}! We noticed your payment didn''t go through. No worries — we can help! Try again here or reply for alternative payment options. We accept cards, Apple Pay, and bank transfer.','Payment Failed','Retry Payment','https://rayna.com/checkout?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=payment_recovery'),
('Payment Help Email','email','approved','Need help completing your booking? 💳','Hi {{first_name}},\n\nWe noticed your payment didn''t complete. Don''t worry — your booking is saved!\n\n💳 Alternative payment options available:\n• Credit/Debit Card\n• Apple Pay / Google Pay\n• Bank Transfer\n\nClick below to try again or contact our support team.\n\nRayna Tours','Payment Failed','Complete Payment','https://rayna.com/checkout?utm_source=AI_marketer&utm_medium=email&utm_campaign=payment_recovery'),
-- Seg 9
('Dormant Account WA','whatsapp','approved',NULL,'Hi {{first_name}}! 👋 Welcome to Rayna Tours! You signed up but haven''t explored yet. Here''s what''s trending: 🏜️ Desert Safari 🚢 Cruises 🏙️ City Tours. Use code WELCOME5 for 5% off!','Registered Not Booked','Explore Now','https://rayna.com?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=dormant_activation'),
('Dormant Account Email','email','approved','Welcome to Rayna! Here''s your starter guide ✈️','Hi {{first_name}},\n\nWelcome to Rayna Tours! We''re excited to have you.\n\nNot sure where to start? Here are our most-loved experiences:\n\n⭐ Desert Safari with BBQ — 4.8★ (2,340 reviews)\n⭐ Burj Khalifa At The Top — 4.9★ (1,890 reviews)\n⭐ Abu Dhabi Day Trip — 4.7★ (1,560 reviews)\n\n🎁 Use code WELCOME5 for 5% off your first booking!\n\nRayna Tours','Registered Not Booked','Start Exploring','https://rayna.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=dormant_activation'),
-- Seg 10
('New Customer WA','whatsapp','approved',NULL,'Hi {{first_name}}! 🎉 Thanks for booking with Rayna! Ready for your next adventure? Check out experiences that go perfectly with your upcoming trip. Use RAYNOW for 10% off!','New Customers (0-30 days)','Add to Trip','https://rayna.com?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=new_customer_crosssell'),
('New Customer Email','email','approved','Make your trip even better! ✨','Hi {{first_name}},\n\nThanks for choosing Rayna Tours! Here are some add-ons that pair perfectly with your booking:\n\n🎯 Popular add-ons for your trip:\n• Airport transfers\n• Dubai Frame tickets\n• Evening desert experience\n\nUse code RAYNOW for 10% off!\n\nHappy travels,\nRayna Tours','New Customers (0-30 days)','Browse Add-ons','https://rayna.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=new_customer_crosssell'),
-- Seg 11
('Post-Trip Review WA','whatsapp','approved',NULL,'Hi {{first_name}}! 🌟 How was your experience? We''d love your feedback! Leave a review and get 15% off your next booking. Your opinion helps fellow travelers!','Post-Trip Review Window','Leave Review','https://rayna.com/review?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=post_trip_review'),
('Post-Trip Review Email','email','approved','How was your trip? 🌟 We''d love to hear!','Hi {{first_name}},\n\nWe hope you had an amazing experience!\n\n⭐ Share your review and get 15% off your next booking!\n\nYour feedback helps us improve and helps other travelers choose their perfect experience.\n\nThank you for traveling with Rayna!\n\nRayna Tours','Post-Trip Review Window','Write Review','https://rayna.com/review?utm_source=AI_marketer&utm_medium=email&utm_campaign=post_trip_review'),
-- Seg 12
('One-Time Buyer WA','whatsapp','approved',NULL,'Hi {{first_name}}! It''s been a while since your last adventure. 🏜️ We''ve added exciting new experiences! Come back and explore — use RAYNOW for 10% off your next booking!','One-Time Buyers (31-90 days)','See What''s New','https://rayna.com?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=second_purchase_push'),
('One-Time Buyer Email','email','approved','Time for your next adventure? 🗺️','Hi {{first_name}},\n\nBased on your last booking, we think you''ll love these:\n\n🎯 Recommended for you:\n• Similar experiences in new locations\n• Premium upgrades available\n• Combo deals for more savings\n\nUse code RAYNOW for 10% off!\n\nRayna Tours','One-Time Buyers (31-90 days)','Explore Now','https://rayna.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=second_purchase_push'),
-- Seg 13
('Repeat Buyer WA','whatsapp','approved',NULL,'Hi {{first_name}}! 🌟 As a valued repeat customer, you''re invited to join our VIP loyalty program! Earn points on every booking and unlock exclusive perks. Reply JOIN to get started!','Repeat Buyers','Join VIP','https://rayna.com/loyalty?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=loyalty_building'),
('Repeat Buyer Email','email','approved','You''re VIP material! Join our loyalty program 👑','Hi {{first_name}},\n\nWith {{total_bookings}} bookings, you''re one of our most valued customers!\n\n👑 Join our VIP program and get:\n• 2x points on every booking\n• Early access to new experiences\n• Exclusive member-only deals\n• Priority customer support\n\nUse code VIPEXTRA for an extra bonus!\n\nRayna Tours','Repeat Buyers','Join Now','https://rayna.com/loyalty?utm_source=AI_marketer&utm_medium=email&utm_campaign=loyalty_building'),
-- Seg 14
('VIP Traveler WA','whatsapp','approved',NULL,'Hi {{first_name}}! 👑 As a VIP traveler, you get first access to our newest luxury experiences: Private yacht tours, helicopter rides, and exclusive desert camps. Reply VIP for details!','Frequent Travelers (4+ bookings)','VIP Access','https://rayna.com/vip?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=vip_retention'),
('VIP Traveler Email','email','approved','Exclusive VIP experiences just for you 👑','Hi {{first_name}},\n\nAs one of our most frequent travelers, you deserve the best:\n\n🛥️ Private Yacht Experience — VIP exclusive\n🚁 Helicopter Tour — Priority booking\n🏕️ Luxury Desert Camp — Members only\n\nYour personal travel advisor is available 24/7.\n\nUse code VIPEXTRA for your VIP discount!\n\nRayna Tours','Frequent Travelers (4+ bookings)','View VIP Tours','https://rayna.com/vip?utm_source=AI_marketer&utm_medium=email&utm_campaign=vip_retention'),
-- Seg 15
('High Spender WA','whatsapp','approved',NULL,'Hi {{first_name}}! 💎 Exclusive for our premium members: Private luxury experiences curated just for you. Yacht tours, helicopter rides, premium desert camps. Reply LUXURY for your personal catalog.','High Spenders (5000+ AED)','View Luxury','https://rayna.com/premium?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=high_spender_upsell'),
('High Spender Email','email','approved','Your premium experience catalog 💎','Hi {{first_name}},\n\nAs a premium Rayna customer, we''ve curated exclusive experiences:\n\n💎 Luxury Collection:\n• Private yacht sunset cruise — AED 2,500\n• Helicopter tour of Dubai — AED 1,800\n• Exclusive desert luxury camp — AED 3,500\n\nYour dedicated travel advisor awaits.\n\nRayna Tours Premium','High Spenders (5000+ AED)','Explore Premium','https://rayna.com/premium?utm_source=AI_marketer&utm_medium=email&utm_campaign=high_spender_upsell'),
-- Seg 16
('Visa Cross-Sell WA','whatsapp','approved',NULL,'Hi {{first_name}}! ✈️ Your visa is sorted — now make the most of your trip! Check out top tours and activities at your destination. Bundle visa + tour for extra savings!','Visa-Only → Tour Cross-Sell','Browse Tours','https://rayna.com/tours?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=visa_to_tour'),
('Visa Cross-Sell Email','email','approved','Your visa is done! Now plan the fun part ✈️','Hi {{first_name}},\n\nYour visa service is complete — now let''s make your trip unforgettable!\n\n🎯 Top experiences at your destination:\n• Desert Safari with BBQ dinner\n• City sightseeing tours\n• Water sports & cruises\n\n🎁 Bundle visa + tour and save 10%!\n\nRayna Tours','Visa-Only → Tour Cross-Sell','Plan Your Trip','https://rayna.com/tours?utm_source=AI_marketer&utm_medium=email&utm_campaign=visa_to_tour'),
-- Seg 17
('Tour-Visa Cross-Sell WA','whatsapp','approved',NULL,'Hi {{first_name}}! 📋 Need a visa for your next adventure? We handle the paperwork so you can focus on the fun! Fast processing, hassle-free. Reply VISA for details.','Tour-Only → Visa Cross-Sell','Get Visa','https://rayna.com/visa?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=tour_to_visa'),
('Tour-Visa Cross-Sell Email','email','approved','Make travel easier — add visa service! 📋','Hi {{first_name}},\n\nLoved your last tour? Make your next trip even smoother:\n\n📋 Rayna Visa Services:\n• Fast processing (3-5 days)\n• All paperwork handled\n• Bundle with tour for 10% off\n\nOne-stop shop for tours + visas!\n\nRayna Tours','Tour-Only → Visa Cross-Sell','Add Visa Service','https://rayna.com/visa?utm_source=AI_marketer&utm_medium=email&utm_campaign=tour_to_visa'),
-- Seg 18
('Cooling Down WA','whatsapp','approved',NULL,'Hi {{first_name}}! 🌟 It''s been a few weeks — we''ve added some exciting new experiences! Check out what''s trending in Dubai this season. Your next adventure awaits!','Cooling Down (31-60 days)','See What''s New','https://rayna.com/new?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=cooling_reengage'),
('Cooling Down Email','email','approved','What''s new at Rayna Tours! 🆕','Hi {{first_name}},\n\nIt''s been a little while! Here''s what''s new since your last visit:\n\n🆕 New experiences added\n🔥 Trending this season\n⭐ Top-rated by travelers like you\n\nCome see what you''ve been missing!\n\nRayna Tours','Cooling Down (31-60 days)','Explore New','https://rayna.com/new?utm_source=AI_marketer&utm_medium=email&utm_campaign=cooling_reengage'),
-- Seg 19
('At Risk WA','whatsapp','approved',NULL,'Hi {{first_name}}! 💝 We miss you! It''s been a while since your last adventure. Come back with an exclusive 15% discount — just for you! Use code WINBACK15. Limited time!','At Risk (61-120 days)','Come Back','https://rayna.com?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=atrisk_winback'),
('At Risk Email','email','approved','We miss you! Here''s 15% off 💝','Hi {{first_name}},\n\nIt''s been a while and we miss having you!\n\n🎁 Exclusive comeback offer: 15% OFF\nUse code: WINBACK15\n\nWe''ve added amazing new experiences since your last visit. Come see what''s new!\n\n⏰ Offer expires in 7 days.\n\nRayna Tours','At Risk (61-120 days)','Claim Offer','https://rayna.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=atrisk_winback'),
-- Seg 20
('Hibernating WA','whatsapp','approved',NULL,'Hi {{first_name}}! 🎁 It''s been too long! We have a special 20% comeback deal waiting for you. New experiences, better prices, same amazing service. Ready to explore again?','Hibernating (121-180 days)','Get 20% Off','https://rayna.com?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=hibernate_winback'),
('Hibernating Email','email','approved','Come back to 20% OFF everything! 🎁','Hi {{first_name}},\n\nWe haven''t seen you in a while, and we want you back!\n\n🎁 SPECIAL OFFER: 20% OFF your next booking\nUse code: WINBACK15\n\nLot has changed since you last visited:\n• 50+ new experiences added\n• Better prices guaranteed\n• Improved booking experience\n\nYour next adventure is waiting!\n\nRayna Tours','Hibernating (121-180 days)','Explore Now','https://rayna.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=hibernate_winback'),
-- Seg 21
('Lost VIP WA','whatsapp','approved',NULL,'Hi {{first_name}}! 💎 As one of our most valued past customers, we''d love to welcome you back with an exclusive VIP comeback package. Premium experiences at special prices — just say the word!','Lost High-Value (180+ days, 3000+ AED)','VIP Comeback','https://rayna.com/vip?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=lost_vip_winback'),
('Lost VIP Email','email','approved','A personal invitation to come back 💎','Dear {{first_name}},\n\nAs one of our most valued customers, we truly miss you.\n\n💎 Your exclusive VIP comeback package:\n• 20% off all premium experiences\n• Complimentary upgrade on first booking\n• Dedicated travel advisor assigned\n• Priority customer support\n\nThis is a personal invitation — we''d love to have you back.\n\nWarm regards,\nRayna Tours Senior Team','Lost High-Value (180+ days, 3000+ AED)','Accept Invitation','https://rayna.com/vip?utm_source=AI_marketer&utm_medium=email&utm_campaign=lost_vip_winback'),
-- Seg 22
('Lost Regular WA','whatsapp','approved',NULL,'Hi {{first_name}}! 👋 It''s been a while! We''ve got great new experiences at amazing prices. Use code WINBACK15 for 15% off. Come back and explore Dubai again!','Lost Regular (180+ days, <3000 AED)','See Deals','https://rayna.com?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=lost_regular_winback'),
('Lost Regular Email','email','approved','We want you back! 15% off inside 🎫','Hi {{first_name}},\n\nLong time no see! We''ve been busy adding amazing new experiences:\n\n🎫 Use code WINBACK15 for 15% off\n\n🔥 Budget-friendly picks:\n• Desert Safari from AED 149\n• Dhow Cruise from AED 99\n• City Tour from AED 129\n\nCome back and explore!\n\nRayna Tours','Lost Regular (180+ days, <3000 AED)','Browse Deals','https://rayna.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=lost_regular_winback'),
-- Seg 23
('Reviewer Referral WA','whatsapp','approved',NULL,'Hi {{first_name}}! ⭐ Thanks for your amazing review! Share the love — refer a friend and you both get AED 50 off. Use your personal referral link!','Happy Reviewers (4-5 Stars)','Refer a Friend','https://rayna.com/referral?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=reviewer_referral'),
('Reviewer Referral Email','email','approved','Share the love — earn rewards! ⭐','Hi {{first_name}},\n\nThank you for your wonderful review! Your feedback means the world to us.\n\n🎁 Refer a friend program:\n• You get AED 50 credit\n• Your friend gets AED 50 off\n• No limit on referrals!\n\nUse code REFER10 for an extra 10% off your next booking.\n\nRayna Tours','Happy Reviewers (4-5 Stars)','Start Referring','https://rayna.com/referral?utm_source=AI_marketer&utm_medium=email&utm_campaign=reviewer_referral'),
-- Seg 24
('Social Advocate WA','whatsapp','approved',NULL,'Hi {{first_name}}! 📸 We loved your social media posts about Rayna! Want to join our Brand Ambassador program? Get free experiences, exclusive events, and special rewards!','Social Media Advocates','Join Program','https://rayna.com/ambassador?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=social_ambassador'),
('Social Advocate Email','email','approved','Join our Brand Ambassador program! 📸','Hi {{first_name}},\n\nWe''ve noticed your amazing social media posts — thank you!\n\n🌟 Brand Ambassador perks:\n• Free experiences to review\n• Exclusive event invitations\n• Special ambassador discount code\n• Featured on our channels\n\nInterested? We''d love to have you!\n\nRayna Tours','Social Media Advocates','Apply Now','https://rayna.com/ambassador?utm_source=AI_marketer&utm_medium=email&utm_campaign=social_ambassador'),
-- Seg 25
('NPS Promoter WA','whatsapp','approved',NULL,'Hi {{first_name}}! 🙏 Thank you for being a Rayna promoter! Share your experience on Google/TripAdvisor and earn AED 100 credit. Plus, refer friends for bonus rewards!','NPS Promoters','Write Review','https://rayna.com/review?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=nps_activation'),
('NPS Promoter Email','email','approved','Your voice matters! Share and earn 🙏','Hi {{first_name}},\n\nThank you for rating us so highly!\n\n🎁 Share your experience and earn:\n• Google review → AED 50 credit\n• TripAdvisor review → AED 50 credit\n• Refer a friend → AED 50 for both\n\nUse code REFER10 for 10% off your next booking!\n\nRayna Tours','NPS Promoters','Share Now','https://rayna.com/review?utm_source=AI_marketer&utm_medium=email&utm_campaign=nps_activation'),
-- Seg 26
('B2B Corporate WA','whatsapp','approved',NULL,'Hello! 🏢 Rayna Tours offers tailored corporate packages: team building, client entertainment, group tours, and event management. Contact your dedicated account manager for a custom quote!','B2B & Corporate','Get Quote','https://rayna.com/corporate?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=b2b_growth'),
('B2B Corporate Email','email','approved','Corporate & Group Solutions by Rayna 🏢','Dear {{first_name}},\n\n Rayna Tours Corporate Solutions:\n\n🏢 What we offer:\n• Corporate team building events\n• Client entertainment packages\n• Group tours (10-500 pax)\n• Custom event management\n• Volume-based pricing\n\n📞 Your dedicated account manager is ready.\nUse code CORPORATE10 for 10% off corporate bookings.\n\nRayna Tours Business','B2B & Corporate','Request Quote','https://rayna.com/corporate?utm_source=AI_marketer&utm_medium=email&utm_campaign=b2b_growth'),
-- Seg 27
('Birthday WA','whatsapp','approved',NULL,'Happy Birthday {{first_name}}! 🎂 Celebrate with a special experience — 25% OFF any tour or activity this month! Use code BIRTHDAY25. Treat yourself!','Birthday Month','Celebrate Now','https://rayna.com?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=birthday_offer'),
('Birthday Email','email','approved','Happy Birthday! 🎂 25% OFF just for you!','Happy Birthday {{first_name}}! 🎂\n\nTo celebrate your special month, here''s an exclusive gift:\n\n🎁 25% OFF any experience!\nUse code: BIRTHDAY25\n\nTreat yourself to something amazing:\n• Luxury yacht cruise\n• Helicopter ride over Dubai\n• Premium desert experience\n\nValid all month. Enjoy your celebration!\n\nRayna Tours','Birthday Month','Claim Gift','https://rayna.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=birthday_offer'),
-- Seg 28
('Cancel Risk WA','whatsapp','approved',NULL,'Hi {{first_name}}! 📋 Good news — all our experiences now come with FREE cancellation up to 24h before. Book with confidence! Need flexible options? Reply here.','High Cancellation Risk','Book Flexibly','https://rayna.com?utm_source=AI_marketer&utm_medium=whatsapp&utm_campaign=cancel_prevention'),
('Cancel Risk Email','email','approved','Book with confidence — Free cancellation! 📋','Hi {{first_name}},\n\nWe want you to book worry-free:\n\n✅ FREE cancellation up to 24h before\n✅ Easy rebooking at no extra cost\n✅ Full refund guarantee\n✅ Date change flexibility\n\nExplore with confidence — we''ve got you covered.\n\nRayna Tours','High Cancellation Risk','Browse Tours','https://rayna.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=cancel_prevention');


-- ══════════════════════════════════════════════════════════════
-- STEP 8: Campaigns (1 per segment = 28 campaigns)
-- ══════════════════════════════════════════════════════════════
INSERT INTO campaigns (name, segment_label, channel, status, target_count)
SELECT
  s.segment_name || ' — ' || CASE WHEN t.channel = 'whatsapp' THEN 'WA' ELSE 'Email' END || ' Campaign',
  t.segment_label,
  t.channel,
  'draft',
  0
FROM content_templates t
JOIN segment_definitions s ON s.segment_name = t.segment_label
WHERE t.channel IN ('whatsapp','email')
AND t.id IN (SELECT MIN(id) FROM content_templates GROUP BY segment_label, channel);


COMMIT;
