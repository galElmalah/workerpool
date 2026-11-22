-- Native clients (iOS app + widgets) authenticate with long-lived, revocable device tokens
-- (docs/MOBILE_API.md). Only the SHA-256 hash of a token is stored (base64url); revoking a device
-- deletes its row. Changing the passphrase deletes every row.
CREATE TABLE devices (
  id           TEXT PRIMARY KEY,          -- 'dev_…'
  name         TEXT NOT NULL,
  platform     TEXT NOT NULL,             -- 'ios' | 'other'
  token_hash   TEXT NOT NULL UNIQUE,      -- base64url SHA-256 of the full token string
  created_at   TEXT NOT NULL,
  last_used_at TEXT                       -- written at most once per hour
);
