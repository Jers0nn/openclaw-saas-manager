import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";
import { escapeLike } from "../src/repositories/customers.js";
import { resolvePeriod } from "../src/repositories/usage.js";

const validKey = "k".repeat(32);
const baseEnv = { DATABASE_URL: "postgres://localhost/saas_manager_dev", API_KEYS: validKey };

describe("loadConfig", () => {
  it("parses a minimal valid environment with safe defaults", () => {
    const config = loadConfig(baseEnv);
    expect(config).toMatchObject({
      nodeEnv: "development",
      port: 3000,
      apiKeys: [validKey],
      corsOrigins: [],
      databaseSsl: "false",
      trustProxy: false,
    });
  });

  it("supports several comma-separated API keys for rotation", () => {
    const other = "o".repeat(40);
    expect(loadConfig({ ...baseEnv, API_KEYS: ` ${validKey} , ${other} ` }).apiKeys).toEqual([
      validKey,
      other,
    ]);
  });

  it.each([
    [{ API_KEYS: undefined }, /API_KEYS must contain/],
    [{ API_KEYS: "short-key" }, /at least 32 characters/],
    [{ API_KEYS: "replace-with-a-generated-key-of-at-least-32-chars" }, /placeholder/],
    [{ API_KEYS: `${validKey},${validKey}` }, /duplicate/],
    [{ DATABASE_URL: undefined }, /DATABASE_URL/],
    [{ CORS_ORIGINS: "*" }, /'\*' is not allowed/],
    [{ CORS_ORIGINS: "https://ok.fixture.test/" }, /bare origins/],
    [{ PORT: "99999" }, /PORT/],
  ])("rejects %j", (overrides, message) => {
    expect(() => loadConfig({ ...baseEnv, ...overrides })).toThrow(message);
  });

  it("never includes secret values in error messages", () => {
    const secret = "short-secret-value";
    try {
      loadConfig({ ...baseEnv, API_KEYS: secret });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).not.toContain(secret);
    }
  });
});

describe("resolvePeriod", () => {
  it("maps YYYY-MM to a UTC [start, end) range", () => {
    expect(resolvePeriod("2026-12")).toEqual({
      period: "2026-12",
      start: "2026-12-01T00:00:00.000Z",
      end: "2027-01-01T00:00:00.000Z",
    });
  });

  it("defaults to the current UTC month", () => {
    expect(resolvePeriod(undefined, new Date("2026-02-28T23:30:00-05:00")).period).toBe("2026-03");
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards and the escape character", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});
