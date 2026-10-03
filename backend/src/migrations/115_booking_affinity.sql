-- 115: Booking-based customer affinity — top 3 services and top 3 products per customer.
--
-- Rebuilt nightly from the rayna_* booking tables by BookingAffinityService.
--   service = business line = which rayna table the booking is in
--             (tours, packages, hotels, visas, flights, others)
--   product = the booking's service_name, grouped by affinity_product_rules
--             (e.g. the many Burj Khalifa ticket names → "Burj Khalifa")
--   booking = one bill (bill_no); several lines of one bill count once
--
-- affinity_score = each non-cancelled booking adds 10 points, halving every 180 days of age.
-- Ranks (#1..) order a customer's services / products by affinity_score, then bookings,
-- then the latest booking.
-- is_bulk = the customer has 50+ non-cancelled bookings in total (resellers, OTAs and
--   corporates — e.g. tickets@headout.com is stored as B2C) or a Rayna staff email.

-- ── Product grouping rules ──────────────────────────────────────────────────
-- Each distinct product name (lower-cased, "Z(Old Don t Use)" / "(Valid till …)" removed)
-- takes the first active rule whose pattern matches, lowest priority first.
-- No match → the product keeps its own name. is_excluded → left out of the product
-- ranks (fee / add-on / generic lines); the booking still counts for its service.
-- Rules can be edited or added with SQL; seeded rows are never overwritten (seed_key).
CREATE TABLE IF NOT EXISTS affinity_product_rules (
  id             SERIAL PRIMARY KEY,
  seed_key       TEXT UNIQUE,
  priority       INTEGER NOT NULL,
  pattern        TEXT    NOT NULL,                  -- PostgreSQL regex on the lower-case name
  service        TEXT,                              -- only this business line; NULL = all
  product_group  TEXT,                              -- product name to show; NULL when excluded
  is_excluded    BOOLEAN NOT NULL DEFAULT FALSE,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO affinity_product_rules (seed_key, priority, pattern, service, product_group, is_excluded, note) VALUES
  -- Hotel spellings (hotels only)
  ('hotel-lapita',            50, 'lapita',                                   'hotels', 'Lapita, Dubai Parks and Resorts', FALSE, NULL),
  ('hotel-atlantis',          51, '^atlantis the palm',                       'hotels', 'Atlantis The Palm', FALSE, NULL),
  ('hotel-citymax-bur-dubai', 52, 'citymax.*bur ?dubai',                      'hotels', 'Citymax Bur Dubai', FALSE, NULL),
  ('citymax-bur-dubai-any',   56, '^citymax.*bur ?dubai',                     NULL, 'Citymax Bur Dubai', FALSE, 'also booked through tours'),
  ('hotel-park-regis',        53, 'park regis kris kin',                      'hotels', 'Park Regis Kris Kin', FALSE, NULL),
  ('hotel-cove-rotana',       54, 'cove rotana',                              'hotels', 'The Cove Rotana', FALSE, NULL),
  ('hotel-grand-excelsior',   55, 'grand excelsior.*bur ?dubai',              'hotels', 'Grand Excelsior Bur Dubai', FALSE, NULL),

  -- "Ticket" in Others = air tickets (bill_type 'Ticket', median ~AED 790); elsewhere it's generic
  ('flight-ticket',            9, '^tickets?$',                               'others', 'Flight Ticket', FALSE, 'air tickets'),

  -- Fees, add-ons and generic lines — not products
  ('x-mix-charges',           10, '^mix charges$',                            NULL, NULL, TRUE, 'fee line'),
  ('x-water-bottles',         11, 'water bottles?',                           NULL, NULL, TRUE, 'add-on'),
  ('x-misc-tour',             12, '^misc tour$',                              NULL, NULL, TRUE, 'generic'),
  ('x-other-services',        13, '^other (express )?services',               NULL, NULL, TRUE, 'generic'),
  ('x-ticket',                14, '^tickets?$',                               NULL, NULL, TRUE, 'generic'),
  ('x-tour-entry',            15, '^tour entry',                              NULL, NULL, TRUE, 'generic'),
  ('x-leisure-day',           16, '^leisure day$',                            NULL, NULL, TRUE, 'free day in an itinerary'),
  ('x-booking-fees',          17, 'booking fees?',                            NULL, NULL, TRUE, 'fee line'),
  ('x-vat',                   18, '^vat$',                                    NULL, NULL, TRUE, 'fee line'),
  ('x-refunds',               19, '^refunds?$',                               NULL, NULL, TRUE, 'fee line'),
  ('x-tour-transport',        20, '^tour ?/ ?transport service',              NULL, NULL, TRUE, 'generic'),
  ('x-alltours-handling',     21, '^alltours (hotel rep|ground handling)',    NULL, NULL, TRUE, 'handling fee'),
  ('x-food-on-table',         22, '^food on table$',                          NULL, NULL, TRUE, 'add-on'),
  ('x-bkg-only',              23, 'bkg only',                                 NULL, NULL, TRUE, 'booking-only line'),
  ('x-international-tour',    24, '^international tour$',                     NULL, NULL, TRUE, 'generic'),
  ('x-meet-assist',           25, 'meet (&|and) (assist|greet)|ground handling', NULL, NULL, TRUE, 'airport handling fee'),

  -- Transfers and car hire (before attractions: "2 way transfer for abu dhabi city tour…")
  ('transfers',              100, '^(1|2|one|two) ?way .*(transfer|seater)|(private|sic|shared) transfers?|^transfers?\M|^air ?port|pick ?up by|drop (back|off) by|^alltours .*(a/p|dxb)', NULL, 'Transfers', FALSE, NULL),
  ('transfers-other',        102, '\d ?way ?transfer|transfers? sic|sic transfers?', NULL, 'Transfers', FALSE, NULL),
  ('transfers-airport',      101, 'air ?port (pick ?up|drop)|terminal \d.*(pick ?up|drop)|(pick ?up|drop (off|back)).*terminal', NULL, 'Transfers', FALSE, NULL),
  ('car-with-driver',        110, 'seater (full|half) day|vehicle with driver|^land cruiser', NULL, 'Car with Driver', FALSE, NULL),
  ('car-with-driver-2',      110, '(full|half) day \d+ seater',               NULL, 'Car with Driver', FALSE, NULL),
  ('tour-guide',             112, 'tour guide|driver guide',                  NULL, 'Tour Guide', FALSE, NULL),
  ('limousine',              111, 'limousine',                                NULL, 'Limousine', FALSE, NULL),

  -- City tours (before attractions: "abu dhabi city tour with qasr al watan" is a city tour)
  ('abu-dhabi-city-tour',    150, 'abu dhabi (city )?tour|abu dhabi .*city tour', NULL, 'Abu Dhabi City Tour', FALSE, NULL),
  ('abu-dhabi-combo',        149, '^abu dhabi \+',                            NULL, 'Abu Dhabi City Tour', FALSE, '"abu dhabi + ferrari …" combos'),
  ('dubai-city-tour',        151, '(dubai|morning|evening|classical|half day|full day).*city tour|city tour.*(deira|bur)', NULL, 'Dubai City Tour', FALSE, NULL),

  -- Landmarks and attractions
  ('burj-khalifa',           200, 'burj khalifa|\m1(24|25|48)(th)?\M|level 1(24|25|48)', NULL, 'Burj Khalifa', FALSE, NULL),
  ('lost-chambers',          201, 'lost[- ]?chambers?',                       NULL, 'The Lost Chambers Aquarium', FALSE, NULL),
  ('dubai-aquarium',         202, 'aquarium|underwater ?zoo|penguin cove|\mdauz\M', NULL, 'Dubai Aquarium & Underwater Zoo', FALSE, NULL),
  ('dubai-frame',            203, 'dubai[- ]?frame',                          NULL, 'Dubai Frame', FALSE, NULL),
  ('global-village',         204, 'global village',                           NULL, 'Global Village', FALSE, NULL),
  ('miracle-garden',         205, 'miracle garden',                           NULL, 'Dubai Miracle Garden', FALSE, NULL),
  ('museum-of-the-future',   206, 'museum of the future|\mmotf\M',            NULL, 'Museum of the Future', FALSE, NULL),
  ('the-view-palm',          207, '^the view\M',                              NULL, 'The View at The Palm', FALSE, NULL),
  ('sky-views',              208, 'sky ?views?\M',                            NULL, 'Sky Views Dubai', FALSE, NULL),
  ('ain-dubai',              209, 'ain dubai',                                NULL, 'Ain Dubai', FALSE, NULL),
  ('qasr-al-watan',          210, 'qasr al watan',                            NULL, 'Qasr Al Watan', FALSE, NULL),
  ('louvre',                 211, 'louvre',                                   NULL, 'Louvre Abu Dhabi', FALSE, NULL),
  ('aya-universe',           212, 'aya universe',                             NULL, 'AYA Universe', FALSE, NULL),
  ('glow-garden',            213, 'glow garden|garden glow',                  NULL, 'Dubai Garden Glow', FALSE, NULL),
  ('butterfly-garden',       214, 'butterfly garden',                         NULL, 'Dubai Butterfly Garden', FALSE, NULL),
  ('green-planet',           215, 'green planet',                             NULL, 'The Green Planet', FALSE, NULL),
  ('dubai-safari-park',      216, 'safari park',                              NULL, 'Dubai Safari Park', FALSE, NULL),
  ('dolphinarium',           217, 'dolphin',                                  NULL, 'Dubai Dolphinarium', FALSE, NULL),
  ('ski-dubai',              218, 'ski dubai|^snow (classic|daycation|park|premium|plus)', NULL, 'Ski Dubai', FALSE, NULL),
  ('palm-monorail',          219, 'monorail',                                 NULL, 'The Palm Monorail', FALSE, NULL),
  ('fountain-lake-ride',     220, 'fountain',                                 NULL, 'Dubai Fountain Lake Ride', FALSE, NULL),
  ('madame-tussauds',        221, 'madame tussaud',                           NULL, 'Madame Tussauds', FALSE, NULL),
  ('museum-of-illusions',    222, 'museum of illusions?',                     NULL, 'Museum of Illusions', FALSE, NULL),
  ('kidzania',               223, 'kidzania',                                 NULL, 'KidZania', FALSE, NULL),
  ('teamlab',                224, 'teamlab',                                  NULL, 'teamLab Phenomena', FALSE, NULL),
  ('vr-park',                225, '\mvr ?park',                               NULL, 'VR Park', FALSE, NULL),
  ('ice-rink',               226, 'ice rink',                                 NULL, 'Dubai Ice Rink', FALSE, NULL),
  ('emirates-park-zoo',      227, 'emirates park zoo',                        NULL, 'Emirates Park Zoo', FALSE, NULL),
  ('expo',                   228, '\mexpo\M',                                 NULL, 'Expo City Dubai', FALSE, NULL),
  ('big-bus',                229, 'big bus',                                  NULL, 'Big Bus Tour', FALSE, NULL),
  ('helicopter',             230, 'helicopter',                               NULL, 'Helicopter Tour', FALSE, NULL),
  ('xline',                  231, 'xline|x-line|zip ?line',                   NULL, 'XLine Zipline', FALSE, NULL),
  ('al-shindagha',           232, 'shindagha',                                NULL, 'Al Shindagha Museum', FALSE, NULL),
  ('qasr-al-hosn',           233, 'qasr al hosn',                             NULL, 'Qasr Al Hosn', FALSE, NULL),
  ('burj-al-arab',           234, 'burj al arab',                             NULL, 'Burj Al Arab', FALSE, NULL),

  -- Theme and water parks (multi-park passes before single parks)
  ('dubai-parks-resorts',    300, 'legoland|motiongate|bollywood parks|real madrid world|\mdpr\M', NULL, 'Dubai Parks & Resorts', FALSE, NULL),
  ('dubai-parks-resorts-2',  300, '^dubai parks',                             NULL, 'Dubai Parks & Resorts', FALSE, NULL),
  ('dubai-parks-resorts-3',  300, 'bollywood park',                           NULL, 'Dubai Parks & Resorts', FALSE, NULL),
  ('yas-multi-park',         301, '\m\d ?-?day \d ?-?parks?\M|\m\d ?parks? pass|yas island \d park|yas \d ?day', NULL, 'Yas Island Multi-Park Pass', FALSE, NULL),
  ('img-worlds',             302, '\mimg\M',                                  NULL, 'IMG Worlds of Adventure', FALSE, NULL),
  ('atlantis-aquaventure',   303, 'aquaventure|^atlantis (day|super) pass|^atlantis aquaventure', NULL, 'Atlantis Aquaventure', FALSE, NULL),
  ('ferrari-world',          304, 'ferrari ?world|\mfwad\M',                  NULL, 'Ferrari World', FALSE, NULL),
  ('ferrari-world-2',        304, '^ferrari\M',                               NULL, 'Ferrari World', FALSE, NULL),
  ('warner-bros',            305, 'warner bros',                              NULL, 'Warner Bros. World', FALSE, NULL),
  ('yas-waterworld',         306, 'yas ?water ?world',                        NULL, 'Yas Waterworld', FALSE, NULL),
  ('seaworld',               307, 'sea ?world',                               NULL, 'SeaWorld Abu Dhabi', FALSE, NULL),
  ('wild-wadi',              308, 'wild ?wadi',                               NULL, 'Wild Wadi Waterpark', FALSE, NULL),
  ('laguna-waterpark',       309, 'laguna water ?park',                       NULL, 'Laguna Waterpark', FALSE, NULL),
  ('universal-singapore',    310, 'universal studios',                        NULL, 'Universal Studios Singapore', FALSE, NULL),

  -- Desert, cruises and water activities
  ('quad-buggy',             390, 'quad ?bike|dune buggy|\mbuggy\M|camel ride', NULL, 'Quad Bike & Dune Buggy', FALSE, NULL),
  ('desert-safari',          400, 'safari|camp use|camp charges|vip majlis|dune bashing', NULL, 'Desert Safari', FALSE, NULL),
  ('desert-dinner',          401, 'dinner in (the )?desert',                  NULL, 'Desert Safari', FALSE, NULL),
  ('desert-camp',            402, 'direct to camp|desert camp',               NULL, 'Desert Safari', FALSE, NULL),
  ('dhow-cruise',            450, 'dhow',                                     NULL, 'Dhow Cruise', FALSE, NULL),
  ('lotus-mega-yacht',       451, 'mega ?yacht|lotus',                        NULL, 'Lotus Mega Yacht Dinner Cruise', FALSE, NULL),
  ('yacht-charter',          452, 'yacht|\m\d+ ?feet\M',                      NULL, 'Yacht Charter', FALSE, NULL),
  ('jet-ski',                453, 'jet ?ski',                                 NULL, 'Jet Ski', FALSE, NULL),

  -- Visa and insurance
  ('visa',                   500, '\mvisas?\M',                               NULL, 'Visa', FALSE, NULL),
  ('travel-insurance',       501, 'insurance',                                NULL, 'Travel Insurance', FALSE, NULL)
ON CONFLICT (seed_key) DO NOTHING;

-- ── Every business line a customer booked, ranked ───────────────────────────
CREATE TABLE IF NOT EXISTS user_service_affinity (
  unified_id          BIGINT  NOT NULL,
  service             TEXT    NOT NULL,
  rank                INTEGER NOT NULL,               -- 1 = strongest for this customer
  bookings            INTEGER NOT NULL DEFAULT 0,
  revenue             NUMERIC(14,2) NOT NULL DEFAULT 0,
  cancelled           INTEGER NOT NULL DEFAULT 0,     -- bills fully cancelled
  distinct_products   INTEGER NOT NULL DEFAULT 0,
  first_booking_date  DATE,
  last_booking_date   DATE,
  affinity_score      NUMERIC(10,2) NOT NULL DEFAULT 0,
  built_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (unified_id, service)
);

-- ── Every product a customer booked, ranked ─────────────────────────────────
CREATE TABLE IF NOT EXISTS user_booked_product_affinity (
  unified_id          BIGINT  NOT NULL,
  product_key         TEXT    NOT NULL,               -- lower-case product name
  product_name        TEXT    NOT NULL,
  services            TEXT[]  NOT NULL,               -- business lines it was booked through
  rank                INTEGER NOT NULL,               -- 1 = strongest for this customer
  bookings            INTEGER NOT NULL DEFAULT 0,
  revenue             NUMERIC(14,2) NOT NULL DEFAULT 0,
  cancelled           INTEGER NOT NULL DEFAULT 0,
  first_booking_date  DATE,
  last_booking_date   DATE,
  affinity_score      NUMERIC(10,2) NOT NULL DEFAULT 0,
  built_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (unified_id, product_key)
);

-- ── One row per customer: contact snapshot, totals and the top 3 of each ────
-- bookings_<window> = non-cancelled bookings by booking_date back from the build date
-- (1d = since yesterday); drives the page's period filter.
CREATE TABLE IF NOT EXISTS user_affinity_top3 (
  unified_id          BIGINT  PRIMARY KEY,
  name                TEXT,
  email               TEXT,
  mobile              TEXT,
  country             TEXT,
  contact_type        TEXT    NOT NULL,               -- B2B | B2C | Affiliate (from unified_contacts)
  is_bulk             BOOLEAN NOT NULL DEFAULT FALSE,   -- 50+ bookings or Rayna staff email
  bookings_1d         INTEGER NOT NULL DEFAULT 0,
  bookings_7d         INTEGER NOT NULL DEFAULT 0,
  bookings_30d        INTEGER NOT NULL DEFAULT 0,
  bookings_90d        INTEGER NOT NULL DEFAULT 0,
  bookings_365d       INTEGER NOT NULL DEFAULT 0,
  bookings_all        INTEGER NOT NULL DEFAULT 0,
  revenue_all         NUMERIC(14,2) NOT NULL DEFAULT 0,
  first_booking_date  DATE,
  last_booking_date   DATE,
  affinity_score      NUMERIC(10,2) NOT NULL DEFAULT 0,
  service_count       INTEGER NOT NULL DEFAULT 0,
  product_count       INTEGER NOT NULL DEFAULT 0,
  service_1           TEXT,
  service_1_score     NUMERIC(10,2),
  service_1_bookings  INTEGER,
  service_2           TEXT,
  service_2_score     NUMERIC(10,2),
  service_2_bookings  INTEGER,
  service_3           TEXT,
  service_3_score     NUMERIC(10,2),
  service_3_bookings  INTEGER,
  product_1_key       TEXT,
  product_1_name      TEXT,
  product_1_score     NUMERIC(10,2),
  product_1_bookings  INTEGER,
  product_2_key       TEXT,
  product_2_name      TEXT,
  product_2_score     NUMERIC(10,2),
  product_2_bookings  INTEGER,
  product_3_key       TEXT,
  product_3_name      TEXT,
  product_3_score     NUMERIC(10,2),
  product_3_bookings  INTEGER,
  built_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uat3_rank    ON user_affinity_top3 (contact_type, is_bulk, affinity_score DESC);
CREATE INDEX IF NOT EXISTS idx_uat3_service ON user_affinity_top3 (service_1);
CREATE INDEX IF NOT EXISTS idx_uat3_product ON user_affinity_top3 (product_1_key);

-- ── Product catalog for pickers (page search, segment filter) ───────────────
CREATE TABLE IF NOT EXISTS affinity_products (
  product_key         TEXT    PRIMARY KEY,
  product_name        TEXT    NOT NULL,
  services            TEXT[]  NOT NULL,
  customers_rank1     INTEGER NOT NULL DEFAULT 0,
  customers_top3      INTEGER NOT NULL DEFAULT 0,
  customers_any       INTEGER NOT NULL DEFAULT 0,
  bookings            INTEGER NOT NULL DEFAULT 0,
  built_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
