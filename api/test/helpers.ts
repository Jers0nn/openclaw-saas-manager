import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import pg from "pg";
import { buildApp } from "../src/app.js";
import type { Queryable } from "../src/db.js";
import { getTestDatabaseUrl } from "./test-db.js";

/** A random key generated per test run — never a real credential. */
export const TEST_API_KEY = `test_${randomBytes(24).toString("hex")}`;
export const auth = { authorization: `Bearer ${TEST_API_KEY}` };

export const baseConfig = {
  apiKeys: [TEST_API_KEY],
  corsOrigins: [] as string[],
  rateLimitMax: 10_000,
  rateLimitWindow: "1 minute",
  trustProxy: false,
};

export function createTestPool(): pg.Pool {
  const url = getTestDatabaseUrl();
  if (!url) throw new Error("TEST_DATABASE_URL is required for database-backed tests");
  return new pg.Pool({ connectionString: url, max: 4 });
}

export async function buildTestApp(
  db: Queryable,
  overrides: Partial<typeof baseConfig> = {},
  logStream?: Writable,
) {
  return buildApp({
    config: { ...baseConfig, ...overrides },
    db,
    logger: logStream ? { level: "info", stream: logStream } : false,
  });
}

/** Collects log lines in memory so tests can assert nothing sensitive is logged. */
export function captureLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { stream, text: () => lines.join("") };
}

/** A database stub whose every query fails, to exercise server-error paths. */
export const failingDb: Queryable = {
  query: async () => {
    throw new Error("connect ECONNREFUSED 10.1.2.3:5432 password=hunter2-internal-detail");
  },
};

// Fictitious fixtures, clearly marked as test data.
export const FIXTURES = {
  acme: "10000000-0000-4000-8000-000000000001",
  globex: "10000000-0000-4000-8000-000000000002",
  missing: "10000000-0000-4000-8000-0000000000ff",
  acmeSub: "10000000-0000-4000-8000-000000000101",
  globexSub: "10000000-0000-4000-8000-000000000102",
};

export async function resetDatabase(pool: pg.Pool) {
  await pool.query("TRUNCATE usage_records, subscriptions, customers");
  await pool.query(
    `INSERT INTO customers (id, name, email, status, created_at) VALUES
       ($1, '[TEST] Acme 100% Corp', 'owner@acme.fixture.test', 'active', '2026-01-01T00:00:00Z'),
       ($2, '[TEST] Globex_Ltd', 'Admin@Globex.fixture.test', 'inactive', '2026-02-01T00:00:00Z')`,
    [FIXTURES.acme, FIXTURES.globex],
  );
  await pool.query(
    `INSERT INTO subscriptions (id, customer_id, plan_code, status, created_at) VALUES
       ($1, $2, 'test-pro', 'active', '2026-01-02T00:00:00Z'),
       ($3, $4, 'test-basic', 'canceled', '2026-02-02T00:00:00Z')`,
    [FIXTURES.acmeSub, FIXTURES.acme, FIXTURES.globexSub, FIXTURES.globex],
  );
  await pool.query(
    `INSERT INTO usage_records (customer_id, subscription_id, metric, quantity, occurred_at) VALUES
       ($1, $2, 'api_calls', 100, '2026-09-30T23:59:59Z'),
       ($1, $2, 'api_calls', 250, '2026-10-01T00:00:00Z'),
       ($1, $2, 'api_calls', 50.5, '2026-10-31T23:59:59Z'),
       ($1, $2, 'storage_gb', 3, '2026-10-15T12:00:00Z'),
       ($1, $2, 'api_calls', 999, '2026-11-01T00:00:00Z')`,
    [FIXTURES.acme, FIXTURES.acmeSub],
  );
}
