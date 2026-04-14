-- 038: Products catalog + User product affinity tables

-- ── Products catalog (synced from Rayna product API) ──────────
CREATE TABLE IF NOT EXISTS products (
  product_id      INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT,
  category        TEXT,
  normal_price    NUMERIC(12,2),
  sale_price      NUMERIC(12,2),
  currency        TEXT DEFAULT 'AED',
  country         TEXT,
  city            TEXT,
  city_id         INTEGER,
  url             TEXT,
  image_url       TEXT,
  page_title      TEXT,
  page_description TEXT,
  synced_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);
CREATE INDEX IF NOT EXISTS idx_products_city ON products(city);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- ── User product affinity (built from GTM events) ─────────────
CREATE TABLE IF NOT EXISTS user_product_affinity (
  id              BIGSERIAL PRIMARY KEY,
  unified_id      INTEGER NOT NULL,
  product_id      INTEGER,
  product_name    TEXT NOT NULL,
  product_category TEXT,
  product_url     TEXT,
  -- Event counts (each GTM event type tracked separately)
  view_count      INTEGER DEFAULT 0,
  cart_count       INTEGER DEFAULT 0,
  checkout_count   INTEGER DEFAULT 0,
  purchase_count   INTEGER DEFAULT 0,
  wishlist_count   INTEGER DEFAULT 0,
  -- Computed affinity score (weighted sum)
  affinity_score  NUMERIC(8,2) DEFAULT 0,
  -- Timestamps
  first_seen_at   TIMESTAMPTZ,
  last_seen_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(unified_id, product_name)
);

CREATE INDEX IF NOT EXISTS idx_upa_unified ON user_product_affinity(unified_id);
CREATE INDEX IF NOT EXISTS idx_upa_product ON user_product_affinity(product_id);
CREATE INDEX IF NOT EXISTS idx_upa_score ON user_product_affinity(affinity_score DESC);
CREATE INDEX IF NOT EXISTS idx_upa_unified_score ON user_product_affinity(unified_id, affinity_score DESC);
