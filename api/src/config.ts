import { z } from "zod";

/** Minimum accepted API key length. Keys shorter than this are rejected at startup. */
export const MIN_API_KEY_LENGTH = 32;

const csv = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // "true" enables TLS without certificate verification for providers that
  // require it; "verify" enables TLS with full verification; unset/"false" = no TLS.
  DATABASE_SSL: z.enum(["false", "true", "verify"]).default("false"),
  API_KEYS: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_WINDOW: z.string().min(1).default("1 minute"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  databaseSsl: "false" | "true" | "verify";
  apiKeys: string[];
  corsOrigins: string[];
  rateLimitMax: number;
  rateLimitWindow: string;
  trustProxy: boolean;
};

export class ConfigError extends Error {}

/**
 * Parses configuration from environment variables. Error messages name the
 * offending variable but never echo its value, so secrets cannot leak into
 * startup logs.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`Invalid configuration: ${problems}`);
  }
  const e = parsed.data;

  const apiKeys = csv(e.API_KEYS);
  if (apiKeys.length === 0) {
    throw new ConfigError("Invalid configuration: API_KEYS must contain at least one key");
  }
  if (apiKeys.some((key) => key.length < MIN_API_KEY_LENGTH)) {
    throw new ConfigError(
      `Invalid configuration: every key in API_KEYS must be at least ${MIN_API_KEY_LENGTH} characters`,
    );
  }

  const corsOrigins = csv(e.CORS_ORIGINS);
  if (corsOrigins.includes("*")) {
    throw new ConfigError(
      "Invalid configuration: CORS_ORIGINS must list explicit origins; '*' is not allowed",
    );
  }
  for (const origin of corsOrigins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new ConfigError(`Invalid configuration: CORS_ORIGINS entry is not a URL`);
    }
    if (url.origin !== origin) {
      throw new ConfigError(
        "Invalid configuration: CORS_ORIGINS entries must be bare origins (scheme://host[:port], no path or trailing slash)",
      );
    }
  }

  return {
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    databaseSsl: e.DATABASE_SSL,
    apiKeys,
    corsOrigins,
    rateLimitMax: e.RATE_LIMIT_MAX,
    rateLimitWindow: e.RATE_LIMIT_WINDOW,
    trustProxy: e.TRUST_PROXY === "true",
  };
}
