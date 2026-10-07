import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auth, buildTestApp, createTestPool, FIXTURES, resetDatabase } from "./helpers.js";
import { dbTestsEnabled } from "./test-db.js";

describe.skipIf(!dbTestsEnabled())("API v1 (PostgreSQL)", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = createTestPool();
    app = await buildTestApp(pool);
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  describe("GET /v1/health", () => {
    it("reports ok without authentication", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok", checks: { database: "ok" } });
    });
  });

  describe("GET /v1/customers", () => {
    it("lists customers newest first with pagination metadata", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/customers", headers: auth });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.map((c: { id: string }) => c.id)).toEqual([FIXTURES.globex, FIXTURES.acme]);
      expect(body.pagination).toEqual({ limit: 20, offset: 0, total: 2 });
      expect(body.data[1]).toEqual({
        id: FIXTURES.acme,
        name: "[TEST] Acme 100% Corp",
        email: "owner@acme.fixture.test",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: expect.any(String),
      });
    });

    it("searches name and email case-insensitively", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/customers?search=ADMIN@globex",
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.map((c: { id: string }) => c.id)).toEqual([FIXTURES.globex]);
    });

    it("treats LIKE wildcards in search literally", async () => {
      const percent = await app.inject({
        method: "GET",
        url: `/v1/customers?search=${encodeURIComponent("%")}`,
        headers: auth,
      });
      expect(percent.json().data.map((c: { id: string }) => c.id)).toEqual([FIXTURES.acme]);

      const underscore = await app.inject({
        method: "GET",
        url: `/v1/customers?search=${encodeURIComponent("_")}`,
        headers: auth,
      });
      expect(underscore.json().data.map((c: { id: string }) => c.id)).toEqual([FIXTURES.globex]);
    });

    it("applies limit and offset", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/customers?limit=1&offset=1",
        headers: auth,
      });
      expect(res.json().data.map((c: { id: string }) => c.id)).toEqual([FIXTURES.acme]);
      expect(res.json().pagination).toEqual({ limit: 1, offset: 1, total: 2 });
    });

    it.each(["limit=0", "limit=101", "limit=abc", "offset=-1", "unknown=1", "search="])(
      "rejects invalid query %s with 422",
      async (query) => {
        const res = await app.inject({ method: "GET", url: `/v1/customers?${query}`, headers: auth });
        expect(res.statusCode).toBe(422);
        expect(res.json().error.code).toBe("VALIDATION_ERROR");
      },
    );
  });

  describe("GET /v1/customers/:id", () => {
    it("returns an existing customer", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/customers/${FIXTURES.acme}`,
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.email).toBe("owner@acme.fixture.test");
    });

    it("returns 404 for a customer that does not exist", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/customers/${FIXTURES.missing}`,
        headers: auth,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toEqual({ code: "NOT_FOUND", message: "Customer not found" });
    });

    it("returns 422 for a malformed id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/customers/not-a-uuid'%20OR%201=1",
        headers: auth,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.details[0].path).toBe("id");
    });
  });

  describe("POST /v1/customers", () => {
    it("creates a customer and returns 201 with a Location header", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/customers",
        headers: auth,
        payload: { name: "  [TEST] New Co  ", email: "new@newco.fixture.test" },
      });
      expect(res.statusCode).toBe(201);
      const created = res.json().data;
      expect(created).toMatchObject({
        name: "[TEST] New Co",
        email: "new@newco.fixture.test",
        status: "active",
      });
      expect(res.headers.location).toBe(`/v1/customers/${created.id}`);

      const stored = await pool.query("SELECT name FROM customers WHERE id = $1", [created.id]);
      expect(stored.rows[0].name).toBe("[TEST] New Co");
    });

    it("returns 409 when the email already exists (case-insensitive)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/customers",
        headers: auth,
        payload: { name: "[TEST] Dup", email: "OWNER@acme.fixture.test" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("CONFLICT");
    });

    it.each([
      [{ name: "[TEST] X" }, "email"],
      [{ email: "x@x.fixture.test" }, "name"],
      [{ name: "", email: "x@x.fixture.test" }, "name"],
      [{ name: "[TEST] X", email: "not-an-email" }, "email"],
      [{ name: "a".repeat(201), email: "x@x.fixture.test" }, "name"],
      [{ name: "[TEST]\u0000X", email: "x@x.fixture.test" }, "name"],
      [{ name: 42, email: "x@x.fixture.test" }, "name"],
      [{ name: "[TEST] X", email: "x@x.fixture.test", status: "inactive" }, "(root)"],
    ])("rejects invalid body %j with 422", async (payload, path) => {
      const res = await app.inject({ method: "POST", url: "/v1/customers", headers: auth, payload });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.details.map((d: { path: string }) => d.path)).toContain(path);
      const count = await pool.query("SELECT COUNT(*)::int AS n FROM customers");
      expect(count.rows[0].n).toBe(2);
    });

    it("returns 400 for malformed JSON", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/customers",
        headers: { ...auth, "content-type": "application/json" },
        payload: '{"name": "[TEST] broken"',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("BAD_REQUEST");
    });

    it("returns 415 for an unsupported content type", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/customers",
        headers: { ...auth, "content-type": "text/xml" },
        payload: "<customer/>",
      });
      expect(res.statusCode).toBe(415);
    });
  });

  describe("GET /v1/subscriptions", () => {
    it("lists all subscriptions", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/subscriptions", headers: auth });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.pagination.total).toBe(2);
      expect(body.data[1]).toMatchObject({
        id: FIXTURES.acmeSub,
        customerId: FIXTURES.acme,
        planCode: "test-pro",
        status: "active",
        quantity: 1,
      });
    });

    it("filters by customerId and status", async () => {
      const byCustomer = await app.inject({
        method: "GET",
        url: `/v1/subscriptions?customerId=${FIXTURES.globex}`,
        headers: auth,
      });
      expect(byCustomer.json().data.map((s: { id: string }) => s.id)).toEqual([FIXTURES.globexSub]);

      const byStatus = await app.inject({
        method: "GET",
        url: "/v1/subscriptions?status=active",
        headers: auth,
      });
      expect(byStatus.json().data.map((s: { id: string }) => s.id)).toEqual([FIXTURES.acmeSub]);
    });

    it.each(["status=expired", "customerId=123", "limit=1000"])(
      "rejects invalid query %s with 422",
      async (query) => {
        const res = await app.inject({
          method: "GET",
          url: `/v1/subscriptions?${query}`,
          headers: auth,
        });
        expect(res.statusCode).toBe(422);
      },
    );
  });

  describe("GET /v1/customers/:id/usage", () => {
    it("aggregates usage per metric within the requested month (UTC, end-exclusive)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/customers/${FIXTURES.acme}/usage?period=2026-10`,
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({
        customerId: FIXTURES.acme,
        period: "2026-10",
        start: "2026-10-01T00:00:00.000Z",
        end: "2026-11-01T00:00:00.000Z",
        metrics: [
          { metric: "api_calls", total: "300.5000", events: 2 },
          { metric: "storage_gb", total: "3.0000", events: 1 },
        ],
      });
    });

    it("returns an empty metric list for a period without usage", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/customers/${FIXTURES.globex}/usage?period=2026-10`,
        headers: auth,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.metrics).toEqual([]);
    });

    it("defaults to the current UTC month", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/customers/${FIXTURES.acme}/usage`,
        headers: auth,
      });
      const now = new Date();
      const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      expect(res.statusCode).toBe(200);
      expect(res.json().data.period).toBe(expected);
    });

    it("returns 404 for a customer that does not exist", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/customers/${FIXTURES.missing}/usage`,
        headers: auth,
      });
      expect(res.statusCode).toBe(404);
    });

    it.each(["2026-13", "2026-1", "202610", "last-month"])(
      "rejects invalid period %s with 422",
      async (period) => {
        const res = await app.inject({
          method: "GET",
          url: `/v1/customers/${FIXTURES.acme}/usage?period=${period}`,
          headers: auth,
        });
        expect(res.statusCode).toBe(422);
      },
    );
  });
});
