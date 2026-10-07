import { buildApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { createPool } from "./db.js";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // The message names variables only, never their values.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const pool = createPool(config);
  // Idle client errors (e.g. the database restarting) must not crash the process.
  pool.on("error", (error) => console.error("postgres pool error:", error.message));

  const app = await buildApp({ config, db: pool, logger: { level: config.logLevel } });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    try {
      await app.close();
      await pool.end();
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  console.error("fatal startup error:", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
