import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { z } from "zod";
import { createApiKeyVerifier } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { Queryable } from "./db.js";
import { ApiError, notFound } from "./errors.js";
import { createCustomerRepository } from "./repositories/customers.js";
import { createSubscriptionRepository } from "./repositories/subscriptions.js";
import { createUsageRepository, resolvePeriod } from "./repositories/usage.js";
import {
  CreateCustomerBody,
  CustomerIdParams,
  ListCustomersQuery,
  ListSubscriptionsQuery,
  UsageQuery,
} from "./schemas.js";

export type BuildAppOptions = {
  config: Pick<
    AppConfig,
    "apiKeys" | "corsOrigins" | "rateLimitMax" | "rateLimitWindow" | "trustProxy"
  >;
  db: Queryable;
  /** Fastify logger options. Defaults to disabled (useful for tests). */
  logger?: FastifyServerOptions["logger"];
};

/** Parses input with a Zod schema, converting failures into a 422 ApiError. */
function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  throw new ApiError(
    422,
    "VALIDATION_ERROR",
    "Request validation failed",
    result.error.issues.map((issue) => ({
      path: issue.path.map(String).join(".") || "(root)",
      // Zod messages describe the rule that failed; they never echo the input value.
      message: issue.message,
    })),
  );
}

/** Strips the query string so search terms (e.g. emails) never reach logs. */
const pathOnly = (url: string) => url.split("?", 1)[0] ?? url;

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, db } = options;

  // Keep logs free of credentials and personal data: redact auth headers as a
  // safety net and log request paths without their query strings.
  const logger = options.logger
    ? {
        ...(typeof options.logger === "object" ? options.logger : {}),
        redact: {
          paths: ["req.headers.authorization", "req.headers.cookie", "headers.authorization"],
          censor: "[REDACTED]",
        },
        serializers: {
          req: (req: { method: string; url: string; id: string }) => ({
            method: req.method,
            url: pathOnly(req.url),
            requestId: req.id,
          }),
        },
      }
    : false;

  const app = Fastify({
    logger,
    trustProxy: config.trustProxy,
    bodyLimit: 16 * 1024,
    // Always generate request ids server-side; never trust a client-supplied one.
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });

  await app.register(helmet, { global: true });
  await app.register(cors, {
    // No configured origins means no CORS headers at all (server-to-server use only).
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    errorResponseBuilder: (_request, context) =>
      new ApiError(429, "RATE_LIMITED", `Rate limit exceeded, retry in ${context.after}`),
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        requestId: request.id,
      });
    }

    // Known client errors raised by Fastify itself (malformed JSON, wrong
    // content type, oversized body). Their messages contain no secrets.
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.status(status).send({
        error: {
          code: status === 429 ? "RATE_LIMITED" : "BAD_REQUEST",
          message: status === 413 ? "Request body too large" : "Malformed request",
        },
        requestId: request.id,
      });
    }

    // Anything else is unexpected: log it server-side, return a generic message.
    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      requestId: request.id,
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Route not found" },
      requestId: request.id,
    }),
  );

  const customers = createCustomerRepository(db);
  const subscriptions = createSubscriptionRepository(db);
  const usage = createUsageRepository(db);

  // Public health check (used by the hosting platform). Reveals no versions or secrets.
  app.get("/v1/health", async (request, reply) => {
    try {
      await db.query("SELECT 1");
      return { status: "ok", checks: { database: "ok" } };
    } catch (error) {
      request.log.error({ err: error }, "health check failed");
      return reply.status(503).send({ status: "error", checks: { database: "unavailable" } });
    }
  });

  // Everything else under /v1 requires a valid API key.
  await app.register(
    async (scope) => {
      const verify = createApiKeyVerifier(config.apiKeys);
      scope.addHook("onRequest", async (request) => verify(request));

      scope.get("/customers", async (request) => {
        const query = parse(ListCustomersQuery, request.query);
        const { items, total } = await customers.list(query);
        return {
          data: items,
          pagination: { limit: query.limit, offset: query.offset, total },
        };
      });

      scope.get("/customers/:id", async (request) => {
        const { id } = parse(CustomerIdParams, request.params);
        const customer = await customers.getById(id);
        if (!customer) throw notFound("Customer");
        return { data: customer };
      });

      scope.post("/customers", async (request, reply) => {
        const body = parse(CreateCustomerBody, request.body);
        const customer = await customers.create(body);
        return reply.status(201).header("Location", `/v1/customers/${customer.id}`).send({
          data: customer,
        });
      });

      scope.get("/customers/:id/usage", async (request) => {
        const { id } = parse(CustomerIdParams, request.params);
        const { period } = parse(UsageQuery, request.query);
        if (!(await customers.exists(id))) throw notFound("Customer");
        const range = resolvePeriod(period);
        const metrics = await usage.summarize(id, range);
        return { data: { customerId: id, ...range, metrics } };
      });

      scope.get("/subscriptions", async (request) => {
        const query = parse(ListSubscriptionsQuery, request.query);
        const { items, total } = await subscriptions.list(query);
        return {
          data: items,
          pagination: { limit: query.limit, offset: query.offset, total },
        };
      });
    },
    { prefix: "/v1" },
  );

  return app;
}
