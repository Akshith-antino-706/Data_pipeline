-- 040: Holidays calendar + occasion segments

-- ── Holidays Calendar ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS holidays_calendar (
  id              BIGSERIAL PRIMARY KEY,
  holiday_name    TEXT NOT NULL,
  holiday_date    DATE NOT NULL,
  country         TEXT NOT NULL,
  region          TEXT,
  type            TEXT DEFAULT 'public',
  offer_tag       TEXT,
  offer_description TEXT,
  entry_days      INTEGER DEFAULT 14,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(holiday_name, holiday_date, country)
);

CREATE INDEX IF NOT EXISTS idx_hc_date ON holidays_calendar(holiday_date);
CREATE INDEX IF NOT EXISTS idx_hc_country ON holidays_calendar(country);
CREATE INDEX IF NOT EXISTS idx_hc_active ON holidays_calendar(is_active) WHERE is_active = true;

-- ── User Occasion Assignments ──────────────────────────────────
CREATE TABLE IF NOT EXISTS user_occasions (
  id              BIGSERIAL PRIMARY KEY,
  unified_id      INTEGER NOT NULL,
  holiday_id      BIGINT NOT NULL REFERENCES holidays_calendar(id),
  entered_at      TIMESTAMPTZ DEFAULT NOW(),
  exited_at       TIMESTAMPTZ,
  status          TEXT DEFAULT 'active',
  UNIQUE(unified_id, holiday_id)
);

CREATE INDEX IF NOT EXISTS idx_uo_unified ON user_occasions(unified_id);
CREATE INDEX IF NOT EXISTS idx_uo_status ON user_occasions(status);
CREATE INDEX IF NOT EXISTS idx_uo_holiday ON user_occasions(holiday_id);

-- ═══════════════════════════════════════════════════════════════
-- INDIA — Major Festivals & Holidays (2026-2027)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO holidays_calendar (holiday_name, holiday_date, country, type, offer_tag, offer_description) VALUES
-- 2026
('Republic Day',        '2026-01-26', 'India', 'national',  'REPUBLIC26',    'Celebrate Republic Day — special travel deals across India'),
('Holi',                '2026-03-17', 'India', 'festival',  'HOLI26',        'Holi Festival specials — colorful travel experiences'),
('Eid ul-Fitr',         '2026-03-21', 'India', 'religious', 'EID26',         'Eid celebrations — family travel packages'),
('Ram Navami',          '2026-04-06', 'India', 'religious', 'RAMNAVAMI26',   'Ram Navami — spiritual travel experiences'),
('Independence Day',    '2026-08-15', 'India', 'national',  'FREEDOM26',     'Independence Day — explore incredible India'),
('Ganesh Chaturthi',    '2026-08-22', 'India', 'festival',  'GANESH26',      'Ganesh Chaturthi — festive travel deals'),
('Navratri',            '2026-10-01', 'India', 'festival',  'NAVRATRI26',    'Navratri specials — 9 nights of celebration'),
('Dussehra',            '2026-10-10', 'India', 'festival',  'DUSSEHRA26',    'Dussehra — victory celebrations & travel'),
('Diwali',              '2026-10-29', 'India', 'festival',  'DIWALI26',      'Diwali Festival of Lights — exclusive holiday packages & festive offers'),
('Christmas',           '2026-12-25', 'India', 'festival',  'XMAS26',        'Christmas travel specials'),
('New Year',            '2026-12-31', 'India', 'festival',  'NEWYEAR27',     'Ring in 2027 — New Year celebration packages'),
-- 2027
('Republic Day',        '2027-01-26', 'India', 'national',  'REPUBLIC27',    'Republic Day 2027 — travel deals'),
('Holi',                '2027-03-07', 'India', 'festival',  'HOLI27',        'Holi 2027 — colorful travel experiences'),
('Diwali',              '2027-10-18', 'India', 'festival',  'DIWALI27',      'Diwali 2027 — Festival of Lights packages'),

-- ═══════════════════════════════════════════════════════════════
-- UAE — Public Holidays & Events (2026-2027)
-- ═══════════════════════════════════════════════════════════════
('New Year',            '2026-01-01', 'United Arab Emirates', 'public',   'UAENY26',       'New Year in Dubai — spectacular fireworks & events'),
('Eid ul-Fitr',         '2026-03-21', 'United Arab Emirates', 'public',   'UAEEID26',      'Eid holidays — Dubai celebrations & family activities'),
('Eid ul-Adha',         '2026-05-28', 'United Arab Emirates', 'public',   'UAEADHA26',     'Eid Al Adha — special holiday experiences in UAE'),
('Islamic New Year',    '2026-06-17', 'United Arab Emirates', 'public',   'UAEISNY26',     'Islamic New Year — cultural experiences'),
('Prophet Birthday',    '2026-08-26', 'United Arab Emirates', 'public',   'UAEMAWLID26',   'Mawlid celebrations — heritage experiences'),
('Commemoration Day',   '2026-11-30', 'United Arab Emirates', 'national', 'UAECOMM26',     'Commemoration Day — honour & remember'),
('National Day',        '2026-12-02', 'United Arab Emirates', 'national', 'UAENAT26',      'UAE National Day — biggest celebration of the year'),
('Dubai Shopping Festival', '2026-12-15', 'United Arab Emirates', 'event', 'DSF26',        'Dubai Shopping Festival — mega deals & entertainment'),
('New Year',            '2027-01-01', 'United Arab Emirates', 'public',   'UAENY27',       'New Year 2027 in Dubai'),
('Dubai Food Festival', '2027-02-25', 'United Arab Emirates', 'event',    'DFF27',         'Dubai Food Festival — culinary experiences'),

-- ═══════════════════════════════════════════════════════════════
-- WORLD — Major International Holidays
-- ═══════════════════════════════════════════════════════════════
-- UK
('Easter',              '2026-04-05', 'United Kingdom', 'public',   'UKEASTER26',    'Easter holiday — spring travel deals'),
('Summer Bank Holiday', '2026-08-31', 'United Kingdom', 'public',   'UKSUMMER26',    'Bank Holiday — Dubai summer escapes'),
('Christmas',           '2026-12-25', 'United Kingdom', 'public',   'UKXMAS26',      'Christmas getaway — Dubai winter sun'),
('Boxing Day',          '2026-12-26', 'United Kingdom', 'public',   'UKBOXING26',    'Boxing Day deals — Dubai travel bargains'),

-- Russia
('New Year Holiday',    '2026-01-01', 'Russia', 'public',   'RUNY26',        'Russian New Year — Dubai holiday packages'),
('Defender Day',        '2026-02-23', 'Russia', 'public',   'RUDEF26',       'February break — warm Dubai getaway'),
('International Women Day', '2026-03-08', 'Russia', 'public', 'RUIWD26',     'March 8 — special travel for her'),
('May Day',             '2026-05-01', 'Russia', 'public',   'RUMAY26',       'May holidays — Dubai spring deals'),

-- Saudi Arabia
('Eid ul-Fitr',         '2026-03-21', 'Saudi Arabia', 'public',   'SAEID26',   'Eid holidays — Dubai next door'),
('Eid ul-Adha',         '2026-05-28', 'Saudi Arabia', 'public',   'SAADHA26',  'Eid Al Adha — short trip to Dubai'),
('Saudi National Day',  '2026-09-23', 'Saudi Arabia', 'national', 'SANAT26',   'Saudi National Day — celebrate in Dubai'),

-- Germany
('Easter',              '2026-04-05', 'Germany', 'public',   'DEEASTER26',   'Osterferien — Dubai sun escape'),
('German Unity Day',    '2026-10-03', 'Germany', 'public',   'DEUNITY26',    'Autumn break — Dubai holiday deals'),
('Christmas',           '2026-12-25', 'Germany', 'public',   'DEXMAS26',     'Weihnachten in Dubai — winter sun'),

-- USA
('Independence Day',    '2026-07-04', 'United States', 'national', 'US4TH26',  'July 4th — Dubai summer adventure'),
('Thanksgiving',        '2026-11-26', 'United States', 'public',   'USTHANKS26', 'Thanksgiving break — Dubai travel deals'),
('Christmas',           '2026-12-25', 'United States', 'public',   'USXMAS26',   'Christmas vacation — Dubai holiday escape'),

-- China
('Chinese New Year',    '2026-02-17', 'China', 'festival',  'CNY26',         'Chinese New Year — Dubai celebration packages'),
('Golden Week',         '2026-10-01', 'China', 'public',    'CNGOLD26',      'Golden Week — Dubai luxury experiences'),

-- Pakistan
('Pakistan Day',        '2026-03-23', 'Pakistan', 'national', 'PKDAY26',     'Pakistan Day — Dubai travel deals'),
('Eid ul-Fitr',         '2026-03-21', 'Pakistan', 'public',   'PKEID26',     'Eid holidays — family trip to Dubai'),
('Eid ul-Adha',         '2026-05-28', 'Pakistan', 'public',   'PKADHA26',    'Eid Al Adha — Dubai experiences'),
('Independence Day',    '2026-08-14', 'Pakistan', 'national', 'PKFREE26',    'Independence Day — Dubai celebration'),

-- Philippines
('Holy Week',           '2026-04-02', 'Philippines', 'public',  'PHHOLY26',   'Holy Week break — Dubai adventure'),
('Independence Day',    '2026-06-12', 'Philippines', 'national', 'PHFREE26',  'Philippine Independence — Dubai deals'),
('Christmas',           '2026-12-25', 'Philippines', 'public',  'PHXMAS26',   'Christmas — Dubai winter package')

ON CONFLICT (holiday_name, holiday_date, country) DO NOTHING;
