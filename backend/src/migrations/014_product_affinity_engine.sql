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


-- ── 2–4. (removed 2026-11-11: segment_product_affinity table, its seed data and the
--        v_segment_affinity view — table dropped, never populated)

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

SELECT 'Migration 014 complete: ' || COUNT(*) || ' department product mappings'
FROM department_product_map;
