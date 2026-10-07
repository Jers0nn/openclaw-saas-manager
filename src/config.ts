/** Default per-request timeout for calls to the SaaS API. */
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 60_000;

export type SaasManagerConfig = {
  /** Base URL including the version prefix, e.g. https://<your-api-host>/v1 (no trailing slash). */
  apiUrl: string;
  apiKey: string;
  timeoutMs: number;
};

/** Raised when the plugin configuration is missing or invalid. Messages never contain secret values. */
export class SaasConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaasConfigError";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Validates the plugin config from `plugins.entries.saas-manager.config`.
 *
 * OpenClaw resolves SecretRefs before handing config to the plugin, so `apiKey`
 * arrives here as a plain string whether it was stored as plaintext or as a
 * SecretRef (env / file / exec / store).
 */
export function resolveConfig(raw: unknown): SaasManagerConfig {
  const config = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const apiUrlRaw = config.apiUrl;
  if (typeof apiUrlRaw !== "string" || apiUrlRaw.trim() === "") {
    throw new SaasConfigError(
      "SaaS Manager is not configured: set plugins.entries.saas-manager.config.apiUrl",
    );
  }
  let url: URL;
  try {
    url = new URL(apiUrlRaw.trim());
  } catch {
    throw new SaasConfigError("SaaS Manager apiUrl is not a valid URL");
  }
  if (url.username || url.password) {
    throw new SaasConfigError("SaaS Manager apiUrl must not contain credentials");
  }
  if (url.search || url.hash) {
    throw new SaasConfigError("SaaS Manager apiUrl must not contain a query string or fragment");
  }
  const isLocal = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new SaasConfigError(
      "SaaS Manager apiUrl must use https:// (plain http:// is only allowed for localhost)",
    );
  }

  const apiKey = config.apiKey;
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new SaasConfigError(
      "SaaS Manager API key is missing: set plugins.entries.saas-manager.config.apiKey (preferably as a SecretRef)",
    );
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (config.timeoutMs !== undefined) {
    if (
      typeof config.timeoutMs !== "number" ||
      !Number.isInteger(config.timeoutMs) ||
      config.timeoutMs < MIN_TIMEOUT_MS ||
      config.timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new SaasConfigError(
        `SaaS Manager timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`,
      );
    }
    timeoutMs = config.timeoutMs;
  }

  return {
    apiUrl: url.toString().replace(/\/+$/, ""),
    apiKey: apiKey.trim(),
    timeoutMs,
  };
}
