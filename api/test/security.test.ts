import { describe, expect, it } from "vitest";
import type { Queryable } from "../src/db.js";
import { auth, buildTestApp, captureLogs, failingDb, TEST_API_KEY } from "./helpers.js";

// These tests need no database: they use stubs that either succeed trivially
// or always fail, so they also run with SKIP_DB_TESTS=1.
const okDb: Queryable = {
  query: async () => ({ rows: [], rowCount: 0, command: "", oid: 0, fields: [] }),
};

const protectedRoutes: Array<[string, string]> = [
  ["GET", "/v1/customers"],
  ["GET", "/v1/customers/10000000-0000-4000-8000-000000000001"],
  ["POST", "/v1/customers"],
  ["GET", "/v1/subscriptions"],
  ["GET", "/v1/customers/10000000-0000-4000-8000-000000000001/usage"],
];

describe("authentication", () => {
  it.each(protectedRoutes)("%s %s returns 401 without an API key", async (method, url) => {
    const app = await buildTestApp(okDb);
    const res = await app.inject({ method: method as "GET", url });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toEqual({
      code: "UNAUTHORIZED",
      message: "Missing or invalid API key",
    });
    await app.close();
  });

  it.each([
    ["wrong key", "Bearer wrong_key_wrong_key_wrong_key_wrong"],
    ["key with extra suffix", `Bearer ${TEST_API_KEY}x`],
    ["key prefix only", `Bearer ${TEST_API_KEY.slice(0, -1)}`],
    ["basic scheme", `Basic ${TEST_API_KEY}`],
    ["empty bearer", "Bearer "],
    ["two tokens", `Bearer ${TEST_API_KEY} extra`],
  ])("rejects %s with 401", async (_label, header) => {
    const app = await buildTestApp(okDb);
    const res = await app.inject({
      method: "GET",
      url: "/v1/customers",
      headers: { authorization: header },
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain(TEST_API_KEY);
    await app.close();
  });

  it("accepts any key from a rotation list", async () => {
    const second = "second_key_".padEnd(40, "z");
    const app = await buildTestApp(okDb, { apiKeys: [TEST_API_KEY, second] });
    for (const key of [TEST_API_KEY, second]) {
      const res = await app.inject({
        method: "GET",
        url: "/v1/subscriptions",
        headers: { authorization: `Bearer ${key}` },
      });
      expect(res.statusCode).toBe(200);
    }
    await app.close();
  });

  it("checks authentication before validating input", async () => {
    const app = await buildTestApp(okDb);
    const res = await app.inject({ method: "GET", url: "/v1/customers?limit=abc" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("server errors", () => {
  it.each(protectedRoutes)(
    "%s %s returns a generic 500 without leaking internals",
    async (method, url) => {
      const app = await buildTestApp(failingDb);
      const res = await app.inject({
        method: method as "GET",
        url,
        headers: auth,
        ...(method === "POST" ? { payload: { name: "[TEST] X", email: "x@x.fixture.test" } } : {}),
      });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
        requestId: expect.any(String),
      });
      expect(res.body).not.toMatch(/ECONNREFUSED|hunter2|10\.1\.2\.3/);
      await app.close();
    },
  );

  it("health check returns 503 when the database is unavailable", async () => {
    const app = await buildTestApp(failingDb);
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "error", checks: { database: "unavailable" } });
    await app.close();
  });

  it("unknown routes return a JSON 404", async () => {
    const app = await buildTestApp(okDb);
    const res = await app.inject({ method: "GET", url: "/v1/nope", headers: auth });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
    await app.close();
  });

  it("rejects oversized bodies with 413", async () => {
    const app = await buildTestApp(okDb);
    const res = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: auth,
      payload: { name: "x".repeat(20_000), email: "x@x.fixture.test" },
    });
    expect(res.statusCode).toBe(413);
    await app.close();
  });
});

describe("logging", () => {
  it("never writes the API key, auth header or query string to logs", async () => {
    const logs = captureLogs();
    const app = await buildTestApp(failingDb, {}, logs.stream);
    await app.inject({
      method: "GET",
      url: "/v1/customers?search=secret.person%40fixture.test",
      headers: auth,
    });
    await app.inject({
      method: "GET",
      url: "/v1/customers",
      headers: { authorization: "Bearer leaked_candidate_key_should_not_appear" },
    });
    await app.close();

    const text = logs.text();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("unhandled error");
    expect(text).not.toContain(TEST_API_KEY);
    expect(text).not.toContain("leaked_candidate_key_should_not_appear");
    expect(text).not.toContain("secret.person");
  });
});

describe("CORS", () => {
  it("sends no CORS headers when no origins are configured", async () => {
    const app = await buildTestApp(okDb);
    const res = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { origin: "https://untrusted.invalid" },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("allows only configured origins", async () => {
    const allowed = "https://dashboard.fixture.test";
    const app = await buildTestApp(okDb, { corsOrigins: [allowed] });

    const ok = await app.inject({ method: "GET", url: "/v1/health", headers: { origin: allowed } });
    expect(ok.headers["access-control-allow-origin"]).toBe(allowed);

    const denied = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { origin: "https://untrusted.invalid" },
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("answers preflight requests for allowed origins", async () => {
    const allowed = "https://dashboard.fixture.test";
    const app = await buildTestApp(okDb, { corsOrigins: [allowed] });
    const res = await app.inject({
      method: "OPTIONS",
      url: "/v1/customers",
      headers: {
        origin: allowed,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-headers"]).toContain("Authorization");
    await app.close();
  });
});

describe("rate limiting", () => {
  it("returns 429 once the limit is exceeded", async () => {
    const app = await buildTestApp(okDb, { rateLimitMax: 2 });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await app.inject({ method: "GET", url: "/v1/health" })).statusCode);
    }
    expect(statuses).toEqual([200, 200, 429]);
    await app.close();
  });
});

describe("security headers", () => {
  it("sets standard hardening headers", async () => {
    const app = await buildTestApp(okDb);
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    await app.close();
  });
});
