-- Cadence schema. Columns mirror packages/core/src/domain.ts in snake_case.
-- JSON columns are TEXT; booleans are INTEGER 0/1; dates are 'YYYY-MM-DD'; instants are ISO-8601 UTC.

-- ── single-user account ────────────────────────────────────────────────
CREATE TABLE auth (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,          -- base64 PBKDF2-SHA256
  salt          TEXT NOT NULL,          -- base64
  iterations    INTEGER NOT NULL,
  session_epoch INTEGER NOT NULL DEFAULT 1, -- bump to invalidate all sessions
  created_at    TEXT NOT NULL
);

CREATE TABLE settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  data       TEXT NOT NULL,             -- JSON: domain Settings
  updated_at TEXT NOT NULL
);

-- Effective-dated thresholds (domain Threshold).
CREATE TABLE thresholds (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  sport          TEXT NOT NULL,         -- Sport or 'all'
  value          REAL NOT NULL,
  effective_from TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'manual',
  note           TEXT
);
CREATE INDEX thresholds_lookup ON thresholds (kind, sport, effective_from);

-- ── planned workouts ───────────────────────────────────────────────────
CREATE TABLE workouts (
  id                   TEXT PRIMARY KEY,
  date                 TEXT NOT NULL,
  start_time           TEXT,
  sport                TEXT NOT NULL,
  sub_sport            TEXT,
  title                TEXT NOT NULL,
  description          TEXT,
  pre_note             TEXT,
  planned_duration_sec REAL,
  planned_distance_m   REAL,
  planned_load         REAL,
  planned_if           REAL,
  structure            TEXT,            -- JSON WorkoutStructure
  sparkline            TEXT,            -- JSON number[] derived from structure
  is_key               INTEGER NOT NULL DEFAULT 0,
  intensity            TEXT NOT NULL DEFAULT 'endurance',
  tags                 TEXT NOT NULL DEFAULT '[]',
  environment          TEXT NOT NULL DEFAULT 'any',
  template_id          TEXT,
  series_id            TEXT,
  event_id             TEXT,
  paired_activity_id   TEXT,
  pair_manual          INTEGER NOT NULL DEFAULT 0, -- 1 = paired/unpaired by the user; auto-pairing must not touch
  status               TEXT NOT NULL DEFAULT 'planned',
  skip_reason          TEXT,
  garmin_workout_id    TEXT,
  garmin_schedule_id   TEXT,
  garmin_sync_state    TEXT NOT NULL DEFAULT 'none',
  garmin_pushed_at     TEXT,
  garmin_error         TEXT,
  garmin_fingerprint   TEXT,            -- hash of what was last pushed (detects edits)
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX workouts_date ON workouts (date);
CREATE INDEX workouts_series ON workouts (series_id);
CREATE INDEX workouts_template ON workouts (template_id);

CREATE TABLE templates (
  id                   TEXT PRIMARY KEY,
  sport                TEXT NOT NULL,
  sub_sport            TEXT,
  title                TEXT NOT NULL,
  description          TEXT,
  planned_duration_sec REAL,
  planned_distance_m   REAL,
  planned_load         REAL,
  planned_if           REAL,
  structure            TEXT,
  sparkline            TEXT,
  intensity            TEXT NOT NULL DEFAULT 'endurance',
  tags                 TEXT NOT NULL DEFAULT '[]',
  folder               TEXT,
  usage_count          INTEGER NOT NULL DEFAULT 0,
  last_used_at         TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX templates_sport ON templates (sport);

-- ── completed activities ───────────────────────────────────────────────
CREATE TABLE activities (
  id                  TEXT PRIMARY KEY,
  source              TEXT NOT NULL,     -- garmin | upload | manual | demo
  garmin_activity_id  TEXT UNIQUE,
  garmin_type_key     TEXT,
  started_at          TEXT NOT NULL,
  utc_offset_min      INTEGER NOT NULL DEFAULT 0,
  local_date          TEXT NOT NULL,
  sport               TEXT NOT NULL,
  sub_sport           TEXT,
  title               TEXT NOT NULL,
  duration_sec        REAL NOT NULL,
  moving_sec          REAL NOT NULL,
  distance_m          REAL,
  elevation_gain_m    REAL,
  load                REAL NOT NULL DEFAULT 0,
  load_source         TEXT NOT NULL DEFAULT 'duration',
  load_manual         REAL,              -- user override; wins over computed load when set
  intensity_factor    REAL,
  avg_hr              REAL,
  max_hr              REAL,
  avg_power           REAL,
  weighted_power      REAL,
  max_power           REAL,
  avg_speed_mps       REAL,
  adjusted_speed_mps  REAL,
  avg_cadence         REAL,
  calories            REAL,
  work_kj             REAL,
  variability         REAL,
  efficiency          REAL,
  decoupling_pct      REAL,
  aerobic_effect      REAL,
  anaerobic_effect    REAL,
  pool_length_m       REAL,
  strokes             REAL,
  avg_swolf           REAL,
  total_sets          REAL,
  total_reps          REAL,
  volume_kg           REAL,
  intensity_auto      TEXT NOT NULL DEFAULT 'endurance',
  intensity_override  TEXT,
  is_key              INTEGER NOT NULL DEFAULT 0,
  rpe                 INTEGER,
  feel                INTEGER,
  post_note           TEXT,
  tags                TEXT NOT NULL DEFAULT '[]',
  paired_workout_id   TEXT,
  pair_manual         INTEGER NOT NULL DEFAULT 0,
  has_streams         INTEGER NOT NULL DEFAULT 0,
  sparkline           TEXT,              -- JSON number[]
  laps                TEXT NOT NULL DEFAULT '[]',   -- JSON Lap[]
  zones               TEXT NOT NULL DEFAULT '{}',   -- JSON { hr?, power?, pace? }
  peaks               TEXT NOT NULL DEFAULT '{}',   -- JSON { power?, hr?, speed?, efforts? }
  strength_sets       TEXT,              -- JSON StrengthSet[]
  thresholds_used     TEXT NOT NULL DEFAULT '{}',   -- JSON ThresholdSnapshot
  summary_hash        TEXT,              -- hash of the upstream summary (detects edits on Garmin)
  metrics_version     INTEGER NOT NULL DEFAULT 1,
  deleted_at          TEXT,              -- soft delete so a re-sync does not resurrect it
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX activities_date ON activities (local_date);
CREATE INDEX activities_sport_date ON activities (sport, local_date);
CREATE INDEX activities_started ON activities (started_at);

-- 1 Hz streams: gzip-compressed columnar JSON (domain ActivityStreams). One row per activity.
CREATE TABLE activity_streams (
  activity_id TEXT PRIMARY KEY REFERENCES activities (id) ON DELETE CASCADE,
  data        BLOB NOT NULL,
  samples     INTEGER NOT NULL,
  bytes       INTEGER NOT NULL
);

-- Original FIT file when small enough (< 1.5 MB); lets metrics be recomputed from source.
CREATE TABLE activity_files (
  activity_id TEXT PRIMARY KEY REFERENCES activities (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'fit',
  data        BLOB NOT NULL,
  bytes       INTEGER NOT NULL
);

-- ── calendar furniture ─────────────────────────────────────────────────
CREATE TABLE events (
  id                 TEXT PRIMARY KEY,
  date               TEXT NOT NULL,
  name               TEXT NOT NULL,
  priority           TEXT NOT NULL DEFAULT 'B',
  sport              TEXT,
  distance_m         REAL,
  goal               TEXT,
  location           TEXT,
  note               TEXT,
  result_activity_id TEXT
);
CREATE INDEX events_date ON events (date);

CREATE TABLE phases (
  id                 TEXT PRIMARY KEY,
  type               TEXT NOT NULL,
  label              TEXT NOT NULL,
  start_date         TEXT NOT NULL,
  end_date           TEXT NOT NULL,
  weekly_load_target REAL
);
CREATE INDEX phases_range ON phases (start_date, end_date);

CREATE TABLE day_markers (
  id       TEXT PRIMARY KEY,
  type     TEXT NOT NULL,
  date     TEXT NOT NULL,
  end_date TEXT,
  label    TEXT
);
CREATE INDEX day_markers_date ON day_markers (date);

CREATE TABLE day_notes (
  date       TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE week_notes (
  iso_week     TEXT PRIMARY KEY,
  body         TEXT NOT NULL DEFAULT '',
  target_hours REAL,
  target_load  REAL,
  updated_at   TEXT NOT NULL
);

-- Device values come from Garmin; feel/soreness/note are manual check-ins and are never
-- overwritten by a sync (upserts must only touch the device columns).
CREATE TABLE wellness_days (
  date         TEXT PRIMARY KEY,
  hrv_ms       REAL,
  hrv_status   TEXT,
  resting_hr   REAL,
  sleep_sec    REAL,
  sleep_score  REAL,
  weight_kg    REAL,
  body_battery REAL,
  stress       REAL,
  readiness    REAL,
  vo2max       REAL,
  feel         INTEGER,
  soreness     INTEGER,
  note         TEXT,
  updated_at   TEXT NOT NULL
);

-- ── Garmin connection & sync ───────────────────────────────────────────
CREATE TABLE garmin_auth (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  credentials_enc TEXT NOT NULL,        -- AES-GCM(base64) of the GarminCredentials JSON
  display_name    TEXT,
  state           TEXT NOT NULL DEFAULT 'connected',
  last_sync_at    TEXT,
  last_error      TEXT,
  updated_at      TEXT NOT NULL
);

-- Key/value cursors: incremental watermark, backfill cursor, wellness watermark, …
CREATE TABLE sync_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,             -- JSON
  updated_at TEXT NOT NULL
);

CREATE TABLE sync_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  summary     TEXT NOT NULL,
  detail      TEXT,
  duration_ms INTEGER
);
CREATE INDEX sync_log_at ON sync_log (at DESC);
