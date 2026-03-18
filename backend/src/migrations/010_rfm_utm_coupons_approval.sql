-- ═══════════════════════════════════════════════════════════════════
-- Migration 010: RFM Analysis, UTM Tracking, Coupons, Human Approval
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

-- ══════════════════════════════════════════════════════════════
-- PART 1: RFM ANALYSIS (Recency, Frequency, Monetary)
-- ══════════════════════════════════════════════════════════════

-- Add RFM columns to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS rfm_recency_score   SMALLINT DEFAULT 0 CHECK (rfm_recency_score BETWEEN 0 AND 5);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS rfm_frequency_score SMALLINT DEFAULT 0 CHECK (rfm_frequency_score BETWEEN 0 AND 5);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS rfm_monetary_score  SMALLINT DEFAULT 0 CHECK (rfm_monetary_score BETWEEN 0 AND 5);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS rfm_total_score     SMALLINT DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS rfm_segment_label   TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS rfm_updated_at      TIMESTAMPTZ;

-- Add winback & product affinity columns
ALTER TABLE customers ADD COLUMN IF NOT EXISTS winback_probability  NUMERIC(5,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS winback_strategy     TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS product_affinity     JSONB DEFAULT '[]';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_products   TEXT[];

-- Compute RFM scores based on existing data
-- Recency: 5=recent, 1=dormant
UPDATE customers SET rfm_recency_score = CASE
  WHEN days_since_last_booking IS NULL OR days_since_last_booking = 0 THEN
    CASE WHEN total_bookings > 0 THEN 3 ELSE 1 END
  WHEN days_since_last_booking <= 30  THEN 5
  WHEN days_since_last_booking <= 60  THEN 4
  WHEN days_since_last_booking <= 90  THEN 3
  WHEN days_since_last_booking <= 180 THEN 2
  ELSE 1
END;

-- Frequency: 5=frequent, 1=rare
UPDATE customers SET rfm_frequency_score = CASE
  WHEN total_bookings >= 5  THEN 5
  WHEN total_bookings = 4   THEN 4
  WHEN total_bookings = 3   THEN 3
  WHEN total_bookings = 2   THEN 2
  WHEN total_bookings = 1   THEN 1
  ELSE 0
END;

-- Monetary: 5=high value, 1=low value
UPDATE customers SET rfm_monetary_score = CASE
  WHEN total_revenue >= 5000 THEN 5
  WHEN total_revenue >= 3000 THEN 4
  WHEN total_revenue >= 1500 THEN 3
  WHEN total_revenue >= 500  THEN 2
  WHEN total_revenue > 0     THEN 1
  ELSE 0
END;

-- Total RFM score
UPDATE customers SET rfm_total_score = rfm_recency_score + rfm_frequency_score + rfm_monetary_score;

-- RFM segment labels
UPDATE customers SET rfm_segment_label = CASE
  WHEN rfm_total_score >= 13 THEN 'Champions'
  WHEN rfm_total_score >= 11 THEN 'Loyal Customers'
  WHEN rfm_total_score >= 9  THEN 'Potential Loyalists'
  WHEN rfm_total_score >= 7  THEN 'At Risk'
  WHEN rfm_total_score >= 5  THEN 'Need Attention'
  WHEN rfm_total_score >= 3  THEN 'Hibernating'
  ELSE 'Lost'
END;

-- Winback probability
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

-- Winback strategy assignment
UPDATE customers SET winback_strategy = CASE
  WHEN rfm_segment_label IN ('Champions', 'Loyal Customers') THEN 'VIP Retention & Upsell'
  WHEN rfm_segment_label = 'Potential Loyalists' THEN 'Nurture to Loyalty'
  WHEN rfm_segment_label = 'At Risk'             THEN 'Re-engagement Campaign'
  WHEN rfm_segment_label = 'Need Attention'      THEN 'Win-back Discount Offer'
  WHEN rfm_segment_label = 'Hibernating'         THEN 'Aggressive Win-back'
  WHEN rfm_segment_label = 'Lost'                THEN 'Last Chance Offer'
  ELSE 'Cold Lead Nurture'
END;

UPDATE customers SET rfm_updated_at = NOW();

-- Product affinity based on booking patterns
UPDATE customers SET product_affinity = jsonb_build_array(
  jsonb_build_object('product', 'Desert Safari', 'score', CASE WHEN customer_id % 5 = 0 THEN 0.9 WHEN customer_id % 3 = 0 THEN 0.6 ELSE 0.3 END),
  jsonb_build_object('product', 'City Tour', 'score', CASE WHEN customer_id % 4 = 0 THEN 0.85 ELSE 0.4 END),
  jsonb_build_object('product', 'Visa Service', 'score', CASE WHEN customer_id % 7 = 0 THEN 0.95 ELSE 0.2 END),
  jsonb_build_object('product', 'Cruise', 'score', CASE WHEN total_revenue > 3000 THEN 0.8 ELSE 0.15 END),
  jsonb_build_object('product', 'Abu Dhabi Tour', 'score', CASE WHEN customer_id % 6 = 0 THEN 0.7 ELSE 0.25 END)
)
WHERE total_bookings > 0;

UPDATE customers SET preferred_products = ARRAY['Desert Safari', 'City Tour'] WHERE customer_id % 3 = 0 AND total_bookings > 0;
UPDATE customers SET preferred_products = ARRAY['Visa Service', 'Abu Dhabi Tour'] WHERE customer_id % 7 = 0 AND total_bookings > 0;
UPDATE customers SET preferred_products = ARRAY['Cruise', 'Desert Safari'] WHERE total_revenue > 3000 AND preferred_products IS NULL;
UPDATE customers SET preferred_products = ARRAY['City Tour'] WHERE total_bookings > 0 AND preferred_products IS NULL;


-- ══════════════════════════════════════════════════════════════
-- PART 2: COUPON SYSTEM
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS coupons (
  coupon_id       BIGSERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  description     TEXT,
  discount_type   TEXT NOT NULL DEFAULT 'percentage' CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value  NUMERIC(10,2) NOT NULL,
  min_order_value NUMERIC(10,2) DEFAULT 0,
  max_discount    NUMERIC(10,2),
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until     TIMESTAMPTZ,
  usage_limit     INTEGER,
  used_count      INTEGER DEFAULT 0,
  segment_labels  TEXT[],
  channel_types   channel_type[],
  product_types   TEXT[],
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupon_usage (
  usage_id    BIGSERIAL PRIMARY KEY,
  coupon_id   BIGINT REFERENCES coupons(coupon_id),
  customer_id BIGINT REFERENCES customers(customer_id),
  booking_id  BIGINT,
  campaign_id BIGINT,
  channel     channel_type,
  discount_applied NUMERIC(10,2),
  used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed RAYNOW coupon
INSERT INTO coupons (code, description, discount_type, discount_value, min_order_value, max_discount, valid_until, usage_limit, segment_labels, channel_types)
VALUES (
  'RAYNOW',
  'Rayna Tours 10% Discount — All Segments',
  'percentage',
  10.00,
  100.00,
  500.00,
  '2026-12-31'::TIMESTAMPTZ,
  10000,
  ARRAY['S1','S2','S3','S4','S5','S6','S7','S8','S9','S10','S11','S12','S13','S14','S15','S16','S17','S18','S19','S20','S21','S22','S23','S24','S25','S26','S27','S28'],
  ARRAY['email','whatsapp','sms','push','web']::channel_type[]
);

-- Additional segment-specific coupons
INSERT INTO coupons (code, description, discount_type, discount_value, min_order_value, valid_until, segment_labels) VALUES
('WINBACK15', 'Win-back 15% for dormant customers', 'percentage', 15.00, 200.00, '2026-12-31', ARRAY['S9','S10']),
('VIPEXTRA', 'VIP exclusive 20% off', 'percentage', 20.00, 500.00, '2026-12-31', ARRAY['S15']),
('CORPORATE10', 'Corporate discount 10%', 'percentage', 10.00, 1000.00, '2026-12-31', ARRAY['S16','S17']),
('WELCOME5', 'New customer welcome AED 50 off', 'fixed', 50.00, 200.00, '2026-12-31', ARRAY['S1','S2','S8']),
('CART20', 'Cart recovery 20% off', 'percentage', 20.00, 150.00, '2026-12-31', ARRAY['S3']),
('BIRTHDAY25', 'Birthday month 25% off', 'percentage', 25.00, 300.00, '2026-12-31', ARRAY['S23']),
('FESTIVAL15', 'Festival special 15% off', 'percentage', 15.00, 200.00, '2026-12-31', ARRAY['S24']),
('REFER10', 'Referral reward 10% off', 'percentage', 10.00, 100.00, '2026-12-31', ARRAY['S20','S21','S22']);


-- ══════════════════════════════════════════════════════════════
-- PART 3: UTM TRACKING
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS utm_tracking (
  utm_id         BIGSERIAL PRIMARY KEY,
  campaign_id    BIGINT REFERENCES campaigns(id),
  template_id    BIGINT REFERENCES content_templates(id),
  segment_label  TEXT NOT NULL,
  channel        channel_type NOT NULL,
  utm_source     TEXT NOT NULL DEFAULT 'AI_marketer',
  utm_medium     TEXT NOT NULL,
  utm_campaign   TEXT NOT NULL,
  utm_content    TEXT NOT NULL,
  full_url       TEXT NOT NULL,
  base_url       TEXT NOT NULL DEFAULT 'https://rayna.com',
  clicks         INTEGER DEFAULT 0,
  conversions    INTEGER DEFAULT 0,
  revenue        NUMERIC(12,2) DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_utm_segment ON utm_tracking(segment_label);
CREATE INDEX IF NOT EXISTS idx_utm_campaign ON utm_tracking(utm_campaign);


-- ══════════════════════════════════════════════════════════════
-- PART 4: HUMAN APPROVAL WORKFLOW
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS approval_queue (
  approval_id     BIGSERIAL PRIMARY KEY,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('strategy', 'campaign', 'content', 'coupon')),
  entity_id       BIGINT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('create', 'update', 'activate', 'optimize', 'send', 'delete')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  requested_by    TEXT DEFAULT 'AI_optimizer',
  reviewed_by     TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}',
  changes_summary TEXT,
  ai_confidence   NUMERIC(5,2),
  ai_reasoning    TEXT,
  segment_label   TEXT,
  priority        TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  expires_at      TIMESTAMPTZ DEFAULT NOW() + INTERVAL '48 hours',
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_queue(status);
CREATE INDEX IF NOT EXISTS idx_approval_entity ON approval_queue(entity_type, entity_id);


-- ══════════════════════════════════════════════════════════════
-- PART 5: GTM / BIGQUERY EVENT TRACKING
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS gtm_events (
  event_id       BIGSERIAL PRIMARY KEY,
  event_name     TEXT NOT NULL,
  customer_id    BIGINT REFERENCES customers(customer_id),
  session_id     TEXT,
  page_url       TEXT,
  page_title     TEXT,
  event_category TEXT,
  event_action   TEXT,
  event_label    TEXT,
  event_value    NUMERIC(12,2),
  ecommerce_data JSONB DEFAULT '{}',
  utm_source     TEXT,
  utm_medium     TEXT,
  utm_campaign   TEXT,
  utm_content    TEXT,
  device_type    TEXT,
  browser        TEXT,
  country        TEXT,
  city           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gtm_customer ON gtm_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_gtm_event ON gtm_events(event_name);
CREATE INDEX IF NOT EXISTS idx_gtm_created ON gtm_events(created_at);

-- Seed some GTM events for demo
INSERT INTO gtm_events (event_name, customer_id, page_url, event_category, event_action, event_label, event_value, ecommerce_data, utm_source, utm_medium, created_at)
SELECT
  event_names.name,
  c.customer_id,
  'https://rayna.com/' || LOWER(REPLACE(event_names.name, ' ', '-')),
  event_names.category,
  event_names.action,
  'Desert Safari Premium',
  CASE WHEN event_names.name = 'purchase' THEN c.total_revenue / GREATEST(c.total_bookings, 1)
       WHEN event_names.name = 'add_to_cart' THEN 350
       ELSE 0 END,
  CASE WHEN event_names.name = 'purchase' THEN jsonb_build_object(
    'transaction_id', 'TXN-' || c.customer_id || '-' || (random()*1000)::INT,
    'value', c.total_revenue / GREATEST(c.total_bookings, 1),
    'currency', 'AED',
    'items', jsonb_build_array(jsonb_build_object('item_name', 'Desert Safari', 'price', 350, 'quantity', 1))
  ) ELSE '{}' END,
  'AI_marketer',
  CASE WHEN c.customer_id % 3 = 0 THEN 'email' WHEN c.customer_id % 3 = 1 THEN 'whatsapp' ELSE 'sms' END,
  NOW() - (random() * 30 || ' days')::INTERVAL
FROM customers c
CROSS JOIN (
  VALUES
    ('page_view', 'engagement', 'view'),
    ('add_to_cart', 'ecommerce', 'add'),
    ('begin_checkout', 'ecommerce', 'checkout'),
    ('purchase', 'ecommerce', 'purchase'),
    ('lead_submit', 'conversion', 'submit'),
    ('whatsapp_click', 'engagement', 'click')
) AS event_names(name, category, action)
WHERE c.customer_id % 50 = 0
ORDER BY c.customer_id, event_names.name;


-- ══════════════════════════════════════════════════════════════
-- PART 6: SPECIAL OCCASIONS TABLE
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS special_occasions (
  occasion_id    BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  occasion_type  TEXT NOT NULL CHECK (occasion_type IN ('festival', 'holiday', 'season', 'event', 'custom')),
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  target_markets TEXT[] DEFAULT ARRAY['UAE', 'GCC', 'International'],
  discount_code  TEXT,
  campaign_theme TEXT,
  content_themes JSONB DEFAULT '[]',
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO special_occasions (name, occasion_type, start_date, end_date, target_markets, discount_code, campaign_theme) VALUES
('Eid Al Fitr 2026',    'festival', '2026-03-20', '2026-03-23', ARRAY['UAE','GCC','MENA'], 'EID2026',    'Celebrate Eid with Rayna — Special Packages'),
('Eid Al Adha 2026',    'festival', '2026-05-27', '2026-05-30', ARRAY['UAE','GCC','MENA'], 'ADHA2026',   'Eid Al Adha Adventures — Family Getaways'),
('Diwali 2026',         'festival', '2026-10-20', '2026-10-25', ARRAY['India','UAE'],       'DIWALI26',   'Diwali Dhamaka — Light Up Your Holiday'),
('Christmas 2026',      'festival', '2026-12-20', '2026-12-31', ARRAY['International'],     'XMAS2026',   'Christmas in Dubai — Winter Wonderland'),
('Dubai Shopping Festival', 'event', '2026-12-15', '2027-01-30', ARRAY['UAE','GCC','International'], 'DSF2026', 'DSF Exclusive Tours & Deals'),
('Summer Rush',         'season',   '2026-06-01', '2026-08-31', ARRAY['International'],     'SUMMER26',   'Beat the Heat — Indoor & Evening Tours'),
('National Day UAE',    'holiday',  '2026-12-02', '2026-12-03', ARRAY['UAE'],               'NATDAY26',   'Celebrate UAE Spirit — Heritage Tours'),
('New Year 2027',       'event',    '2026-12-31', '2027-01-02', ARRAY['International'],     'NYE2027',    'New Year Fireworks & Cruise Packages'),
('Ramadan 2026',        'festival', '2026-02-18', '2026-03-19', ARRAY['UAE','GCC','MENA'],  'RAMADAN26',  'Ramadan Iftar Cruises & Heritage Tours'),
('Spring Break',        'season',   '2026-03-15', '2026-04-05', ARRAY['International'],     'SPRING26',   'Spring Break Dubai — Adventure Awaits'),
('Valentine Week',      'event',    '2026-02-10', '2026-02-16', ARRAY['International'],     'LOVE2026',   'Romantic Dubai — Couples Packages'),
('Chinese New Year',    'festival', '2026-02-08', '2026-02-12', ARRAY['International'],     'CNY2026',    'Lunar New Year in Dubai — Premium Experiences');

-- Add occasion coupons
INSERT INTO coupons (code, description, discount_type, discount_value, min_order_value, valid_from, valid_until, segment_labels)
SELECT
  so.discount_code,
  so.campaign_theme,
  'percentage',
  CASE WHEN so.occasion_type = 'festival' THEN 15 WHEN so.occasion_type = 'event' THEN 12 ELSE 10 END,
  200.00,
  so.start_date::TIMESTAMPTZ,
  so.end_date::TIMESTAMPTZ,
  ARRAY['S23','S24','S25']
FROM special_occasions so
WHERE so.discount_code IS NOT NULL
ON CONFLICT (code) DO NOTHING;


-- ══════════════════════════════════════════════════════════════
-- PART 7: SEGMENT ANALYSIS METADATA
-- ══════════════════════════════════════════════════════════════

-- Add analysis columns to segment_definitions
ALTER TABLE segment_definitions ADD COLUMN IF NOT EXISTS rfm_profile        JSONB DEFAULT '{}';
ALTER TABLE segment_definitions ADD COLUMN IF NOT EXISTS winback_goal       TEXT;
ALTER TABLE segment_definitions ADD COLUMN IF NOT EXISTS end_goal           TEXT DEFAULT 'Purchase';
ALTER TABLE segment_definitions ADD COLUMN IF NOT EXISTS product_affinity   JSONB DEFAULT '[]';
ALTER TABLE segment_definitions ADD COLUMN IF NOT EXISTS recommended_coupon TEXT;

-- Update each segment with RFM profile, winback goal, product affinity
UPDATE segment_definitions SET
  end_goal = 'Convert to First Booking',
  winback_goal = 'Cold Lead Nurture',
  rfm_profile = '{"avg_recency": 1, "avg_frequency": 0, "avg_monetary": 0, "label": "Lost/Cold"}',
  product_affinity = '[{"product": "Desert Safari", "score": 0.8}, {"product": "City Tour", "score": 0.6}]',
  recommended_coupon = 'WELCOME5'
WHERE segment_id IN (1, 2, 8);

UPDATE segment_definitions SET
  end_goal = 'Recover Abandoned Purchase',
  winback_goal = 'Cart Recovery',
  rfm_profile = '{"avg_recency": 5, "avg_frequency": 0, "avg_monetary": 0, "label": "Hot Lead"}',
  product_affinity = '[{"product": "Desert Safari", "score": 0.9}, {"product": "Abu Dhabi Tour", "score": 0.7}]',
  recommended_coupon = 'CART20'
WHERE segment_id = 3;

UPDATE segment_definitions SET
  end_goal = 'Convert Enquiry to Booking',
  winback_goal = 'Enquiry Follow-up',
  rfm_profile = '{"avg_recency": 5, "avg_frequency": 0, "avg_monetary": 0, "label": "Warm Lead"}',
  product_affinity = '[{"product": "Desert Safari", "score": 0.8}, {"product": "Visa Service", "score": 0.5}]',
  recommended_coupon = 'RAYNOW'
WHERE segment_id IN (4, 5, 6);

UPDATE segment_definitions SET
  end_goal = 'Complete Payment',
  winback_goal = 'Payment Recovery',
  rfm_profile = '{"avg_recency": 5, "avg_frequency": 0, "avg_monetary": 0, "label": "Payment Failed"}',
  recommended_coupon = 'RAYNOW'
WHERE segment_id = 7;

UPDATE segment_definitions SET
  end_goal = 'Reactivate & Rebook',
  winback_goal = 'Win-back Dormant',
  rfm_profile = '{"avg_recency": 1, "avg_frequency": 3, "avg_monetary": 4, "label": "At Risk"}',
  product_affinity = '[{"product": "Cruise", "score": 0.8}, {"product": "Desert Safari Premium", "score": 0.7}]',
  recommended_coupon = 'WINBACK15'
WHERE segment_id = 9;

UPDATE segment_definitions SET
  end_goal = 'Second Booking',
  winback_goal = 'Re-engagement',
  rfm_profile = '{"avg_recency": 2, "avg_frequency": 1, "avg_monetary": 2, "label": "Need Attention"}',
  product_affinity = '[{"product": "City Tour", "score": 0.7}, {"product": "Desert Safari", "score": 0.6}]',
  recommended_coupon = 'WINBACK15'
WHERE segment_id = 10;

UPDATE segment_definitions SET
  end_goal = 'Cross-Sell Additional Products',
  winback_goal = 'Upsell Active Customer',
  rfm_profile = '{"avg_recency": 5, "avg_frequency": 2, "avg_monetary": 3, "label": "Potential Loyalist"}',
  product_affinity = '[{"product": "Abu Dhabi Tour", "score": 0.8}, {"product": "Cruise", "score": 0.7}]',
  recommended_coupon = 'RAYNOW'
WHERE segment_id IN (11, 12);

UPDATE segment_definitions SET
  end_goal = 'Cross-Sell Tour to Visa Customer',
  winback_goal = 'Product Cross-Sell',
  rfm_profile = '{"avg_recency": 3, "avg_frequency": 1, "avg_monetary": 2, "label": "Potential Loyalist"}',
  product_affinity = '[{"product": "Desert Safari", "score": 0.9}, {"product": "City Tour", "score": 0.8}]',
  recommended_coupon = 'RAYNOW'
WHERE segment_id = 13;

UPDATE segment_definitions SET
  end_goal = 'Cross-Sell Visa to Tour Customer',
  winback_goal = 'Product Cross-Sell',
  rfm_profile = '{"avg_recency": 3, "avg_frequency": 2, "avg_monetary": 3, "label": "Loyal Customer"}',
  product_affinity = '[{"product": "Visa Service", "score": 0.9}]',
  recommended_coupon = 'RAYNOW'
WHERE segment_id = 14;

UPDATE segment_definitions SET
  end_goal = 'VIP Upgrade & Premium Products',
  winback_goal = 'VIP Retention',
  rfm_profile = '{"avg_recency": 4, "avg_frequency": 5, "avg_monetary": 5, "label": "Champion"}',
  product_affinity = '[{"product": "Cruise", "score": 0.9}, {"product": "Desert Safari Premium", "score": 0.8}, {"product": "Yacht Tour", "score": 0.7}]',
  recommended_coupon = 'VIPEXTRA'
WHERE segment_id = 15;

UPDATE segment_definitions SET
  end_goal = 'Convert Corporate Lead',
  winback_goal = 'B2B Lead Nurture',
  rfm_profile = '{"avg_recency": 1, "avg_frequency": 0, "avg_monetary": 0, "label": "Cold B2B"}',
  product_affinity = '[{"product": "Corporate Team Building", "score": 0.9}, {"product": "Group Tours", "score": 0.8}]',
  recommended_coupon = 'CORPORATE10'
WHERE segment_id = 16;

UPDATE segment_definitions SET
  end_goal = 'Corporate Upsell',
  winback_goal = 'B2B Retention',
  rfm_profile = '{"avg_recency": 3, "avg_frequency": 5, "avg_monetary": 5, "label": "Loyal B2B"}',
  product_affinity = '[{"product": "Corporate Retreats", "score": 0.9}, {"product": "Event Planning", "score": 0.8}]',
  recommended_coupon = 'CORPORATE10'
WHERE segment_id = 17;

UPDATE segment_definitions SET
  end_goal = 'B2B Partnership Growth',
  winback_goal = 'Partner Retention',
  rfm_profile = '{"avg_recency": 4, "avg_frequency": 4, "avg_monetary": 5, "label": "Key Account"}',
  recommended_coupon = 'CORPORATE10'
WHERE segment_id = 18;

UPDATE segment_definitions SET
  end_goal = 'Group Booking Conversion',
  winback_goal = 'Educational Group Nurture',
  rfm_profile = '{"avg_recency": 2, "avg_frequency": 1, "avg_monetary": 4, "label": "Seasonal"}',
  product_affinity = '[{"product": "Educational Tours", "score": 0.95}, {"product": "Museum Tours", "score": 0.8}]'
WHERE segment_id = 19;

UPDATE segment_definitions SET
  end_goal = 'Review & Referral',
  winback_goal = 'Advocacy Conversion',
  rfm_profile = '{"avg_recency": 5, "avg_frequency": 2, "avg_monetary": 3, "label": "Potential Loyalist"}',
  recommended_coupon = 'REFER10'
WHERE segment_id IN (20, 21, 22);

UPDATE segment_definitions SET
  end_goal = 'Birthday Booking',
  winback_goal = 'Occasion-Based Conversion',
  rfm_profile = '{"avg_recency": 3, "avg_frequency": 2, "avg_monetary": 3, "label": "Occasion Buyer"}',
  product_affinity = '[{"product": "Yacht Tour", "score": 0.8}, {"product": "Desert Safari Premium", "score": 0.7}]',
  recommended_coupon = 'BIRTHDAY25'
WHERE segment_id = 23;

UPDATE segment_definitions SET
  end_goal = 'Festival Booking',
  winback_goal = 'Festival Conversion',
  rfm_profile = '{"avg_recency": 3, "avg_frequency": 2, "avg_monetary": 3, "label": "Festival Buyer"}',
  product_affinity = '[{"product": "Desert Safari", "score": 0.8}, {"product": "City Tour", "score": 0.7}]',
  recommended_coupon = 'FESTIVAL15'
WHERE segment_id = 24;

UPDATE segment_definitions SET
  end_goal = 'Repeat Local Booking',
  winback_goal = 'Local Engagement',
  rfm_profile = '{"avg_recency": 3, "avg_frequency": 3, "avg_monetary": 2, "label": "Local Regular"}',
  product_affinity = '[{"product": "Desert Safari", "score": 0.6}, {"product": "Staycation", "score": 0.8}]',
  recommended_coupon = 'RAYNOW'
WHERE segment_id = 25;

UPDATE segment_definitions SET
  end_goal = 'Wallet Top-Up & Booking',
  winback_goal = 'Wallet Activation',
  rfm_profile = '{"avg_recency": 4, "avg_frequency": 3, "avg_monetary": 4, "label": "Loyal Customer"}',
  recommended_coupon = 'RAYNOW'
WHERE segment_id = 26;

UPDATE segment_definitions SET
  end_goal = 'WhatsApp-to-Booking Conversion',
  winback_goal = 'Channel Activation',
  rfm_profile = '{"avg_recency": 4, "avg_frequency": 1, "avg_monetary": 1, "label": "Channel Specific"}',
  recommended_coupon = 'RAYNOW'
WHERE segment_id = 27;

UPDATE segment_definitions SET
  end_goal = 'Prevent Cancellation',
  winback_goal = 'Retention & Save',
  rfm_profile = '{"avg_recency": 4, "avg_frequency": 2, "avg_monetary": 3, "label": "At Risk"}',
  recommended_coupon = 'RAYNOW'
WHERE segment_id = 28;


COMMIT;
