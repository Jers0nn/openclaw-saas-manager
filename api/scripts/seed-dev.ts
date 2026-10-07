/**
 * Loads fictitious development data (seeds/dev.sql) into DATABASE_URL.
 *
 * Safety guards:
 *  - refuses to run when NODE_ENV=production
 *  - refuses non-local database hosts unless ALLOW_REMOTE_SEED=true
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "db"]);

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to load development seed data with NODE_ENV=production");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const host = new URL(databaseUrl).hostname;
  if (!LOCAL_HOSTS.has(host) && process.env.ALLOW_REMOTE_SEED !== "true") {
    throw new Error(
      "Refusing to seed a non-local database. Set ALLOW_REMOTE_SEED=true only for a disposable development database.",
    );
  }

  const sql = await readFile(fileURLToPath(new URL("../seeds/dev.sql", import.meta.url)), "utf8");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("Development seed data loaded ([DEMO] records).");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
