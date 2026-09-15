-- Producer restructured `data` into nested objects: user{}, giveaway{}, prize{}, winner{}, offer{}.
-- Realign giveaway_events columns to the leaf fields.
--   data.user.name       → name
--   data.giveaway.title  → giveaway
--   data.giveaway.image  → giveaway_image
--   data.giveaway.mechanic → mechanic
--   data.prize.name      → prize
--   data.prize.image     → prize_image
--   data.prize.type      → prize_type
--   data.prize.value     → value
--   data.winner.rank     → rank
--   data.winner.code     → code   (winner redemption code)
--   data.offer.name      → offer
--   data.offer.code      → offer_code
--   data.offer.expiry    → expiry
ALTER TABLE giveaway_events ADD COLUMN IF NOT EXISTS giveaway_image TEXT;
ALTER TABLE giveaway_events ADD COLUMN IF NOT EXISTS prize_image    TEXT;
ALTER TABLE giveaway_events ADD COLUMN IF NOT EXISTS offer_code     TEXT;
-- superseded by the two proper image columns above
ALTER TABLE giveaway_events DROP COLUMN IF EXISTS img;
ALTER TABLE giveaway_events DROP COLUMN IF EXISTS giveaway_banner;
