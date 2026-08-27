PRAGMA foreign_keys = ON;

CREATE TABLE activation_operations (
  operation_id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
  license_digest TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'SUCCEEDED', 'FAILED', 'UNCERTAIN')),
  lease_token TEXT,
  lease_expires_at TEXT,
  response_json TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (environment, license_digest, installation_id)
);

CREATE TABLE activation_bindings (
  binding_id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
  license_digest TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  entitlement_id TEXT NOT NULL UNIQUE,
  vendor_license_id TEXT NOT NULL,
  activation_instance_id TEXT NOT NULL,
  masked_email TEXT NOT NULL,
  signed_entitlement TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  last_validated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (environment, license_digest, installation_id),
  UNIQUE (environment, activation_instance_id)
);

CREATE TABLE license_lifecycle (
  environment TEXT NOT NULL,
  vendor_license_id TEXT NOT NULL,
  status TEXT NOT NULL,
  vendor_updated_at TEXT NOT NULL,
  event_digest TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (environment, vendor_license_id)
);

CREATE TABLE webhook_inbox (
  event_identity TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  event_name TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  vendor_license_id TEXT,
  vendor_updated_at TEXT,
  result TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (environment, event_name, body_sha256)
);

CREATE INDEX idx_activation_operations_lease ON activation_operations(state, lease_expires_at);
CREATE INDEX idx_bindings_license ON activation_bindings(environment, vendor_license_id);
CREATE INDEX idx_webhook_license ON webhook_inbox(environment, vendor_license_id, vendor_updated_at);
