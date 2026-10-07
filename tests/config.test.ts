import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEOUT_MS, resolveConfig, SaasConfigError } from "../src/config.js";

const KEY = "config-test-key-not-real-abcdef";

describe("resolveConfig", () => {
  it("accepts https URLs and strips trailing slashes", () => {
    expect(resolveConfig({ apiUrl: "https://api.fixture.test/v1/", apiKey: ` ${KEY} ` })).toEqual({
      apiUrl: "https://api.fixture.test/v1",
      apiKey: KEY,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  });

  it("allows plain http only for localhost", () => {
    expect(resolveConfig({ apiUrl: "http://localhost:3000/v1", apiKey: KEY }).apiUrl).toBe(
      "http://localhost:3000/v1",
    );
    expect(() => resolveConfig({ apiUrl: "http://api.fixture.test/v1", apiKey: KEY })).toThrow(
      /must use https/,
    );
  });

  it.each([
    [undefined, /not configured/],
    [{}, /not configured/],
    [{ apiUrl: "not a url", apiKey: KEY }, /not a valid URL/],
    [{ apiUrl: "ftp://api.fixture.test/v1", apiKey: KEY }, /must use https/],
    [{ apiUrl: "https://user:pass@api.fixture.test/v1", apiKey: KEY }, /must not contain credentials/],
    [{ apiUrl: "https://api.fixture.test/v1?x=1", apiKey: KEY }, /query string/],
    [{ apiUrl: "https://api.fixture.test/v1" }, /API key is missing/],
    [{ apiUrl: "https://api.fixture.test/v1", apiKey: "   " }, /API key is missing/],
    [{ apiUrl: "https://api.fixture.test/v1", apiKey: KEY, timeoutMs: 10 }, /timeoutMs/],
  ])("rejects %j", (raw, message) => {
    expect(() => resolveConfig(raw)).toThrow(SaasConfigError);
    expect(() => resolveConfig(raw)).toThrow(message);
  });

  it("never includes the API key in error messages", () => {
    try {
      resolveConfig({ apiUrl: "https://api.fixture.test/v1", apiKey: KEY, timeoutMs: "slow" });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(KEY);
    }
  });
});
