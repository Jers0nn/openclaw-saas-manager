import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));

/** Minimal frontmatter reader for flat `key: value` lines (no YAML dependency). */
function frontmatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error("SKILL.md has no frontmatter");
  return Object.fromEntries(
    match[1]!.split("\n").map((line) => {
      const index = line.indexOf(":");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
  );
}

describe("SKILL.md", () => {
  const meta = frontmatter(skill);

  it("has a valid Agent Skills frontmatter", () => {
    expect(meta.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(meta.name!.length).toBeLessThanOrEqual(64);
    expect(meta.description!.length).toBeGreaterThan(0);
    expect(meta.description!.length).toBeLessThanOrEqual(1024);
    expect(meta.compatibility!.length).toBeLessThanOrEqual(500);
    expect(meta.license).toBe("MIT");
  });

  it("only advertises capabilities that exist", () => {
    expect(meta.description).not.toMatch(/billing|MRR|invoice|payment|revenue|metrics/i);
  });

  it("documents every tool the plugin registers", () => {
    for (const tool of manifest.contracts.tools as string[]) {
      expect(skill).toContain(`\`${tool}\``);
    }
  });

  it("requires explicit confirmation for writes and explains the error codes", () => {
    expect(skill).toMatch(/Write operations \(require explicit confirmation\)/);
    for (const code of ["401", "404", "422", "500"]) {
      expect(skill).toContain(code);
    }
    expect(skill).toMatch(/Never invent/);
  });

  it("contains no credentials or concrete API URLs", () => {
    expect(skill).not.toMatch(/Bearer\s+\S{8,}/);
    expect(skill).not.toMatch(/https?:\/\/[^\s)]*\/v1/);
  });
});
