-- is_on_trip flag on unified_contacts. Allows the segmentation-tree query
-- to count ON_TRIP contacts independently of the booking_status waterfall
-- (so a contact with FUTURE_TRAVEL today AND a trip in the last 7 days
-- shows up in BOTH FUTURE_TRAVEL and ON_TRIP counts).
--
-- Without this column, getSegmentationTree throws 500 because UnifiedContactService
-- references is_on_trip when computing the live ON_TRIP counter.

ALTER TABLE unified_contacts
  ADD COLUMN IF NOT EXISTS is_on_trip BOOLEAN NOT NULL DEFAULT false;

-- Backfill from existing booking_status. Subsequent recomputeSegmentation
-- calls will keep the flag in sync.
UPDATE unified_contacts
   SET is_on_trip = (booking_status = 'ON_TRIP')
 WHERE is_on_trip IS DISTINCT FROM (booking_status = 'ON_TRIP');

CREATE INDEX IF NOT EXISTS idx_unified_contacts_is_on_trip
  ON unified_contacts (is_on_trip) WHERE is_on_trip = true;
