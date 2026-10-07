import type { SaasManagerConfig } from "./config.js";

/** Maximum length of an error message relayed from the API to the agent. */
const MAX_MESSAGE_LENGTH = 300;

export type SaasApiErrorKind =
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "server"
  | "unexpected_response"
  | "timeout"
  | "network"
  | "http";

/**
 * Error raised for any failed SaaS API call. The message is safe to show to the
 * agent and the user: it never contains the API key, request headers, or raw
 * response bodies (only the API's documented `error.message`, truncated).
 */
export class SaasApiError extends Error {
  constructor(
    readonly kind: SaasApiErrorKind,
    message: string,
    readonly status?: number,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = "SaasApiError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type RequestOptions = {
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal;
};

/** Strips control characters and truncates text that originates from the API. */
function clean(text: string, max = MAX_MESSAGE_LENGTH): string {
  const stripped = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped;
}

/** Extracts `{ error: { message, details } }` from the documented API error envelope. */
function readErrorEnvelope(body: unknown): {
  message?: string;
  details?: Array<{ path: string; message: string }>;
} {
  if (typeof body !== "object" || body === null) return {};
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return {};
  const message = (error as { message?: unknown }).message;
  const rawDetails = (error as { details?: unknown }).details;
  const details = Array.isArray(rawDetails)
    ? rawDetails
        .filter(
          (d): d is { path: string; message: string } =>
            typeof d === "object" &&
            d !== null &&
            typeof (d as { path?: unknown }).path === "string" &&
            typeof (d as { message?: unknown }).message === "string",
        )
        .slice(0, 10)
        .map((d) => ({ path: clean(d.path, 100), message: clean(d.message, 200) }))
    : undefined;
  return {
    message: typeof message === "string" ? clean(message) : undefined,
    ...(details && details.length > 0 ? { details } : {}),
  };
}

function errorForStatus(status: number, body: unknown): SaasApiError {
  const { message, details } = readErrorEnvelope(body);
  switch (status) {
    case 401:
    case 403:
      return new SaasApiError(
        "unauthorized",
        "The SaaS API rejected the credentials (401). Check the configured API key.",
        status,
      );
    case 404:
      return new SaasApiError("not_found", `Not found (404): ${message ?? "resource not found"}`, status);
    case 409:
      return new SaasApiError("conflict", `Conflict (409): ${message ?? "resource already exists"}`, status);
    case 400:
    case 422: {
      const detailText = details?.map((d) => `${d.path}: ${d.message}`).join("; ");
      return new SaasApiError(
        "validation",
        `Invalid request (${status}): ${message ?? "validation failed"}${detailText ? ` — ${detailText}` : ""}`,
        status,
        details,
      );
    }
    case 429:
      return new SaasApiError("rate_limited", "The SaaS API rate limit was exceeded (429). Try again later.", status);
    default:
      if (status >= 500) {
        return new SaasApiError(
          "server",
          `The SaaS API had an internal error (${status}). No changes can be confirmed; try again later.`,
          status,
        );
      }
      return new SaasApiError("http", `The SaaS API returned HTTP ${status}.`, status);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const type = response.headers.get("content-type") ?? "";
  if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(type)) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Minimal HTTP client for the SaaS Manager REST API (v1).
 *
 * - Sends `Authorization: Bearer <apiKey>`; the key is never logged or returned.
 * - Applies a per-request timeout and honours the caller's abort signal.
 * - Does not follow redirects, so the API key is never forwarded to another host.
 */
export function createSaasClient(config: SaasManagerConfig, fetchImpl: FetchLike = fetch) {
  return async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(`${config.apiUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const timeout = AbortSignal.timeout(config.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        redirect: "manual",
        signal,
      });
    } catch (error) {
      if (timeout.aborted) {
        throw new SaasApiError(
          "timeout",
          `The SaaS API did not respond within ${config.timeoutMs} ms. The result of the operation is unknown.`,
        );
      }
      if (options.signal?.aborted) {
        throw new SaasApiError("network", "The request was cancelled.");
      }
      // Network error details (DNS, TLS, connection refused) are not echoed: they
      // can contain internal hostnames. The agent gets a stable, generic message.
      void error;
      throw new SaasApiError("network", "Could not reach the SaaS API. Check apiUrl and network access.");
    }

    if (response.status >= 300 && response.status < 400) {
      throw new SaasApiError(
        "unexpected_response",
        `The SaaS API answered with a redirect (${response.status}). Check that apiUrl is the exact API base URL.`,
        response.status,
      );
    }

    const body = await readJson(response);
    if (!response.ok) throw errorForStatus(response.status, body);

    if (body === undefined) {
      throw new SaasApiError(
        "unexpected_response",
        `The SaaS API returned a non-JSON response (HTTP ${response.status}). Check that apiUrl points to the SaaS Manager API.`,
        response.status,
      );
    }
    return body as T;
  };
}

export type SaasClient = ReturnType<typeof createSaasClient>;
