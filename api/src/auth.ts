import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { unauthorized } from "./errors.js";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * Builds a Bearer-token verifier for the configured API keys.
 *
 * Keys are compared as SHA-256 digests with `timingSafeEqual`, so comparison
 * time does not depend on how many leading characters match. Every configured
 * key is checked (no early exit) so timing does not reveal which key matched.
 * Multiple keys are supported to allow rotation without downtime.
 */
export function createApiKeyVerifier(apiKeys: readonly string[]) {
  const expected = apiKeys.map(digest);

  return function verify(request: FastifyRequest): void {
    const header = request.headers.authorization;
    if (typeof header !== "string") throw unauthorized();

    const match = /^Bearer[ ]+(\S+)[ ]*$/i.exec(header);
    if (!match) throw unauthorized();

    const presented = digest(match[1]!);
    let ok = false;
    for (const candidate of expected) {
      if (timingSafeEqual(presented, candidate)) ok = true;
    }
    if (!ok) throw unauthorized();
  };
}
