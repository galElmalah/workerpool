-- Title last received from the upstream source (Garmin / FIT). Re-ingest overwrites
-- `activities.title` only while it still equals this value, so athlete renames survive syncs.
ALTER TABLE activities ADD COLUMN upstream_title TEXT;
