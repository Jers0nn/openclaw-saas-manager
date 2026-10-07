/**
 * End-to-end contract test: the real plugin tools against the real API
 * (api/src) backed by the disposable PostgreSQL test database.
 *
 * Runs only when TEST_DATABASE_URL is set (database name must end in "_test")
 * and the API dependencies are installed (`npm install --prefix api`).
 */
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import entry from "../index.js";

const apiInstalled = existsSync(new URL("../api/node_modules/fastify", import.meta.url));
const enabled = Boolean(process.env.TEST_DATABASE_URL) && apiInstalled;

type Tool = { name: string; execute: (id: string, params: unknown) => Promise<{ details: any }> };

describe.skipIf(!enabled)("plugin <-> API contract (PostgreSQL)", () => {
  let tools: Map<string, Tool>;
  let hooks: Array<(event: { toolName: string; params: Record<string, unknown> }) => Promise<unknown>>;
  let close: () => Promise<void>;
  let reset: () => Promise<void>;
  let fixtures: Record<string, string>;
  let rawQuery: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>;
  let apiUrl: string;

  beforeAll(async () => {
    const setup = (await import("../api/test/global-setup.js")).default;
    await setup(); // applies migrations to the *_test database only
    const helpers = await import("../api/test/helpers.js");
    const pool = helpers.createTestPool();
    const app = await helpers.buildTestApp(pool);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address() as AddressInfo;

    apiUrl = `http://127.0.0.1:${port}/v1`;
    fixtures = helpers.FIXTURES;
    reset = () => helpers.resetDatabase(pool);
    rawQuery = (sql, values) => pool.query(sql, values);
    close = async () => {
      await app.close();
      await pool.end();
    };

    tools = new Map();
    hooks = [];
    (entry as unknown as { register: (api: unknown) => void }).register({
      pluginConfig: { apiUrl, apiKey: helpers.TEST_API_KEY },
      registerTool: (tool: Tool) => tools.set(tool.name, tool),
      on: (_name: string, handler: (typeof hooks)[number]) => hooks.push(handler),
    });
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    await reset();
  });

  const run = (name: string, params: unknown) => tools.get(name)!.execute("contract", params);

  it("saas_list_customers returns customers from the database", async () => {
    const { details } = await run("saas_list_customers", { search: "acme", limit: 10 });
    expect(details.data.map((c: { id: string }) => c.id)).toEqual([fixtures.acme]);
    expect(details.pagination).toEqual({ limit: 10, offset: 0, total: 1 });
  });

  it("saas_get_customer returns one customer and reports 404 for unknown ids", async () => {
    const { details } = await run("saas_get_customer", { customerId: fixtures.acme });
    expect(details.data.email).toBe("owner@acme.fixture.test");
    await expect(run("saas_get_customer", { customerId: fixtures.missing })).rejects.toThrow(
      "Not found (404): Customer not found",
    );
  });

  it("saas_create_customer persists a test customer and maps conflicts and validation errors", async () => {
    const { details } = await run("saas_create_customer", {
      name: "[TEST] Contract Co",
      email: "contract@contract.fixture.test",
    });
    expect(details.data).toMatchObject({ name: "[TEST] Contract Co", status: "active" });
    const stored = await rawQuery("SELECT email FROM customers WHERE id = $1", [details.data.id]);
    expect(stored.rows[0].email).toBe("contract@contract.fixture.test");

    await expect(
      run("saas_create_customer", { name: "[TEST] Dup", email: "contract@contract.fixture.test" }),
    ).rejects.toThrow(/Conflict \(409\)/);
    await expect(
      run("saas_create_customer", { name: "[TEST] Bad", email: "not-an-email" }),
    ).rejects.toThrow(/Invalid request \(422\).*email/);
  });

  it("saas_list_subscriptions filters by customer and status", async () => {
    const { details } = await run("saas_list_subscriptions", {
      customerId: fixtures.acme,
      status: "active",
    });
    expect(details.data.map((s: { id: string }) => s.id)).toEqual([fixtures.acmeSub]);
  });

  it("saas_get_usage aggregates usage for a period", async () => {
    const { details } = await run("saas_get_usage", { customerId: fixtures.acme, period: "2026-10" });
    expect(details.data.metrics).toEqual([
      { metric: "api_calls", total: "300.5000", events: 2 },
      { metric: "storage_gb", total: "3.0000", events: 1 },
    ]);
  });

  it("an invalid API key surfaces as a 401 tool error", async () => {
    const badTools = new Map<string, Tool>();
    (entry as unknown as { register: (api: unknown) => void }).register({
      pluginConfig: { apiUrl, apiKey: "invalid-key-invalid-key-invalid-key" },
      registerTool: (tool: Tool) => badTools.set(tool.name, tool),
      on: () => {},
    });
    await expect(badTools.get("saas_list_customers")!.execute("contract", {})).rejects.toThrow(
      /rejected the credentials \(401\)/,
    );
  });
});
