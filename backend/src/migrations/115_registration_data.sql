-- 115_registration_data.sql
-- Staging tables for registration_data.xlsx (3 sheets → 3 tables).
-- Column names match the sheet headers EXACTLY (quoted to preserve camelCase). Source columns
-- are TEXT (import-safe); each table also carries 5 standard meta columns:
--   id (PK), unified_id (link to unified_contacts), created_at, updated_at, synced_at.

-- ── agent_data (sheet 1) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_data (
  id                        BIGSERIAL PRIMARY KEY,
  "websiteId"               TEXT,
  "websiteName"             TEXT,
  "isWhiteLabelMapped"      TEXT,
  "whiteLabelParentAgentId" TEXT,
  "AgentID"                 TEXT,
  "ParentId"                TEXT,
  "AgentCode"               TEXT,
  "AgentName"               TEXT,
  "CompanyName"             TEXT,
  "UserName"                TEXT,
  "email"                   TEXT,
  "MobileNo"                TEXT,
  "PhoneNo"                 TEXT,
  "AgentType"               TEXT,
  "SelectCurrencyID"        TEXT,
  "registrationDate"        TEXT,
  unified_id                BIGINT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ,
  synced_at                 TIMESTAMPTZ
);

-- ── affiliate_data (sheet 2) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS affiliate_data (
  id                    BIGSERIAL PRIMARY KEY,
  "affiliateId"         TEXT,
  "affiliateName"       TEXT,
  "email"               TEXT,
  "ParentId"            TEXT,
  "affiliateType"       TEXT,
  "mainAffiliateId"     TEXT,
  "mainAffiliateName"   TEXT,
  "mainAffiliateEmail"  TEXT,
  "subAffiliateCount"   TEXT,
  "isOrphaned"          TEXT,
  "CityId"              TEXT,
  "cityName"            TEXT,
  "countryId"           TEXT,
  "countryName"         TEXT,
  "countryIso"          TEXT,
  "StatusFlag"          TEXT,
  "isVerifyEmail"       TEXT,
  "IsAuthorise"         TEXT,
  "emailStatus"         TEXT,
  "authorisationStatus" TEXT,
  "profitCenterId"      TEXT,
  "registrationDate"    TEXT,
  unified_id            BIGINT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ,
  synced_at             TIMESTAMPTZ
);

-- ── guestuser_data (sheet 3) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS 
 (
  id                   BIGSERIAL PRIMARY KEY,
  "websiteId"          TEXT,
  "websiteName"        TEXT,
  "websiteSource"      TEXT,
  "GuestUserId"        TEXT,
  "AgentID"            TEXT,
  "EmailId"            TEXT,
  "email"              TEXT,
  "guestName"          TEXT,
  "contactNumber"      TEXT,
  "mobileNo"           TEXT,
  "hasContactNumber"   TEXT,
  "countryId"          TEXT,
  "countryName"        TEXT,
  "countryIso"         TEXT,
  "isdCode"            TEXT,
  "nationality"        TEXT,
  "doSendPromotionMail" TEXT,
  "dateOfBirth"        TEXT,
  "registrationDate"   TEXT,
  unified_id           BIGINT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ,
  synced_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_data_email      ON agent_data ("email");
CREATE INDEX IF NOT EXISTS idx_agent_data_unified    ON agent_data (unified_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_data_email  ON affiliate_data ("email");
CREATE INDEX IF NOT EXISTS idx_affiliate_data_unified ON affiliate_data (unified_id);
CREATE INDEX IF NOT EXISTS idx_guestuser_data_email  ON guestuser_data ("email");
CREATE INDEX IF NOT EXISTS idx_guestuser_data_unified ON guestuser_data (unified_id);
