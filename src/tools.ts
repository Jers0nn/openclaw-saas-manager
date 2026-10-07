import { Type, type Static, type TSchema } from "typebox";
import type { SaasClient } from "./client.js";

export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "paused", "canceled"] as const;

const UUID_PATTERN = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

const CustomerId = (description: string) =>
  Type.String({ description, pattern: UUID_PATTERN, minLength: 36, maxLength: 36 });

const Limit = Type.Optional(
  Type.Integer({ description: "Maximum number of results (1-100, default 20)", minimum: 1, maximum: 100 }),
);
const Offset = Type.Optional(
  Type.Integer({ description: "Number of results to skip for pagination (default 0)", minimum: 0, maximum: 100000 }),
);

export const ListCustomersParams = Type.Object(
  {
    search: Type.Optional(
      Type.String({
        description: "Case-insensitive text matched against customer name or email",
        minLength: 1,
        maxLength: 200,
      }),
    ),
    limit: Limit,
    offset: Offset,
  },
  { additionalProperties: false },
);

export const GetCustomerParams = Type.Object(
  { customerId: CustomerId("Customer ID (UUID) as returned by saas_list_customers") },
  { additionalProperties: false },
);

export const CreateCustomerParams = Type.Object(
  {
    name: Type.String({ description: "Customer or company name", minLength: 1, maxLength: 200 }),
    email: Type.String({ description: "Customer email address (must be unique)", format: "email", maxLength: 320 }),
  },
  { additionalProperties: false },
);

export const ListSubscriptionsParams = Type.Object(
  {
    customerId: Type.Optional(CustomerId("Only return subscriptions for this customer ID (UUID)")),
    status: Type.Optional(
      Type.Union(
        SUBSCRIPTION_STATUSES.map((status) => Type.Literal(status)),
        { description: "Only return subscriptions with this status" },
      ),
    ),
    limit: Limit,
    offset: Offset,
  },
  { additionalProperties: false },
);

export const GetUsageParams = Type.Object(
  {
    customerId: CustomerId("Customer ID (UUID)"),
    period: Type.Optional(
      Type.String({
        description: "Calendar month in UTC, format YYYY-MM. Defaults to the current month.",
        pattern: "^\\d{4}-(0[1-9]|1[0-2])$",
      }),
    ),
  },
  { additionalProperties: false },
);

export type SaasTool<S extends TSchema = TSchema> = {
  name: string;
  label: string;
  description: string;
  parameters: S;
  /** Tool output includes data stored in an external system (customer names, emails…). */
  resultContentSource: "network";
  execute: (
    toolCallId: string,
    params: Static<S>,
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>;
};

const asResult = (data: unknown, prefix?: string) => ({
  content: [
    {
      type: "text" as const,
      text: `${prefix ? `${prefix}\n` : ""}${JSON.stringify(data, null, 2)}`,
    },
  ],
  details: data,
});

/**
 * Builds the SaaS Manager tools. Each tool maps 1:1 to a REST endpoint:
 *
 * | Tool                     | Endpoint                          |
 * | ------------------------ | --------------------------------- |
 * | saas_list_customers      | GET  /v1/customers                |
 * | saas_get_customer        | GET  /v1/customers/:id            |
 * | saas_create_customer     | POST /v1/customers                |
 * | saas_list_subscriptions  | GET  /v1/subscriptions            |
 * | saas_get_usage           | GET  /v1/customers/:id/usage      |
 *
 * `getClient` is called on every execution so configuration problems surface
 * as tool errors (with a safe message) instead of breaking plugin registration.
 */
export function createSaasTools(getClient: () => SaasClient) {
  const listCustomers: SaasTool<typeof ListCustomersParams> = {
    name: "saas_list_customers",
    label: "SaaS: list customers",
    description:
      "Read-only. List or search customers in the SaaS Manager API. Supports a text search on name/email and pagination.",
    parameters: ListCustomersParams,
    resultContentSource: "network",
    async execute(_id, params, signal) {
      const data = await getClient()("/customers", {
        query: { search: params.search, limit: params.limit, offset: params.offset },
        signal,
      });
      return asResult(data);
    },
  };

  const getCustomer: SaasTool<typeof GetCustomerParams> = {
    name: "saas_get_customer",
    label: "SaaS: get customer",
    description: "Read-only. Get one customer by its ID (UUID).",
    parameters: GetCustomerParams,
    resultContentSource: "network",
    async execute(_id, params, signal) {
      const data = await getClient()(`/customers/${encodeURIComponent(params.customerId)}`, { signal });
      return asResult(data);
    },
  };

  const createCustomer: SaasTool<typeof CreateCustomerParams> = {
    name: "saas_create_customer",
    label: "SaaS: create customer",
    description:
      "WRITE operation. Creates a new customer record. Only call this after the user has explicitly asked to create " +
      "this exact customer and confirmed the name and email. Never call it to answer a question. " +
      "OpenClaw will additionally ask the user to approve the call.",
    parameters: CreateCustomerParams,
    resultContentSource: "network",
    async execute(_id, params, signal) {
      const data = await getClient()("/customers", {
        method: "POST",
        body: { name: params.name, email: params.email },
        signal,
      });
      return asResult(data, "Customer created (confirmed by the SaaS API):");
    },
  };

  const listSubscriptions: SaasTool<typeof ListSubscriptionsParams> = {
    name: "saas_list_subscriptions",
    label: "SaaS: list subscriptions",
    description:
      "Read-only. List subscriptions, optionally filtered by customer ID and/or status " +
      `(${SUBSCRIPTION_STATUSES.join(", ")}).`,
    parameters: ListSubscriptionsParams,
    resultContentSource: "network",
    async execute(_id, params, signal) {
      const data = await getClient()("/subscriptions", {
        query: {
          customerId: params.customerId,
          status: params.status,
          limit: params.limit,
          offset: params.offset,
        },
        signal,
      });
      return asResult(data);
    },
  };

  const getUsage: SaasTool<typeof GetUsageParams> = {
    name: "saas_get_usage",
    label: "SaaS: get usage",
    description:
      "Read-only. Get a customer's usage totals per metric for one calendar month (UTC). " +
      "Totals are decimal strings exactly as stored.",
    parameters: GetUsageParams,
    resultContentSource: "network",
    async execute(_id, params, signal) {
      const data = await getClient()(`/customers/${encodeURIComponent(params.customerId)}/usage`, {
        query: { period: params.period },
        signal,
      });
      return asResult(data);
    },
  };

  return { listCustomers, getCustomer, createCustomer, listSubscriptions, getUsage };
}
