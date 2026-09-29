BEGIN;

ALTER TABLE trips ALTER COLUMN estimated_price DROP NOT NULL;
ALTER TABLE trips ALTER COLUMN estimated_price DROP DEFAULT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS minimum_fare numeric;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS passenger_offer numeric;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS driver_counteroffer numeric;

COMMIT;
