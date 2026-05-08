-- 050_visa_products.sql
--
-- Visa product catalog. `rayna_visas` is bookings/transactions only — this is
-- the marketable product list used by Day3VisaDataService + VisaRankingService.
--
-- A row can belong to multiple categories (international / evisa / popular)
-- via the `categories` array, so the same visa can appear in different
-- template slots depending on what Anthropic ranks it for.

CREATE TABLE IF NOT EXISTS visa_products (
  key            TEXT PRIMARY KEY,                   -- 'usa', 'dubai', 'singapore'
  name           TEXT NOT NULL,                      -- 'USA Visa', 'Dubai Visa'
  country_label  TEXT,                               -- 'United States', 'UAE'
  flag_unicode   TEXT,                               -- '&#127482;&#127480;'
  flag_url       TEXT,                               -- twemoji PNG url
  types_html     TEXT,                               -- intl-card eyebrow: 'Tourist &middot; Business'
  details_html   TEXT,                               -- evisa-row body: 'Tourist eVisa &middot; ...'
  status         TEXT,                               -- evisa badge: 'Instant' | 'Online' | 'Fast'
  image_url      TEXT NOT NULL,
  default_link   TEXT NOT NULL,
  categories     TEXT[] NOT NULL DEFAULT '{}',       -- {international, evisa, popular}
  region         TEXT,                               -- 'mena', 'asia_pacific', 'europe', etc.
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INTEGER NOT NULL DEFAULT 100,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visa_products_categories ON visa_products USING GIN (categories);
CREATE INDEX IF NOT EXISTS idx_visa_products_enabled    ON visa_products (enabled) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_visa_products_region     ON visa_products (region);

-- ── seed catalog ────────────────────────────────────────────────────────
INSERT INTO visa_products (key, name, country_label, flag_unicode, flag_url, types_html, details_html, status, image_url, default_link, categories, region, sort_order)
VALUES
  -- International (sticker / embassy) visas
  ('usa',        'USA Visa',          'United States', '&#127482;&#127480;',
   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1fa-1f1f8.png',
   'Tourist &middot; Transit',
   'Tourist Visa &middot; 10-year validity &middot; Embassy submission',
   'Embassy',
   'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/USA%20VISA%20NEW_296/United%20States.jpg',
   'https://www.raynatours.com/visas',
   ARRAY['international']::TEXT[],     'americas',     10),

  ('uk',         'UK Visa',           'United Kingdom', '&#127468;&#127463;',
   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1ec-1f1e7.png',
   'Tourist &middot; Transit',
   'Tourist Visa &middot; 6 months &middot; Embassy submission',
   'Embassy',
   'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/UK%20Visa%20New_311/United-Kingdom.jpg',
   'https://www.raynatours.com/visas/uk-visa',
   ARRAY['international']::TEXT[],     'europe',       20),

  ('canada',     'Canada Visa',       'Canada',         '&#127464;&#127462;',
   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1e8-1f1e6.png',
   'Tourist &middot; Transit',
   'Tourist Visa &middot; 10-year validity &middot; Embassy submission',
   'Embassy',
   'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/Canada%20Visa%20New_305/cnda-min.jpg',
   'https://www.raynatours.com/visas/canada-visa',
   ARRAY['international']::TEXT[],     'americas',     30),

  ('schengen',   'Schengen Visa',     'Schengen Area',  '&#127466;&#127482;',
   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1ea-1f1fa.png',
   'Tourist &middot; Transit',
   'Tourist Visa &middot; 26 Countries &middot; Embassy submission',
   'Embassy',
   'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/Schengen%20New%20Visa_337/Schengen.jpg',
   'https://www.raynatours.com/visas/schengen-visa',
   ARRAY['international']::TEXT[],     'europe',       40),

  ('australia',  'Australia Visa',    'Australia',      '&#127462;&#127482;',
   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1e6-1f1fa.png',
   'Tourist &middot; Transit',
   'Tourist eVisa &middot; 3 / 6 / 12 months',
   'Online',
   'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/Australia%20Visa%20New_295/Sydney.jpg',
   'https://www.raynatours.com/visas/australia-visa',
   ARRAY['international','popular']::TEXT[], 'oceania', 50),

  -- E-Visa / instant visas
  ('dubai',      'Dubai Visa',        'UAE',            '&#127462;&#127466;',
   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1e6-1f1ea.png',
   'Tourist &middot; Transit',
   'Tourist Visa &middot; 30 / 60 / 90 Days &middot; Ready within 24-48 hours',
   'Instant',
   'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/Dubai%20Visa%20New_294/burj-alrab.jpg',
   'https://www.raynatours.com/visas/dubai-visa',
   ARRAY['evisa','popular']::TEXT[],   'mena',         5),

  ('saudi',      'Saudi Arabia Visa', 'Saudi Arabia',   '&#127480;&#127462;',
   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1f8-1f1e6.png',
   'Tourist &middot; Transit',
   'Tourist eVisa &middot; Valid for 1 Year',
   'Online',
   'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/Saudi%20Arabia%20Visa%20New_309/Saudi-Arabia.jpg',
   'https://www.raynatours.com/visas/saudi-arabia-visa',
   ARRAY['evisa']::TEXT[],             'mena',         10),

  ('turkey',     'Turkey Visa',       'Turkey',         '&#127481;&#127479;',
   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1f9-1f1f7.png',
   'Tourist &middot; Transit',
   'Tourist eVisa &middot; Processed in 24 Hours',
   'Fast',
   'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/Turkey%20New%20Visa_336/Turkey.jpg',
   'https://www.raynatours.com/visas/turkey-visa',
   ARRAY['evisa']::TEXT[],             'mena',         20),

  ('singapore',  'Singapore Visa',    'Singapore',      '&#127480;&#127468;',
   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1f8-1f1ec.png',
   'Tourist &middot; Transit',
   'Tourist eVisa &middot; Processed within 3 Days',
   'Online',
   'https://d2cazmkfw8kdtj.cloudfront.net/City-Images/23726/singapore-city.png',
   'https://www.raynatours.com/visas/singapore-visa',
   ARRAY['evisa','popular']::TEXT[],   'asia_pacific', 30),

  -- Popular (also-popular grid items)
  ('malaysia',   'Malaysia',          'Malaysia',       '&#127474;&#127486;',
   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1f2-1f1fe.png',
   NULL, NULL, 'Online',
   'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/Malaysia%20New%20Visa_335/Malaysia.jpg',
   'https://www.raynatours.com/visas/malaysia-visa',
   ARRAY['evisa','popular']::TEXT[],   'asia_pacific', 60),

  ('china',      'China',             'China',          '&#127464;&#127475;',
   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1e8-1f1f3.png',
   NULL, NULL, 'Embassy',
   'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/China%20New%20Visa_332/China.jpg',
   'https://www.raynatours.com/visas/china-visa',
   ARRAY['popular']::TEXT[],           'asia_pacific', 80),

  ('thailand',   'Thailand',          'Thailand',       '&#127481;&#127469;',
   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1f9-1f1ed.png',
   NULL, NULL, 'Online',
   'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/Thailand%20New%20Visa_333/Thailand.jpg',
   'https://www.raynatours.com/visas/thailand-visa',
   ARRAY['evisa','popular']::TEXT[],   'asia_pacific', 90),

  ('oman',       'Oman',              'Oman',           '&#127476;&#127474;',
   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1f4-1f1f2.png',
   NULL, NULL, 'Online',
   'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/Oman%20New%20Visa_312/oman-visa-bnr.jpg',
   'https://www.raynatours.com/visas/oman-visa',
   ARRAY['evisa','popular']::TEXT[],   'mena',         100),

  ('egypt',      'Egypt',             'Egypt',          '&#127466;&#127468;',
   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1ea-1f1ec.png',
   NULL, NULL, 'Online',
   'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/Egypt%20New%20Visa_328/Egypt.jpg',
   'https://www.raynatours.com/visas/egypt-visa',
   ARRAY['evisa','popular']::TEXT[],   'mena',         110),

  ('japan',      'Japan',             'Japan',          '&#127471;&#127477;',
   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1ef-1f1f5.png',
   'Tourist &middot; Transit',
   'Tourist Visa &middot; 5-10 days &middot; Embassy submission',
   'Embassy',
   'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/Japan%20New%20Visa_330/japan.jpg',
   'https://www.raynatours.com/visas/japan-visa',
   ARRAY['international','popular']::TEXT[], 'asia_pacific', 120)
ON CONFLICT (key) DO UPDATE SET
  name          = EXCLUDED.name,
  country_label = EXCLUDED.country_label,
  flag_unicode  = EXCLUDED.flag_unicode,
  flag_url      = EXCLUDED.flag_url,
  types_html    = EXCLUDED.types_html,
  details_html  = EXCLUDED.details_html,
  status        = EXCLUDED.status,
  image_url     = EXCLUDED.image_url,
  default_link  = EXCLUDED.default_link,
  categories    = EXCLUDED.categories,
  region        = EXCLUDED.region,
  sort_order    = EXCLUDED.sort_order,
  synced_at     = NOW();

-- Rayna's primary customer base is Indian residents in UAE (50%+),
-- so we never advertise an India visa. Idempotent removal.
DELETE FROM visa_products WHERE key = 'india';
