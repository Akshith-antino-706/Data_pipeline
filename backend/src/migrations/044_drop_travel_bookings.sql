-- Drop legacy travel_bookings table and related columns from unified_contacts
-- All booking data now comes from Rayna API tables: rayna_tours, rayna_hotels, rayna_visas, rayna_flights

DROP TABLE IF EXISTS travel_bookings CASCADE;

ALTER TABLE unified_contacts
  DROP COLUMN IF EXISTS total_travel_bookings,
  DROP COLUMN IF EXISTS travel_types,
  DROP COLUMN IF EXISTS travel_services,
  DROP COLUMN IF EXISTS first_travel_at,
  DROP COLUMN IF EXISTS last_travel_at;
