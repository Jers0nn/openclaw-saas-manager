import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const render = read("render.yaml");
const apiPkg = JSON.parse(read("api/package.json"));
const dockerfile = read("api/Dockerfile");
const dockerignore = read("api/.dockerignore");

/** Returns the scalar value of `key:` in render.yaml (first occurrence). */
const yamlValue = (key: string) => new RegExp(`^\\s*-?\\s*${key}:\\s*(.+)$`, "m").exec(render)?.[1]?.trim();

describe("deployment configuration", () => {
  it("deploys only the api/ folder with the documented commands", () => {
    expect(yamlValue("rootDir")).toBe("api");
    expect(yamlValue("runtime")).toBe("node");
    expect(yamlValue("healthCheckPath")).toBe("/v1/health");
    expect(yamlValue("startCommand")).toBe("npm run start:prod");
    expect(yamlValue("buildCommand")).toBe("npm ci --include=dev && npm run build && npm prune --omit=dev");
    expect(apiPkg.scripts["start:prod"]).toBe("npm run migrate:up && node dist/server.js");
    expect(apiPkg.scripts.build).toBeDefined();
  });

  it("uses free plans by default so applying the Blueprint costs nothing", () => {
    const plans = [...render.matchAll(/^\s*plan:\s*(\S+)/gm)].map((m) => m[1]);
    expect(plans).toEqual(["free", "free"]);
  });

  it("contains no secret values: API_KEYS is prompted, DATABASE_URL comes from the database", () => {
    expect(render).toMatch(/- key: API_KEYS\n\s+sync: false/);
    expect(render).toMatch(/- key: DATABASE_URL\n\s+fromDatabase:/);
    expect(render).not.toMatch(/generateValue/);
    expect(render).not.toMatch(/postgres(ql)?:\/\//);
  });

  it("keeps the database private", () => {
    expect(render).toMatch(/ipAllowList: \[\]/);
  });

  it("pins the Node major version for the API", () => {
    expect(read("api/.node-version").trim()).toBe("24");
    expect(dockerfile).toMatch(/^FROM node:24-slim/m);
  });

  it("builds a production image without secrets, tests or seed data", () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).not.toMatch(/^\s*(ENV|ARG)\s+(API_KEYS|DATABASE_URL)\b/m);
    for (const entry of [".env", "test", "seeds", "node_modules"]) {
      expect(dockerignore.split("\n")).toContain(entry);
    }
  });

  it("ships the migrations the API needs at start", () => {
    expect(existsSync(new URL("../api/migrations", import.meta.url))).toBe(true);
    expect(dockerfile).toMatch(/COPY migrations \.\/migrations/);
  });
});
