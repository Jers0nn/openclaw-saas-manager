import { afterEach, describe, expect, it } from "vitest";
import { createSaasClient, SaasApiError } from "../src/client.js";
import { json, startMockApi } from "./helpers/mock-api.js";

const API_KEY = "plugin-test-key-not-real-0123456789";
let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
  close = undefined;
});

async function clientFor(
  handler: Parameters<typeof startMockApi>[0],
  timeoutMs = 2_000,
) {
  const api = await startMockApi(handler);
  close = api.close;
  return { api, request: createSaasClient({ apiUrl: api.url, apiKey: API_KEY, timeoutMs }) };
}

async function expectError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SaasApiError);
    return error as SaasApiError;
  }
  throw new Error("expected the request to fail");
}

describe("SaaS API client", () => {
  it("sends the bearer key, JSON headers and query parameters", async () => {
    const { api, request } = await clientFor((_req, res) => json(res, 200, { data: [] }));
    await request("/customers", { query: { search: "a b&c", limit: 5, offset: undefined } });

    const [sent] = api.requests;
    expect(sent!.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(sent!.headers.accept).toBe("application/json");
    expect(sent!.query).toEqual({ search: "a b&c", limit: "5" });
  });

  it.each([
    [401, "unauthorized", /rejected the credentials \(401\)/],
    [404, "not_found", /Not found \(404\): Customer not found/],
    [409, "conflict", /Conflict \(409\)/],
    [422, "validation", /Invalid request \(422\): Request validation failed — email: must be a valid email address/],
    [429, "rate_limited", /rate limit/],
    [500, "server", /internal error \(500\)/],
    [503, "server", /internal error \(503\)/],
  ])("maps HTTP %i to a %s error with a safe message", async (status, kind, message) => {
    const { request } = await clientFor((_req, res) =>
      json(res, status, {
        error: {
          code: "X",
          message: status === 404 ? "Customer not found" : "Request validation failed",
          details: [{ path: "email", message: "must be a valid email address" }],
        },
      }),
    );
    const error = await expectError(request("/customers/x"));
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.message).toMatch(message);
    expect(error.message).not.toContain(API_KEY);
  });

  it("does not relay raw server bodies (e.g. stack traces) for 5xx errors", async () => {
    const { request } = await clientFor((_req, res) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("Error: password=supersecret at Db.connect (/srv/app/db.js:10)");
    });
    const error = await expectError(request("/customers"));
    expect(error.message).not.toMatch(/supersecret|db\.js/);
  });

  it("strips control characters and truncates long API error messages", async () => {
    const { request } = await clientFor((_req, res) =>
      json(res, 404, { error: { message: `bad\u0000\u001b[31m${"x".repeat(1000)}` } }),
    );
    const error = await expectError(request("/customers/x"));
    expect(error.message).not.toMatch(/[\u0000-\u001f]/);
    expect(error.message.length).toBeLessThan(400);
  });

  it("rejects a successful but non-JSON response", async () => {
    const { request } = await clientFor((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>login page</html>");
    });
    const error = await expectError(request("/customers"));
    expect(error.kind).toBe("unexpected_response");
    expect(error.message).toMatch(/non-JSON/);
  });

  it("rejects a 204 / empty response", async () => {
    const { request } = await clientFor((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const error = await expectError(request("/customers"));
    expect(error.kind).toBe("unexpected_response");
  });

  it("handles a non-JSON error response", async () => {
    const { request } = await clientFor((_req, res) => {
      res.writeHead(502, { "content-type": "text/html" });
      res.end("<html>Bad gateway</html>");
    });
    const error = await expectError(request("/customers"));
    expect(error.kind).toBe("server");
    expect(error.status).toBe(502);
  });

  it("does not follow redirects (the API key must never be forwarded)", async () => {
    const { api, request } = await clientFor((_req, res) => {
      res.writeHead(302, { location: "http://127.0.0.1:1/steal" });
      res.end();
    });
    const error = await expectError(request("/customers"));
    expect(error.kind).toBe("unexpected_response");
    expect(api.requests).toHaveLength(1);
  });

  it("times out slow responses", async () => {
    const { request } = await clientFor(() => {
      /* never responds */
    }, 1_000);
    const error = await expectError(request("/customers"));
    expect(error.kind).toBe("timeout");
    expect(error.message).toMatch(/within 1000 ms/);
  });

  it("reports network failures without echoing internal details", async () => {
    const request = createSaasClient({
      apiUrl: "http://127.0.0.1:1/v1",
      apiKey: API_KEY,
      timeoutMs: 2_000,
    });
    const error = await expectError(request("/customers"));
    expect(error.kind).toBe("network");
    expect(error.message).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
  });

  it("honours the caller's abort signal", async () => {
    const { request } = await clientFor(() => {
      /* never responds */
    });
    const controller = new AbortController();
    const pending = request("/customers", { signal: controller.signal });
    controller.abort();
    const error = await expectError(pending);
    expect(error.message).toMatch(/cancelled/);
  });
});
