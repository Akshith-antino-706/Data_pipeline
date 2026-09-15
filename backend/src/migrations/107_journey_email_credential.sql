-- Journey-level email sender selection.
-- 'default'  → AWS Email API (ChatheadEmailChannel, explore@promotions.raynatours.com)
-- 'giveaway' → giveaway SMTP (nodemailer, giveaways@promotions.raynatours.com)
ALTER TABLE journey_flows
  ADD COLUMN IF NOT EXISTS email_credential VARCHAR(20) NOT NULL DEFAULT 'default';
