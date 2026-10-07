// Copies the canonical root SKILL.md into dist/skills/saas-manager/ so the
// OpenClaw plugin ships the Skill (manifest: "skills": ["./dist/skills"]).
// SKILL.md at the repository root stays the single source of truth; it is also
// what LobeHub and other SKILL.md-compatible agents import from GitHub.
import { copyFile, mkdir } from "node:fs/promises";

const target = new URL("../dist/skills/saas-manager/", import.meta.url);
await mkdir(target, { recursive: true });
await copyFile(new URL("../SKILL.md", import.meta.url), new URL("SKILL.md", target));
console.log("Copied SKILL.md -> dist/skills/saas-manager/SKILL.md");
