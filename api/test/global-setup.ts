import { runner } from "node-pg-migrate";
import { fileURLToPath } from "node:url";
import { getTestDatabaseUrl } from "./test-db.js";

/** Applies all migrations to the dedicated test database before the suites run. */
export default async function setup() {
  const databaseUrl = getTestDatabaseUrl();
  if (!databaseUrl) {
    if (process.env.SKIP_DB_TESTS === "1") {
      console.warn("[tests] SKIP_DB_TESTS=1: database-backed tests are skipped.");
      return;
    }
    throw new Error(
      "TEST_DATABASE_URL is not set. Point it to a disposable PostgreSQL database whose name ends in _test " +
        "(see README 'Tests'), or set SKIP_DB_TESTS=1 to run only the tests that need no database.",
    );
  }

  await runner({
    databaseUrl,
    dir: fileURLToPath(new URL("../migrations", import.meta.url)),
    direction: "up",
    migrationsTable: "pgmigrations",
    log: () => {},
  });
}
