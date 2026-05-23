-- Persistent snapshot table for the segmentation tree API.
-- Replaces the expensive 7-query live aggregation on every request.
-- Refreshed nightly at 2 AM Dubai time via node-cron.
-- Falls back to live compute if snapshot is not yet populated.

CREATE TABLE IF NOT EXISTS segmentation_tree_snapshot (

  -- Which business-type variant this row represents
  business_type   TEXT          PRIMARY KEY,          -- 'B2C' | 'B2B' | 'All'

  -- Scalar KPI columns (queryable/inspectable without JSON parsing)
  total_contacts  INT           NOT NULL DEFAULT 0,
  segment_count   INT           NOT NULL DEFAULT 0,
  total_revenue   NUMERIC(15,2) NOT NULL DEFAULT 0,

  -- Aggregated arrays stored as JSONB
  -- status_counts: [{booking_status, count, indian_count, revenue, total_bookings?, booking_breakdown?}]
  status_counts   JSONB         NOT NULL DEFAULT '[]',

  -- breakdown: [{booking_status, product_tier, geography, count, indian_count, revenue}]
  breakdown       JSONB         NOT NULL DEFAULT '[]',

  -- revenue_by_type: {label, sources:[{source, bookings, revenue}], total}
  revenue_by_type JSONB         NOT NULL DEFAULT '{}',

  -- NULL means this variant has not been populated yet (safe fallback signal)
  computed_at     TIMESTAMPTZ

);

-- Seed the three variant rows so UPDATE (not INSERT) works on first refresh
INSERT INTO segmentation_tree_snapshot (business_type)
VALUES ('B2C'), ('B2B'), ('All')
ON CONFLICT DO NOTHING;
