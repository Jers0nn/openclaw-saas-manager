-- DEVELOPMENT SEED DATA ONLY — NEVER LOAD INTO PRODUCTION.
--
-- Every record is fictitious and clearly marked:
--   * customer names start with "[DEMO]"
--   * emails use the reserved ".test" TLD (RFC 2606), which can never be delivered
--   * metadata contains {"seed": "dev"} so rows can be identified and removed
--
-- Fixed UUIDs keep the data predictable for manual testing. The script is
-- idempotent: re-running it does not duplicate rows.

INSERT INTO customers (id, name, email, status, metadata, created_at) VALUES
  ('00000000-0000-4000-8000-000000000001', '[DEMO] Acme Corp',     'billing@acme.demo.test',   'active',   '{"seed":"dev"}', '2026-01-15T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000002', '[DEMO] Globex Ltd',    'admin@globex.demo.test',   'active',   '{"seed":"dev"}', '2026-03-02T09:30:00Z'),
  ('00000000-0000-4000-8000-000000000003', '[DEMO] Initech',       'ops@initech.demo.test',    'inactive', '{"seed":"dev"}', '2026-05-20T14:45:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO subscriptions (id, customer_id, plan_code, status, quantity, current_period_start, current_period_end, canceled_at, metadata) VALUES
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'demo-pro',     'active',   5, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', NULL,                   '{"seed":"dev"}'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000002', 'demo-starter', 'trialing', 1, '2026-09-25T00:00:00Z', '2026-10-09T00:00:00Z', NULL,                   '{"seed":"dev"}'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000003', 'demo-starter', 'canceled', 1, '2026-06-01T00:00:00Z', '2026-07-01T00:00:00Z', '2026-06-20T12:00:00Z', '{"seed":"dev"}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO usage_records (customer_id, subscription_id, metric, quantity, occurred_at, idempotency_key, metadata) VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'api_calls',  1200, '2026-10-02T08:00:00Z', 'seed-dev-1', '{"seed":"dev"}'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'api_calls',   800, '2026-10-05T08:00:00Z', 'seed-dev-2', '{"seed":"dev"}'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'storage_gb', 12.5, '2026-10-05T08:00:00Z', 'seed-dev-3', '{"seed":"dev"}'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'api_calls',   950, '2026-09-12T08:00:00Z', 'seed-dev-4', '{"seed":"dev"}'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000102', 'api_calls',    40, '2026-10-01T16:00:00Z', 'seed-dev-5', '{"seed":"dev"}')
ON CONFLICT (idempotency_key) DO NOTHING;
