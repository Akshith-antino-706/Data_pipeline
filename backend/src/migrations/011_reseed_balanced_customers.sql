-- ═══════════════════════════════════════════════════════════════════
-- Migration 011: RESEED CUSTOMERS WITH BALANCED DISTRIBUTION
-- Ensures all 28 segments have realistic, meaningful customer counts
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

-- Clean out old assignments
DELETE FROM segment_customers;
DELETE FROM coupon_usage;
DELETE FROM gtm_events;

-- Reset customers table
TRUNCATE customers CASCADE;

-- Reset sequence
ALTER SEQUENCE customers_customer_id_seq RESTART WITH 1;

-- ══════════════════════════════════════════════════════════════
-- Helper: Generate realistic names and data
-- ══════════════════════════════════════════════════════════════

-- We'll create customers in batches, each targeting specific segments
-- Total target: ~5000 customers with good distribution

-- ─────────────────────────────────────────────────────────────
-- STAGE 1: COLD LEADS B2C (Segments 1-2) — ~400 customers
-- ─────────────────────────────────────────────────────────────

-- Seg 1: Meta Ads → WhatsApp Direct (200 customers)
-- Criteria: lead_source = 'Meta Ads' AND whatsapp_enquiry_date IS NOT NULL AND registration_date IS NULL AND first_booking_date IS NULL
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  lead_source, whatsapp_enquiry_date, registration_date, first_booking_date,
  total_bookings, total_revenue, whatsapp_opt_in, email_opt_in, sms_opt_in,
  website_sessions_total, product_views_count, residence_country, residence_city
)
SELECT
  'Lead' || n, 'Meta' || (n % 50),
  'lead.meta' || n || '@gmail.com',
  '+971' || (500000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','Pakistan','UK','UAE','Philippines','Egypt','Bangladesh'])[1 + n % 7],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  'Meta Ads',
  NOW() - (n % 14 || ' days')::INTERVAL,
  NULL, -- no registration
  NULL, -- no booking
  0, 0,
  true, false, false,
  0, 0,
  (ARRAY['UAE','India','UK','Saudi Arabia'])[1 + n % 4],
  (ARRAY['Dubai','Abu Dhabi','Sharjah','Mumbai','London'])[1 + n % 5]
FROM generate_series(1, 200) AS n;

-- Seg 2: Website Browsers No Registration (200 customers)
-- Criteria: website_sessions_total >= 1 AND registration_date IS NULL AND last_enquiry_date IS NULL AND first_booking_date IS NULL
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  website_sessions_total, product_views_count, registration_date, last_enquiry_date, first_booking_date,
  total_bookings, total_revenue, whatsapp_opt_in, email_opt_in, residence_country, residence_city
)
SELECT
  'Browser' || n, 'Web' || (n % 40),
  'browser' || n || '@gmail.com',
  '+971' || (510000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','UK','Germany','USA','Russia','China','France'])[1 + n % 7],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  1 + (n % 8), -- 1-8 sessions
  n % 5, -- 0-4 views
  NULL, NULL, NULL,
  0, 0,
  false, false,
  (ARRAY['UAE','India','UK','USA','Germany'])[1 + n % 5],
  (ARRAY['Dubai','Abu Dhabi','London','New York','Berlin'])[1 + n % 5]
FROM generate_series(1, 200) AS n;


-- ─────────────────────────────────────────────────────────────
-- STAGE 2: WARM LEADS B2C (Segments 3-8) — ~1200 customers
-- ─────────────────────────────────────────────────────────────

-- Seg 3: Recent Cart Abandoners 0-3 days (180 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, last_abandoned_cart_date, first_booking_date,
  total_bookings, total_revenue, product_views_count, enquiry_count,
  whatsapp_opt_in, email_opt_in, sms_opt_in, residence_country, residence_city,
  website_sessions_total
)
SELECT
  'Cart' || n, 'Abandon' || (n % 30),
  'cart.abandon' || n || '@gmail.com',
  '+971' || (520000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','UK','Germany','UAE','Russia','China'])[1 + n % 6],
  CASE WHEN n % 3 = 0 THEN 'female' ELSE 'male' END,
  NOW() - ((10 + n % 60) || ' days')::INTERVAL,
  NOW() - (n % 3 || ' days')::INTERVAL, -- 0-2 days ago
  NULL,
  0, 0, 3 + n % 5, 1 + n % 2,
  true, true, n % 3 = 0,
  (ARRAY['UAE','India','UK','Saudi Arabia','Egypt'])[1 + n % 5],
  (ARRAY['Dubai','Abu Dhabi','Sharjah','Mumbai','London'])[1 + n % 5],
  2 + n % 6
FROM generate_series(1, 180) AS n;

-- Seg 4: Enquired Never Booked 0-7 days (200 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, last_enquiry_date, enquiry_count, first_booking_date,
  total_bookings, total_revenue, product_views_count,
  whatsapp_opt_in, email_opt_in, sms_opt_in, residence_country, residence_city,
  website_sessions_total
)
SELECT
  'Enquiry' || n, 'Fresh' || (n % 40),
  'enquiry.fresh' || n || '@gmail.com',
  '+971' || (530000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','Pakistan','UK','UAE','Philippines','Egypt'])[1 + n % 6],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((5 + n % 30) || ' days')::INTERVAL,
  NOW() - (n % 7 || ' days')::INTERVAL, -- 0-6 days ago
  1 + n % 2,
  NULL,
  0, 0, 2 + n % 4,
  true, true, n % 2 = 0,
  (ARRAY['UAE','India','UK','Saudi Arabia'])[1 + n % 4],
  (ARRAY['Dubai','Abu Dhabi','Sharjah','Ajman'])[1 + n % 4],
  1 + n % 5
FROM generate_series(1, 200) AS n;

-- Seg 5: Price Watchers Repeated Views (200 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, product_views_count, first_booking_date,
  total_bookings, total_revenue, enquiry_count,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city,
  website_sessions_total
)
SELECT
  'Watcher' || n, 'Price' || (n % 35),
  'price.watcher' || n || '@gmail.com',
  '+971' || (540000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','UK','Germany','USA','Russia','Australia'])[1 + n % 6],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((15 + n % 60) || ' days')::INTERVAL,
  3 + n % 10, -- 3-12 views (>=3 required)
  NULL,
  0, 0, n % 3,
  n % 2 = 0, true,
  (ARRAY['UAE','India','UK','Germany','USA'])[1 + n % 5],
  (ARRAY['Dubai','Mumbai','London','Berlin','New York'])[1 + n % 5],
  3 + n % 8
FROM generate_series(1, 200) AS n;

-- Seg 6: Multiple Enquiries Zero Bookings (150 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, last_enquiry_date, enquiry_count, first_booking_date,
  total_bookings, total_revenue, product_views_count,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city,
  website_sessions_total
)
SELECT
  'MultiEnq' || n, 'Warm' || (n % 30),
  'multi.enquiry' || n || '@gmail.com',
  '+971' || (550000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','Pakistan','Bangladesh','UAE','Philippines'])[1 + n % 5],
  CASE WHEN n % 3 = 0 THEN 'female' ELSE 'male' END,
  NOW() - ((20 + n % 90) || ' days')::INTERVAL,
  NOW() - ((8 + n % 30) || ' days')::INTERVAL,
  3 + n % 5, -- 3-7 enquiries (>=3 required)
  NULL,
  0, 0, 2 + n % 6,
  true, true,
  (ARRAY['UAE','India','Pakistan','Philippines'])[1 + n % 4],
  (ARRAY['Dubai','Abu Dhabi','Sharjah','Karachi'])[1 + n % 4],
  2 + n % 5
FROM generate_series(1, 150) AS n;

-- Seg 7: Booking Started Payment Failed (120 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, payment_failed, first_booking_date,
  total_bookings, total_revenue, product_views_count, enquiry_count,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city,
  website_sessions_total, last_abandoned_cart_date
)
SELECT
  'PayFail' || n, 'User' || (n % 25),
  'payfail' || n || '@gmail.com',
  '+971' || (560000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','UK','UAE','Pakistan','Russia'])[1 + n % 5],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((10 + n % 45) || ' days')::INTERVAL,
  true,
  NULL,
  0, 0, 4 + n % 6, 1 + n % 3,
  true, true,
  (ARRAY['UAE','India','UK','Russia'])[1 + n % 4],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','Moscow'])[1 + n % 4],
  3 + n % 5,
  NOW() - ((1 + n % 10) || ' days')::INTERVAL
FROM generate_series(1, 120) AS n;

-- Seg 8: Registered Never Engaged 7-30 days (250 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, last_enquiry_date, first_booking_date,
  total_bookings, total_revenue, product_views_count, enquiry_count,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city,
  website_sessions_total
)
SELECT
  'Idle' || n, 'Reg' || (n % 50),
  'idle.reg' || n || '@gmail.com',
  '+971' || (570000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','UK','Germany','USA','UAE','China','France','Australia'])[1 + n % 8],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((7 + n % 23) || ' days')::INTERVAL, -- 7-29 days ago
  NULL, -- no enquiry
  NULL,
  0, 0, 0, 0,
  false, true,
  (ARRAY['UAE','India','UK','USA','Germany','France'])[1 + n % 6],
  (ARRAY['Dubai','Mumbai','London','New York','Berlin','Paris'])[1 + n % 6],
  0
FROM generate_series(1, 250) AS n;


-- ─────────────────────────────────────────────────────────────
-- STAGE 3: EXISTING CUSTOMERS REACTIVATION (Seg 9-10) — ~400
-- ─────────────────────────────────────────────────────────────

-- Seg 9: High-Value Dormant 6+ months (150 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, preferred_products,
  whatsapp_opt_in, email_opt_in, sms_opt_in, residence_country, residence_city,
  website_sessions_total, product_views_count
)
SELECT
  'Dormant' || n, 'VIP' || (n % 30),
  'dormant.vip' || n || '@gmail.com',
  '+971' || (580000000 + n)::TEXT,
  'B2C',
  (ARRAY['UAE','UK','Germany','USA','India','Russia'])[1 + n % 6],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((365 + n % 200) || ' days')::INTERVAL,
  NOW() - ((300 + n % 200) || ' days')::INTERVAL,
  2 + n % 5, -- 2-6 bookings
  5000 + (n % 20) * 500, -- 5000-14500 AED (>=5000 required)
  180 + n % 200, -- 180-379 days (>=180 required)
  ARRAY['Desert Safari', 'Cruise'],
  true, true, n % 2 = 0,
  (ARRAY['UAE','UK','Germany','USA'])[1 + n % 4],
  (ARRAY['Dubai','London','Berlin','New York'])[1 + n % 4],
  5 + n % 10, 3 + n % 8
FROM generate_series(1, 150) AS n;

-- Seg 10: One-Time Bookers 90+ days ago (250 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking,
  whatsapp_opt_in, email_opt_in, sms_opt_in, residence_country, residence_city,
  website_sessions_total, product_views_count
)
SELECT
  'OneTime' || n, 'Booker' || (n % 50),
  'onetime' || n || '@gmail.com',
  '+971' || (590000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','UK','UAE','Pakistan','Philippines','Egypt','Russia'])[1 + n % 7],
  CASE WHEN n % 3 = 0 THEN 'female' ELSE 'male' END,
  NOW() - ((120 + n % 200) || ' days')::INTERVAL,
  NOW() - ((100 + n % 180) || ' days')::INTERVAL,
  1, -- exactly 1 booking
  300 + n % 2000, -- 300-2299 AED
  90 + n % 200, -- 90-289 days (>=90 required)
  true, true, n % 3 = 0,
  (ARRAY['UAE','India','UK','Russia','Pakistan'])[1 + n % 5],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London','Moscow'])[1 + n % 5],
  2 + n % 5, 2 + n % 4
FROM generate_series(1, 250) AS n;


-- ─────────────────────────────────────────────────────────────
-- STAGE 4: ACTIVE B2C UPSELL/CROSS-SELL (Seg 11-15) — ~700
-- ─────────────────────────────────────────────────────────────

-- Seg 11: Recent Bookers 0-30 days Cross-Sell (180 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, travel_date,
  whatsapp_opt_in, email_opt_in, sms_opt_in, residence_country, residence_city,
  website_sessions_total, product_views_count, visa_services_used
)
SELECT
  'Recent' || n, 'Booker' || (n % 30),
  'recent.booker' || n || '@gmail.com',
  '+971' || (600000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','UK','Germany','USA','UAE','Russia','China'])[1 + n % 7],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((60 + n % 200) || ' days')::INTERVAL,
  NOW() - ((35 + n % 100) || ' days')::INTERVAL,
  1 + n % 3, -- 1-3 bookings
  500 + n % 3000,
  n % 30, -- 0-29 days (<=30 required)
  NOW() + ((5 + n % 30) || ' days')::INTERVAL,
  true, true, true,
  (ARRAY['UAE','India','UK','Germany','USA'])[1 + n % 5],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London','Berlin'])[1 + n % 5],
  4 + n % 8, 5 + n % 10,
  CASE WHEN n % 4 = 0 THEN 1 ELSE 0 END
FROM generate_series(1, 180) AS n;

-- Seg 12: Post-Trip 0-7 days Immediate Rebook (120 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, travel_date,
  whatsapp_opt_in, email_opt_in, sms_opt_in, residence_country, residence_city,
  website_sessions_total, product_views_count, average_rating_given, reviews_submitted
)
SELECT
  'PostTrip' || n, 'Traveler' || (n % 25),
  'posttrip' || n || '@gmail.com',
  '+971' || (610000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','UK','Germany','USA','UAE','Australia','France'])[1 + n % 7],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((90 + n % 200) || ' days')::INTERVAL,
  NOW() - ((40 + n % 100) || ' days')::INTERVAL,
  1 + n % 4,
  800 + n % 4000,
  2 + n % 10,
  NOW() - ((1 + n % 6) || ' days')::INTERVAL, -- traveled 1-6 days ago
  true, true, n % 2 = 0,
  (ARRAY['UAE','India','UK','Germany','France'])[1 + n % 5],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London','Paris'])[1 + n % 5],
  5 + n % 10, 5 + n % 8,
  3 + (n % 3), n % 3
FROM generate_series(1, 120) AS n;

-- Seg 13: Visa-Only Customers Tour Cross-Sell (120 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, visa_services_used,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city,
  website_sessions_total, product_views_count
)
SELECT
  'VisaOnly' || n, 'Client' || (n % 25),
  'visaonly' || n || '@gmail.com',
  '+971' || (620000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','Pakistan','Bangladesh','Philippines','Egypt','Nigeria'])[1 + n % 6],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((30 + n % 180) || ' days')::INTERVAL,
  NOW() - ((20 + n % 150) || ' days')::INTERVAL,
  1 + n % 2, -- total_bookings = visa_services_used
  200 + n % 800,
  10 + n % 90,
  1 + n % 2, -- visa_services_used = total_bookings (so all bookings are visa)
  true, true,
  (ARRAY['UAE','India','Pakistan','Philippines'])[1 + n % 4],
  (ARRAY['Dubai','Abu Dhabi','Sharjah','Manila'])[1 + n % 4],
  2 + n % 5, 2 + n % 4
FROM generate_series(1, 120) AS n;

-- Seg 14: Tour-Only Visa Cross-Sell (150 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, visa_services_used,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city,
  website_sessions_total, product_views_count
)
SELECT
  'TourOnly' || n, 'Guest' || (n % 30),
  'touronly' || n || '@gmail.com',
  '+971' || (630000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','UK','Germany','USA','Russia','China','France'])[1 + n % 7],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((60 + n % 200) || ' days')::INTERVAL,
  NOW() - ((40 + n % 180) || ' days')::INTERVAL,
  1 + n % 3,
  400 + n % 3000,
  10 + n % 120,
  0, -- zero visa services
  true, true,
  (ARRAY['UAE','India','UK','Germany','USA'])[1 + n % 5],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London','New York'])[1 + n % 5],
  3 + n % 8, 3 + n % 6
FROM generate_series(1, 150) AS n;

-- Seg 15: Frequent Bookers 4+ VIP Upgrade (130 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, preferred_products,
  whatsapp_opt_in, email_opt_in, sms_opt_in, residence_country, residence_city,
  website_sessions_total, product_views_count, visa_services_used,
  average_rating_given, reviews_submitted
)
SELECT
  'VIP' || n, 'Frequent' || (n % 25),
  'vip.frequent' || n || '@gmail.com',
  '+971' || (640000000 + n)::TEXT,
  'B2C',
  (ARRAY['UAE','UK','Germany','USA','India','Russia'])[1 + n % 6],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((200 + n % 300) || ' days')::INTERVAL,
  NOW() - ((180 + n % 250) || ' days')::INTERVAL,
  4 + n % 6, -- 4-9 bookings (>=4 required)
  3000 + n % 15000,
  n % 60, -- 0-59 days (<=60 required)
  ARRAY['Desert Safari Premium', 'Cruise', 'Yacht Tour'],
  true, true, true,
  (ARRAY['UAE','UK','Germany','USA'])[1 + n % 4],
  (ARRAY['Dubai','Abu Dhabi','London','New York'])[1 + n % 4],
  10 + n % 20, 8 + n % 15,
  n % 3,
  4.0 + (n % 2) * 0.5, n % 4
FROM generate_series(1, 130) AS n;


-- ─────────────────────────────────────────────────────────────
-- STAGE 5: B2B & CORPORATE (Seg 16-19) — ~500
-- ─────────────────────────────────────────────────────────────

-- Seg 16: Corporate Prospects Cold (150 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  lead_source, whatsapp_opt_in, email_opt_in, residence_country, residence_city
)
SELECT
  'Corp' || n, 'Prospect' || (n % 30),
  'corp.prospect' || n || '@company.com',
  '+971' || (650000000 + n)::TEXT,
  'Corporate',
  (ARRAY['UAE','UK','USA','Germany','India'])[1 + n % 5],
  CASE WHEN n % 3 = 0 THEN 'female' ELSE 'male' END,
  NOW() - ((10 + n % 60) || ' days')::INTERVAL,
  NULL,
  0, 0,
  'Corporate Enquiry',
  true, true,
  (ARRAY['UAE','UK','USA','Germany'])[1 + n % 4],
  (ARRAY['Dubai','Abu Dhabi','London','New York'])[1 + n % 4]
FROM generate_series(1, 150) AS n;

-- Seg 17: Active Corporate Upsell (100 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city
)
SELECT
  'CorpActive' || n, 'Manager' || (n % 20),
  'corp.active' || n || '@company.com',
  '+971' || (660000000 + n)::TEXT,
  'Corporate',
  (ARRAY['UAE','UK','USA','Germany','India'])[1 + n % 5],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((200 + n % 300) || ' days')::INTERVAL,
  NOW() - ((150 + n % 250) || ' days')::INTERVAL,
  5 + n % 10, -- 5-14 bookings (>=5 required)
  5000 + n % 20000,
  60 + n % 120, -- >=60 days
  true, true,
  (ARRAY['UAE','UK','USA'])[1 + n % 3],
  (ARRAY['Dubai','Abu Dhabi','London'])[1 + n % 3]
FROM generate_series(1, 100) AS n;

-- Seg 18: B2B Partners Travel Agencies (150 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, whatsapp_opt_in, email_opt_in, residence_country, residence_city
)
SELECT
  'Agency' || n, 'Partner' || (n % 30),
  'agency' || n || '@travel.com',
  '+971' || (670000000 + n)::TEXT,
  'B2B',
  (ARRAY['UAE','India','UK','Germany','USA','Russia'])[1 + n % 6],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((100 + n % 300) || ' days')::INTERVAL,
  NOW() - ((80 + n % 250) || ' days')::INTERVAL,
  3 + n % 20,
  10000 + n % 50000,
  5 + n % 90,
  true, true,
  (ARRAY['UAE','India','UK','Germany'])[1 + n % 4],
  (ARRAY['Dubai','Mumbai','London','Berlin'])[1 + n % 4]
FROM generate_series(1, 150) AS n;

-- Seg 19: School/University Groups (100 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, average_travelers_count,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city
)
SELECT
  'School' || n, 'Group' || (n % 20),
  'school.group' || n || '@edu.ae',
  '+971' || (680000000 + n)::TEXT,
  'Educational',
  'UAE',
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((30 + n % 200) || ' days')::INTERVAL,
  CASE WHEN n % 3 = 0 THEN NOW() - ((20 + n % 100) || ' days')::INTERVAL ELSE NULL END,
  CASE WHEN n % 3 = 0 THEN 1 + n % 3 ELSE 0 END,
  CASE WHEN n % 3 = 0 THEN 5000 + n % 15000 ELSE 0 END,
  CASE WHEN n % 3 = 0 THEN 30 + n % 90 ELSE NULL END,
  15 + n % 35, -- 15-49 travelers (>=15 required)
  true, true,
  'UAE',
  (ARRAY['Dubai','Abu Dhabi','Sharjah','Al Ain'])[1 + n % 4]
FROM generate_series(1, 100) AS n;


-- ─────────────────────────────────────────────────────────────
-- STAGE 6: ADVOCACY & REFERRAL (Seg 20-22) — ~400
-- ─────────────────────────────────────────────────────────────

-- Seg 20: Happy Customers Post-Trip 7-30 days (180 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, travel_date, average_rating_given, reviews_submitted,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city,
  website_sessions_total, product_views_count
)
SELECT
  'Happy' || n, 'Traveler' || (n % 35),
  'happy.traveler' || n || '@gmail.com',
  '+971' || (690000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','UK','Germany','USA','UAE','Russia','China','Australia'])[1 + n % 8],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((90 + n % 200) || ' days')::INTERVAL,
  NOW() - ((60 + n % 150) || ' days')::INTERVAL,
  1 + n % 4,
  600 + n % 3000,
  10 + n % 25,
  NOW() - ((7 + n % 23) || ' days')::INTERVAL, -- traveled 7-29 days ago
  4.0 + (n % 2) * 0.5,
  n % 2,
  true, true,
  (ARRAY['UAE','India','UK','Germany','USA'])[1 + n % 5],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London','New York'])[1 + n % 5],
  5 + n % 10, 4 + n % 8
FROM generate_series(1, 180) AS n;

-- Seg 21: Review Writers 4-5 Stars (120 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, average_rating_given, reviews_submitted,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city,
  website_sessions_total
)
SELECT
  'Reviewer' || n, 'Star' || (n % 25),
  'reviewer' || n || '@gmail.com',
  '+971' || (700000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','UK','UAE','USA','Germany','Australia'])[1 + n % 6],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((60 + n % 200) || ' days')::INTERVAL,
  NOW() - ((40 + n % 180) || ' days')::INTERVAL,
  2 + n % 5,
  800 + n % 4000,
  15 + n % 90,
  4.0 + (n % 2) * 0.5, -- 4.0 or 4.5 (>=4 required)
  1 + n % 5, -- 1-5 reviews (>=1 required)
  true, true,
  (ARRAY['UAE','India','UK','USA'])[1 + n % 4],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London'])[1 + n % 4],
  5 + n % 15
FROM generate_series(1, 120) AS n;

-- Seg 22: Social Media Advocates (100 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, social_media_mentions, average_rating_given,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city,
  website_sessions_total
)
SELECT
  'Social' || n, 'Advocate' || (n % 20),
  'social.advocate' || n || '@gmail.com',
  '+971' || (710000000 + n)::TEXT,
  'B2C',
  (ARRAY['UAE','India','UK','USA','Germany','Russia'])[1 + n % 6],
  CASE WHEN n % 3 = 0 THEN 'female' ELSE 'male' END,
  NOW() - ((30 + n % 200) || ' days')::INTERVAL,
  NOW() - ((20 + n % 150) || ' days')::INTERVAL,
  1 + n % 5,
  500 + n % 5000,
  10 + n % 90,
  1 + n % 8, -- 1-8 mentions (>=1 required)
  3.5 + (n % 3) * 0.5,
  true, true,
  (ARRAY['UAE','India','UK','USA'])[1 + n % 4],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London'])[1 + n % 4],
  5 + n % 20
FROM generate_series(1, 100) AS n;


-- ─────────────────────────────────────────────────────────────
-- STAGE 7: SPECIAL BEHAVIORAL (Seg 23-28) — ~900
-- ─────────────────────────────────────────────────────────────

-- Seg 23: Birthday Month Customers (200 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, date_of_birth,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city,
  website_sessions_total
)
SELECT
  'Birthday' || n, 'Celeb' || (n % 40),
  'birthday' || n || '@gmail.com',
  '+971' || (720000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','UK','UAE','USA','Germany','Russia','China'])[1 + n % 7],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((60 + n % 300) || ' days')::INTERVAL,
  CASE WHEN n % 2 = 0 THEN NOW() - ((30 + n % 200) || ' days')::INTERVAL ELSE NULL END,
  CASE WHEN n % 2 = 0 THEN 1 + n % 3 ELSE 0 END,
  CASE WHEN n % 2 = 0 THEN 400 + n % 3000 ELSE 0 END,
  CASE WHEN n % 2 = 0 THEN 20 + n % 90 ELSE NULL END,
  -- Birthday in current month
  MAKE_DATE(1985 + (n % 30)::INT, EXTRACT(MONTH FROM NOW())::INT, LEAST(28, (1 + n % 28)::INT)),
  true, true,
  (ARRAY['UAE','India','UK','USA','Germany'])[1 + n % 5],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London','Berlin'])[1 + n % 5],
  2 + n % 8
FROM generate_series(1, 200) AS n;

-- Seg 24: Holiday Travelers (150 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, holiday_traveler,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city,
  website_sessions_total
)
SELECT
  'Holiday' || n, 'Traveler' || (n % 30),
  'holiday' || n || '@gmail.com',
  '+971' || (730000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','Pakistan','UAE','Bangladesh','Philippines','Egypt'])[1 + n % 6],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((60 + n % 300) || ' days')::INTERVAL,
  NOW() - ((30 + n % 200) || ' days')::INTERVAL,
  1 + n % 4, -- >=1 required
  500 + n % 4000,
  10 + n % 90,
  true, -- holiday_traveler = true required
  true, true,
  (ARRAY['UAE','India','Pakistan','Bangladesh'])[1 + n % 4],
  (ARRAY['Dubai','Abu Dhabi','Sharjah','Mumbai'])[1 + n % 4],
  3 + n % 8
FROM generate_series(1, 150) AS n;

-- Seg 25: Local UAE Residents (200 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, residence_country,
  whatsapp_opt_in, email_opt_in, sms_opt_in, residence_city,
  website_sessions_total, product_views_count
)
SELECT
  'Local' || n, 'Resident' || (n % 40),
  'local.resident' || n || '@gmail.com',
  '+971' || (740000000 + n)::TEXT,
  'B2C',
  (ARRAY['UAE','India','Pakistan','Philippines','Egypt','UK'])[1 + n % 6],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((30 + n % 300) || ' days')::INTERVAL,
  CASE WHEN n % 3 != 0 THEN NOW() - ((20 + n % 200) || ' days')::INTERVAL ELSE NULL END,
  CASE WHEN n % 3 != 0 THEN 1 + n % 3 ELSE 0 END,
  CASE WHEN n % 3 != 0 THEN 300 + n % 3000 ELSE 0 END,
  CASE WHEN n % 3 != 0 THEN 10 + n % 90 ELSE NULL END,
  CASE WHEN n % 2 = 0 THEN 'UAE' ELSE 'United Arab Emirates' END,
  true, true, n % 2 = 0,
  (ARRAY['Dubai','Abu Dhabi','Sharjah','Ajman','Ras Al Khaimah','Fujairah'])[1 + n % 6],
  3 + n % 10, 2 + n % 8
FROM generate_series(1, 200) AS n;

-- Seg 26: Wallet Heavy Users (100 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, wallet_spent_total, wallet_usage_rate,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city,
  website_sessions_total
)
SELECT
  'Wallet' || n, 'User' || (n % 20),
  'wallet.user' || n || '@gmail.com',
  '+971' || (750000000 + n)::TEXT,
  'B2C',
  (ARRAY['UAE','India','UK','Germany','USA'])[1 + n % 5],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((60 + n % 200) || ' days')::INTERVAL,
  NOW() - ((30 + n % 150) || ' days')::INTERVAL,
  2 + n % 5,
  1000 + n % 5000,
  15 + n % 60,
  500 + n % 3000, -- >=500 required
  70 + n % 30, -- >=70 required
  true, true,
  (ARRAY['UAE','India','UK','USA'])[1 + n % 4],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','London'])[1 + n % 4],
  5 + n % 15
FROM generate_series(1, 100) AS n;

-- Seg 27: WhatsApp-Only Responders (100 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, whatsapp_response_rate, email_engagement_score,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city,
  website_sessions_total
)
SELECT
  'WAOnly' || n, 'Resp' || (n % 20),
  'waonly' || n || '@gmail.com',
  '+971' || (760000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','Pakistan','UAE','Bangladesh','Philippines'])[1 + n % 5],
  CASE WHEN n % 3 = 0 THEN 'female' ELSE 'male' END,
  NOW() - ((30 + n % 200) || ' days')::INTERVAL,
  CASE WHEN n % 3 = 0 THEN NOW() - ((20 + n % 100) || ' days')::INTERVAL ELSE NULL END,
  CASE WHEN n % 3 = 0 THEN 1 + n % 2 ELSE 0 END,
  CASE WHEN n % 3 = 0 THEN 300 + n % 2000 ELSE 0 END,
  CASE WHEN n % 3 = 0 THEN 10 + n % 60 ELSE NULL END,
  70 + n % 30, -- >=70 required
  n % 20, -- <=20 required
  true, false,
  (ARRAY['UAE','India','Pakistan','Bangladesh'])[1 + n % 4],
  (ARRAY['Dubai','Abu Dhabi','Sharjah','Karachi'])[1 + n % 4],
  1 + n % 5
FROM generate_series(1, 100) AS n;

-- Seg 28: High Cancellation Risk (150 customers)
INSERT INTO customers (
  first_name, last_name, email, phone_number, customer_type, nationality, gender,
  registration_date, first_booking_date, total_bookings, total_revenue,
  days_since_last_booking, cancellation_rate, total_cancelled_bookings,
  whatsapp_opt_in, email_opt_in, residence_country, residence_city,
  website_sessions_total
)
SELECT
  'CancelRisk' || n, 'Customer' || (n % 30),
  'cancel.risk' || n || '@gmail.com',
  '+971' || (770000000 + n)::TEXT,
  'B2C',
  (ARRAY['India','UK','UAE','Russia','Germany','USA'])[1 + n % 6],
  CASE WHEN n % 2 = 0 THEN 'male' ELSE 'female' END,
  NOW() - ((60 + n % 200) || ' days')::INTERVAL,
  NOW() - ((30 + n % 150) || ' days')::INTERVAL,
  2 + n % 5,
  400 + n % 3000,
  10 + n % 60,
  40 + n % 60, -- >=40 required
  2 + n % 4, -- >=2 required
  true, true,
  (ARRAY['UAE','India','UK','Russia'])[1 + n % 4],
  (ARRAY['Dubai','Abu Dhabi','Mumbai','Moscow'])[1 + n % 4],
  3 + n % 8
FROM generate_series(1, 150) AS n;


-- ══════════════════════════════════════════════════════════════
-- Set common defaults for all customers
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

-- ══════════════════════════════════════════════════════════════
-- Recompute RFM scores
-- ══════════════════════════════════════════════════════════════
UPDATE customers SET
  rfm_recency_score = CASE
    WHEN days_since_last_booking IS NULL OR days_since_last_booking = 0 THEN
      CASE WHEN total_bookings > 0 THEN 3 ELSE 1 END
    WHEN days_since_last_booking <= 30  THEN 5
    WHEN days_since_last_booking <= 60  THEN 4
    WHEN days_since_last_booking <= 90  THEN 3
    WHEN days_since_last_booking <= 180 THEN 2
    ELSE 1
  END,
  rfm_frequency_score = CASE
    WHEN total_bookings >= 5  THEN 5
    WHEN total_bookings = 4   THEN 4
    WHEN total_bookings = 3   THEN 3
    WHEN total_bookings = 2   THEN 2
    WHEN total_bookings = 1   THEN 1
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
  WHEN rfm_segment_label = 'Champions'         THEN 95.0
  WHEN rfm_segment_label = 'Loyal Customers'    THEN 85.0
  WHEN rfm_segment_label = 'Potential Loyalists' THEN 70.0
  WHEN rfm_segment_label = 'At Risk'            THEN 50.0
  WHEN rfm_segment_label = 'Need Attention'     THEN 35.0
  WHEN rfm_segment_label = 'Hibernating'        THEN 20.0
  ELSE 10.0
END;

UPDATE customers SET winback_strategy = CASE
  WHEN rfm_segment_label IN ('Champions', 'Loyal Customers') THEN 'VIP Retention & Upsell'
  WHEN rfm_segment_label = 'Potential Loyalists' THEN 'Nurture to Loyalty'
  WHEN rfm_segment_label = 'At Risk'             THEN 'Re-engagement Campaign'
  WHEN rfm_segment_label = 'Need Attention'      THEN 'Win-back Discount Offer'
  WHEN rfm_segment_label = 'Hibernating'         THEN 'Aggressive Win-back'
  WHEN rfm_segment_label = 'Lost'                THEN 'Last Chance Offer'
  ELSE 'Cold Lead Nurture'
END;


COMMIT;
