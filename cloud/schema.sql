-- Cloud save (recovery code) storage. The code itself is never stored, only its SHA-256.
CREATE TABLE IF NOT EXISTS saves (
  code_hash TEXT PRIMARY KEY,
  body BLOB NOT NULL,          -- gzip of the exact JSON text the client sent
  raw_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL, -- epoch ms
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS saves_expires ON saves (expires_at);

-- Fixed-window request counters keyed by a salted hash of the client address.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
