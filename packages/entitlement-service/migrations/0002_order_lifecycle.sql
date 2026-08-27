ALTER TABLE activation_bindings ADD COLUMN vendor_order_id TEXT;

ALTER TABLE license_lifecycle ADD COLUMN vendor_order_id TEXT;

ALTER TABLE webhook_inbox ADD COLUMN vendor_order_id TEXT;

UPDATE activation_bindings SET vendor_order_id = '' WHERE vendor_order_id IS NULL;

CREATE INDEX idx_bindings_order ON activation_bindings(environment, vendor_order_id);

CREATE TABLE order_lifecycle (
  environment TEXT NOT NULL CHECK (environment IN ('test', 'production')),
  vendor_order_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'failed', 'paid', 'refunded', 'partial_refund', 'fraudulent')),
  vendor_updated_at TEXT NOT NULL,
  event_digest TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (environment, vendor_order_id)
);

CREATE INDEX idx_webhook_order ON webhook_inbox(environment, vendor_order_id, vendor_updated_at);
