-- Migration: allow trips without destination and add destination_pending flag
-- Timestamp: 2026-08-17

BEGIN;

-- 1) Make destination columns nullable
ALTER TABLE trips
  ALTER COLUMN destination_lat DROP NOT NULL;

ALTER TABLE trips
  ALTER COLUMN destination_lng DROP NOT NULL;

ALTER TABLE trips
  ALTER COLUMN destination_address DROP NOT NULL;

-- 2) Add destination_pending boolean flag with default false
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS destination_pending boolean NOT NULL DEFAULT false;

-- 3) Normalize existing values: if destination fields contain empty strings or placeholder '0', set to NULL
-- (Adjust these conditions if your dataset uses different placeholders)
UPDATE trips
SET destination_lat = NULL
WHERE destination_lat = '0' OR destination_lat = '';

UPDATE trips
SET destination_lng = NULL
WHERE destination_lng = '0' OR destination_lng = '';

UPDATE trips
SET destination_address = NULL
WHERE destination_address = '';

-- 4) Mark destination_pending for trips missing destination info
UPDATE trips
SET destination_pending = true
WHERE (destination_lat IS NULL OR destination_lng IS NULL) AND (destination_address IS NULL OR destination_address = '');

COMMIT;
