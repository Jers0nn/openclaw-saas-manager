import { readFileSync } from "node:fs";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import entry from "../index.js";
import { json, startMockApi } from "./helpers/mock-api.js";

const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const API_KEY = "plugin-entry-test-key-not-real-42";
const CUSTOMER_ID = "10000000-0000-4000-8000-000000000001";

type RegisteredTool = {
  tool: {
    name: string;
    label: string;
    description: string;
    parameters: object;
    resultContentSource?: string;
    execute: (id: string, params: unknown, signal?: AbortSignal) => Promise<{
      content: Array<{ type: string; text: string }>;
      details: unknown;
    }>;
  };
  options?: { name?: string; optional?: boolean };
};

type Hook = (event: { toolName: string; params: Record<string, unknown> }) => Promise<unknown>;

/** Registers the plugin against a minimal fake of the OpenClaw plugin API. */
function loadPlugin(pluginConfig: unknown) {
  const tools = new Map<string, RegisteredTool>();
  const hooks = new Map<string, Hook[]>();
  const fakeApi = {
    id: "saas-manager",
    name: "SaaS Manager",
    pluginConfig,
    config: { unrelated: "full OpenClaw config must not be used by this plugin" },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    registerTool(tool: RegisteredTool["tool"], options?: RegisteredTool["options"]) {
      tools.set(tool.name, { tool, options });
    },
    on(name: string, handler: Hook) {
      hooks.set(name, [...(hooks.get(name) ?? []), handler]);
    },
  };
  (entry as unknown as { register: (api: unknown) => void }).register(fakeApi);
  return { tools, hooks };
}

let closeApi: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closeApi?.();
  closeApi = undefined;
});

async function withMockApi() {
  const api = await startMockApi((req, res) => {
    if (req.method === "POST") return json(res, 201, { data: { id: CUSTOMER_ID, ...(req.body as object) } });
    return json(res, 200, { data: [], pagination: { limit: 20, offset: 0, total: 0 } });
  });
  closeApi = api.close;
  const plugin = loadPlugin({ apiUrl: api.url, apiKey: API_KEY, timeoutMs: 2000 });
  return { api, ...plugin };
}

describe("plugin registration", () => {
  it("has an id and name consistent with the manifest", () => {
    const def = entry as unknown as { id: string; name: string };
    expect(def.id).toBe(manifest.id);
    expect(def.name).toBe(manifest.name);
  });

  it("registers exactly the tools declared in openclaw.plugin.json", () => {
    const { tools } = loadPlugin({});
    expect([...tools.keys()].sort()).toEqual([...manifest.contracts.tools].sort());
  });

  it("gives every tool a label, description, parameters and network result source", () => {
    const { tools } = loadPlugin({});
    for (const { tool, options } of tools.values()) {
      expect(tool.label.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toBeTypeOf("object");
      expect(tool.resultContentSource).toBe("network");
      expect(options?.name).toBe(tool.name);
    }
  });

  it("marks only the write tool as optional, matching manifest toolMetadata", () => {
    const { tools } = loadPlugin({});
    const optional = [...tools.values()].filter((t) => t.options?.optional).map((t) => t.tool.name);
    expect(optional).toEqual(["saas_create_customer"]);
    const manifestOptional = Object.entries(manifest.toolMetadata as Record<string, { optional?: boolean }>)
      .filter(([, meta]) => meta.optional)
      .map(([name]) => name);
    expect(manifestOptional).toEqual(optional);
  });

  it("declares apiKey as a sensitive SecretRef-capable input", () => {
    expect(manifest.configContracts.secretInputs.paths).toEqual([
      { path: "apiKey", expected: "string", ownerKind: "capability" },
    ]);
    expect(manifest.uiHints.apiKey.sensitive).toBe(true);
    expect(manifest.configSchema.properties.apiKey.$ref).toBe("#/$defs/secretInput");
  });

  it("points the package extension entry at the built JavaScript", () => {
    expect(pkg.openclaw.extensions).toEqual(["./dist/index.js"]);
    expect(pkg.name).toBe(pkg.name.toLowerCase());
  });
});

describe("tool to endpoint mapping", () => {
  it("saas_list_customers -> GET /v1/customers with search, limit and offset", async () => {
    const { api, tools } = await withMockApi();
    await tools.get("saas_list_customers")!.tool.execute("c1", { search: "acme", limit: 5, offset: 10 });
    expect(api.requests).toMatchObject([
      { method: "GET", path: "/v1/customers", query: { search: "acme", limit: "5", offset: "10" } },
    ]);
    expect(api.requests[0]!.headers.authorization).toBe(`Bearer ${API_KEY}`);
  });

  it("saas_get_customer -> GET /v1/customers/:id", async () => {
    const { api, tools } = await withMockApi();
    await tools.get("saas_get_customer")!.tool.execute("c1", { customerId: CUSTOMER_ID });
    expect(api.requests).toMatchObject([{ method: "GET", path: `/v1/customers/${CUSTOMER_ID}`, query: {} }]);
  });

  it("saas_create_customer -> POST /v1/customers with a JSON body", async () => {
    const { api, tools } = await withMockApi();
    const result = await tools
      .get("saas_create_customer")!
      .tool.execute("c1", { name: "[TEST] Acme", email: "owner@acme.fixture.test" });
    expect(api.requests).toMatchObject([
      {
        method: "POST",
        path: "/v1/customers",
        body: { name: "[TEST] Acme", email: "owner@acme.fixture.test" },
      },
    ]);
    expect(api.requests[0]!.headers["content-type"]).toBe("application/json");
    expect(result.content[0]!.text).toMatch(/^Customer created \(confirmed by the SaaS API\):/);
  });

  it("saas_list_subscriptions -> GET /v1/subscriptions with filters", async () => {
    const { api, tools } = await withMockApi();
    await tools
      .get("saas_list_subscriptions")!
      .tool.execute("c1", { customerId: CUSTOMER_ID, status: "active", limit: 3 });
    expect(api.requests).toMatchObject([
      {
        method: "GET",
        path: "/v1/subscriptions",
        query: { customerId: CUSTOMER_ID, status: "active", limit: "3" },
      },
    ]);
  });

  it("saas_get_usage -> GET /v1/customers/:id/usage?period=", async () => {
    const { api, tools } = await withMockApi();
    await tools.get("saas_get_usage")!.tool.execute("c1", { customerId: CUSTOMER_ID, period: "2026-10" });
    expect(api.requests).toMatchObject([
      { method: "GET", path: `/v1/customers/${CUSTOMER_ID}/usage`, query: { period: "2026-10" } },
    ]);
  });

  it("returns the API payload both as text and as structured details", async () => {
    const { tools } = await withMockApi();
    const result = await tools.get("saas_list_customers")!.tool.execute("c1", {});
    expect(result.details).toEqual({ data: [], pagination: { limit: 20, offset: 0, total: 0 } });
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.details);
  });
});

describe("parameter schemas", () => {
  const schemaOf = (name: string) => loadPlugin({}).tools.get(name)!.tool.parameters as never;

  it.each([
    ["saas_get_customer", { customerId: "123" }],
    ["saas_get_customer", { customerId: `${CUSTOMER_ID}' OR '1'='1` }],
    ["saas_list_customers", { limit: 0 }],
    ["saas_list_customers", { limit: 101 }],
    ["saas_list_customers", { limit: 2.5 }],
    ["saas_list_customers", { unexpected: true }],
    ["saas_list_subscriptions", { status: "expired" }],
    ["saas_get_usage", { customerId: CUSTOMER_ID, period: "2026-13" }],
    ["saas_create_customer", { name: "", email: "owner@acme.fixture.test" }],
    ["saas_create_customer", { name: "[TEST] Acme" }],
  ])("%s rejects %j", (name, params) => {
    expect(Value.Check(schemaOf(name), params)).toBe(false);
  });

  it.each([
    ["saas_list_customers", {}],
    ["saas_list_customers", { search: "acme", limit: 100, offset: 0 }],
    ["saas_list_subscriptions", { status: "past_due" }],
    ["saas_get_usage", { customerId: CUSTOMER_ID }],
    ["saas_create_customer", { name: "[TEST] Acme", email: "owner@acme.fixture.test" }],
  ])("%s accepts %j", (name, params) => {
    expect(Value.Check(schemaOf(name), params)).toBe(true);
  });
});

describe("write approval", () => {
  const runHook = async (toolName: string, params: Record<string, unknown>) => {
    const { hooks } = loadPlugin({});
    const handlers = hooks.get("before_tool_call") ?? [];
    expect(handlers).toHaveLength(1);
    return handlers[0]!({ toolName, params });
  };

  it("requires per-call approval before saas_create_customer runs", async () => {
    const result = (await runHook("saas_create_customer", {
      name: "[TEST] Acme",
      email: "owner@acme.fixture.test",
    })) as { requireApproval: Record<string, unknown> };
    expect(result.requireApproval).toMatchObject({
      title: "Create SaaS customer",
      severity: "warning",
      allowedDecisions: ["allow-once", "deny"],
      timeoutMs: 120_000,
    });
    expect(result.requireApproval.description).toContain("[TEST] Acme");
    expect(result.requireApproval.description).toContain("owner@acme.fixture.test");
    expect((result.requireApproval.description as string).length).toBeLessThanOrEqual(512);
    expect((result.requireApproval.title as string).length).toBeLessThanOrEqual(80);
  });

  it("sanitizes and bounds user-supplied values in the approval prompt", async () => {
    const result = (await runHook("saas_create_customer", {
      name: `evil\u0000\n${"x".repeat(1000)}`,
      email: 42,
    })) as { requireApproval: { description: string } };
    expect(result.requireApproval.description).not.toMatch(/\u0000/);
    expect(result.requireApproval.description).toContain("Email: (missing)");
    expect(result.requireApproval.description.length).toBeLessThanOrEqual(512);
  });

  it.each(["saas_list_customers", "saas_get_customer", "saas_list_subscriptions", "saas_get_usage", "exec"])(
    "does not interfere with %s",
    async (toolName) => {
      expect(await runHook(toolName, {})).toBeUndefined();
    },
  );
});

describe("configuration handling", () => {
  it("reads apiUrl/apiKey from api.pluginConfig, not the global OpenClaw config", async () => {
    const { tools } = loadPlugin(undefined);
    await expect(tools.get("saas_list_customers")!.tool.execute("c1", {})).rejects.toThrow(
      /not configured: set plugins\.entries\.saas-manager\.config\.apiUrl/,
    );
  });

  it("surfaces API errors as thrown tool errors without leaking the key", async () => {
    const api = await startMockApi((_req, res) =>
      json(res, 404, { error: { code: "NOT_FOUND", message: "Customer not found" } }),
    );
    closeApi = api.close;
    const { tools } = loadPlugin({ apiUrl: api.url, apiKey: API_KEY });
    const failure = tools.get("saas_get_customer")!.tool.execute("c1", { customerId: CUSTOMER_ID });
    await expect(failure).rejects.toThrow("Not found (404): Customer not found");
    await failure.catch((error: Error) => expect(error.message).not.toContain(API_KEY));
  });
});
