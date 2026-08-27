ALTER TABLE activation_operations ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1;

CREATE TABLE signing_keys (
  environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
  key_id TEXT NOT NULL,
  public_key_sha256 TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('current', 'retired')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (environment, key_id)
);

CREATE TABLE request_rate_limits (
  environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
  dimension TEXT NOT NULL CHECK (dimension IN ('network', 'license')),
  subject_sha256 TEXT NOT NULL,
  route TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (environment, dimension, subject_sha256, route, window_started_at)
);

CREATE TABLE operational_audit (
  correlation_id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
  action TEXT NOT NULL CHECK (action IN ('activate', 'validate', 'deactivate')),
  outcome TEXT NOT NULL,
  network_sha256 TEXT NOT NULL,
  license_sha256 TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX idx_rate_limit_window ON request_rate_limits(window_started_at);
CREATE INDEX idx_operational_audit_time ON operational_audit(occurred_at);
