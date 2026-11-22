-- Richer activity detail (activity page v3). List/table fields stay scalar; everything shown only on
-- the activity page lives in JSON.
--   location_name  Garmin's reverse-geocoded place name of the start ("Girona"); NULL for FIT uploads,
--                  indoor and GPS-less sessions (never invented).
--   start_lat/lng  start position in degrees (from the summary, the FIT session or the first GPS fix).
--   facts          JSON domain ActivityFacts: elevation loss/range, temperature, maxima, pauses, running
--                  dynamics, pedal balance, swim/row stroke figures, training effect label, device and
--                  sensors. Written on ingest (device data); never touched by metric recomputes.
--   swim_lengths   JSON domain SwimLength[] (pool swims: every length).
ALTER TABLE activities ADD COLUMN location_name TEXT;
ALTER TABLE activities ADD COLUMN start_lat REAL;
ALTER TABLE activities ADD COLUMN start_lng REAL;
ALTER TABLE activities ADD COLUMN facts TEXT NOT NULL DEFAULT '{}';
ALTER TABLE activities ADD COLUMN swim_lengths TEXT;
