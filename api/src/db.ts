import pg from "pg";
import type { AppConfig } from "./config.js";

/**
 * Minimal query interface used by repositories. `pg.Pool` satisfies it, and
 * tests can substitute a failing implementation to exercise error handling.
 */
export type Queryable = {
  query: <R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<pg.QueryResult<R>>;
};

export function createPool(config: Pick<AppConfig, "databaseUrl" | "databaseSsl">): pg.Pool {
  const ssl =
    config.databaseSsl === "verify"
      ? { rejectUnauthorized: true }
      : config.databaseSsl === "true"
        ? { rejectUnauthorized: false }
        : undefined;

  return new pg.Pool({
    connectionString: config.databaseUrl,
    ssl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Abort runaway queries instead of holding connections indefinitely.
    statement_timeout: 10_000,
    application_name: "saas-manager-api",
  });
}
