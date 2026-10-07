-- Up Migration

-- Initial SaaS Manager schema: customers, subscriptions and usage records.
--
-- Design notes (for future billing / plans / invoices / payments / analytics):
-- * Primary keys are UUIDs so records can be exposed safely in URLs and merged
--   across environments without collisions.
-- * subscriptions.plan_code is a plain text code today. A future `plans` table
--   can use the same code as its natural key and add a foreign key without
--   rewriting existing rows.
-- * usage_records is an append-only ledger of metered events. Aggregations for
--   billing and analytics are computed from it (or from future rollup tables).
-- * Every table carries created_at / updated_at timestamps and a free-form
--   `metadata` JSONB column for integration identifiers (e.g. a payment
--   provider's customer id) without schema changes.
-- * Requires PostgreSQL 13+ (gen_random_uuid() is built in; no extension).

CREATE TABLE customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  email       text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  status      text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'inactive')),
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Emails are unique regardless of letter case.
CREATE UNIQUE INDEX customers_email_lower_key ON customers (lower(email));
CREATE INDEX customers_created_at_idx ON customers (created_at DESC, id);

CREATE TABLE subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           uuid NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  plan_code             text NOT NULL CHECK (char_length(plan_code) BETWEEN 1 AND 100),
  status                text NOT NULL
                          CHECK (status IN ('trialing', 'active', 'past_due', 'paused', 'canceled')),
  quantity              integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  cancel_at             timestamptz,
  canceled_at           timestamptz,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (current_period_end IS NULL OR current_period_start IS NULL
         OR current_period_end > current_period_start)
);

CREATE INDEX subscriptions_customer_id_idx ON subscriptions (customer_id);
CREATE INDEX subscriptions_status_idx ON subscriptions (status);

CREATE TABLE usage_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      uuid NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  subscription_id  uuid REFERENCES subscriptions (id) ON DELETE RESTRICT,
  metric           text NOT NULL CHECK (metric ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  quantity         numeric(20, 4) NOT NULL CHECK (quantity >= 0),
  occurred_at      timestamptz NOT NULL,
  -- Optional client-supplied key so the same event is never recorded twice.
  idempotency_key  text UNIQUE CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 200),
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX usage_records_customer_occurred_idx ON usage_records (customer_id, occurred_at);

-- Keep updated_at current on every UPDATE.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS usage_records;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS customers;
DROP FUNCTION IF EXISTS set_updated_at();
