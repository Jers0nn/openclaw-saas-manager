import { z } from "zod";

/** Subscription states accepted by the database CHECK constraint. */
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "paused",
  "canceled",
] as const;

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

const pageLimit = z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE);
const pageOffset = z.coerce.number().int().min(0).max(100_000).default(0);

// Unicode control characters are never legitimate in names, emails or search terms.
const noControlChars = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);

export const CustomerIdParams = z.object({
  id: z.uuid({ message: "must be a valid UUID" }),
});

export const ListCustomersQuery = z.strictObject({
  search: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(noControlChars, "must not contain control characters")
    .optional(),
  limit: pageLimit,
  offset: pageOffset,
});

export const CreateCustomerBody = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(noControlChars, "must not contain control characters"),
  email: z
    .string()
    .trim()
    .max(320)
    .pipe(z.email({ message: "must be a valid email address" })),
});

export const ListSubscriptionsQuery = z.strictObject({
  customerId: z.uuid({ message: "must be a valid UUID" }).optional(),
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  limit: pageLimit,
  offset: pageOffset,
});

export const UsageQuery = z.strictObject({
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must use the format YYYY-MM")
    .optional(),
});

export type ListCustomersInput = z.infer<typeof ListCustomersQuery>;
export type CreateCustomerInput = z.infer<typeof CreateCustomerBody>;
export type ListSubscriptionsInput = z.infer<typeof ListSubscriptionsQuery>;
