-- ═══════════════════════════════════════════════════════════════════
-- Migration 019: GA4 BigQuery Sync Tables
-- Stores GA4 events from BigQuery for local analytics + segmentation
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

-- GA4 events table — mirrors BigQuery ga4_clean schema
CREATE TABLE IF NOT EXISTS ga4_events (
  id BIGSERIAL PRIMARY KEY,
  event_date DATE,
  event_ts TIMESTAMPTZ,
  event_name TEXT NOT NULL,
  user_pseudo_id TEXT,
  user_id TEXT,
  hostname TEXT,
  device_category TEXT,
  geo_country TEXT,
  geo_city TEXT,
  ga_session_id BIGINT,
  ga_session_number INT,
  -- Traffic source
  ep_source TEXT,
  ep_medium TEXT,
  ep_campaign TEXT,
  ep_campaign_id TEXT,
  gclid TEXT,
  -- Landing
  page_location TEXT,
  page_referrer TEXT,
  page_title TEXT,
  page_path_clean TEXT,
  landing_page_path_clean TEXT,
  -- Session engagement
  session_engaged_final INT,
  engagement_time_msec BIGINT,
  -- User identity
  email_any TEXT,
  name_any TEXT,
  contact_number_any TEXT,
  logged_in_status TEXT,
  -- Transaction
  transaction_id TEXT,
  final_order_id TEXT,
  currency TEXT,
  -- Item details
  item_id TEXT,
  item_name TEXT,
  item_brand TEXT,
  item_category TEXT,
  item_price NUMERIC(12,2),
  item_quantity INT,
  item_revenue NUMERIC(12,2),
  item_value NUMERIC(12,2),
  -- Coupon
  coupon TEXT,
  discount NUMERIC(12,2),
  coupon_applied TEXT,
  -- Search
  search_term TEXT,
  -- Counts
  item_adult_count INT,
  item_children_count INT,
  -- Campaign (sttslc)
  campaign_source TEXT,
  campaign_medium TEXT,
  campaign_name TEXT,
  -- Sync metadata
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_ga4_event_date ON ga4_events(event_date);
CREATE INDEX IF NOT EXISTS idx_ga4_event_name ON ga4_events(event_name);
CREATE INDEX IF NOT EXISTS idx_ga4_user_pseudo ON ga4_events(user_pseudo_id);
CREATE INDEX IF NOT EXISTS idx_ga4_email ON ga4_events(email_any) WHERE email_any IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ga4_session ON ga4_events(ga_session_id);
CREATE INDEX IF NOT EXISTS idx_ga4_item ON ga4_events(item_name) WHERE item_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ga4_event_ts ON ga4_events(event_ts);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ga4_dedup ON ga4_events(user_pseudo_id, event_name, event_ts, COALESCE(item_name, ''));

-- GA4 user profiles — aggregated from events for segmentation
CREATE TABLE IF NOT EXISTS ga4_user_profiles (
  user_pseudo_id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  phone TEXT,
  first_seen DATE,
  last_seen DATE,
  total_sessions INT DEFAULT 0,
  total_pageviews INT DEFAULT 0,
  total_item_views INT DEFAULT 0,
  total_checkouts INT DEFAULT 0,
  total_purchases INT DEFAULT 0,
  total_revenue NUMERIC(12,2) DEFAULT 0,
  engagement_time_sec INT DEFAULT 0,
  top_country TEXT,
  top_city TEXT,
  top_device TEXT,
  last_source TEXT,
  last_medium TEXT,
  last_campaign TEXT,
  viewed_products TEXT[],
  checkout_products TEXT[],
  purchased_products TEXT[],
  last_search_term TEXT,
  last_coupon_used TEXT,
  is_engaged BOOLEAN DEFAULT false,
  linked_customer_id BIGINT REFERENCES customers(customer_id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ga4_profile_email ON ga4_user_profiles(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ga4_profile_linked ON ga4_user_profiles(linked_customer_id) WHERE linked_customer_id IS NOT NULL;

-- Add GA4 fields to customers table for segmentation
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ga4_user_pseudo_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ga4_sessions INT DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ga4_pageviews INT DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ga4_item_views INT DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ga4_checkouts INT DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ga4_last_source TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ga4_last_medium TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ga4_last_campaign TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ga4_viewed_products TEXT[];
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ga4_last_active DATE;

CREATE INDEX IF NOT EXISTS idx_customers_ga4_pseudo ON customers(ga4_user_pseudo_id) WHERE ga4_user_pseudo_id IS NOT NULL;

-- Sync metadata entry
INSERT INTO sync_metadata (table_name, sync_status) VALUES ('ga4_events', 'pending')
ON CONFLICT (table_name) DO NOTHING;

COMMIT;
