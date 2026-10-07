import type { Queryable } from "../db.js";
import type { ListSubscriptionsInput, SUBSCRIPTION_STATUSES } from "../schemas.js";

export type Subscription = {
  id: string;
  customerId: string;
  planCode: string;
  status: (typeof SUBSCRIPTION_STATUSES)[number];
  quantity: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SubscriptionRow = {
  id: string;
  customer_id: string;
  plan_code: string;
  status: Subscription["status"];
  quantity: number;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at: Date | null;
  canceled_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = `id, customer_id, plan_code, status, quantity, current_period_start,
  current_period_end, cancel_at, canceled_at, created_at, updated_at`;

const iso = (value: Date | null) => (value ? value.toISOString() : null);

const toSubscription = (row: SubscriptionRow): Subscription => ({
  id: row.id,
  customerId: row.customer_id,
  planCode: row.plan_code,
  status: row.status,
  quantity: row.quantity,
  currentPeriodStart: iso(row.current_period_start),
  currentPeriodEnd: iso(row.current_period_end),
  cancelAt: iso(row.cancel_at),
  canceledAt: iso(row.canceled_at),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

export function createSubscriptionRepository(db: Queryable) {
  return {
    async list(input: ListSubscriptionsInput): Promise<{ items: Subscription[]; total: number }> {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (input.customerId) {
        values.push(input.customerId);
        conditions.push(`customer_id = $${values.length}`);
      }
      if (input.status) {
        values.push(input.status);
        conditions.push(`status = $${values.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const total = await db.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM subscriptions ${where}`,
        values,
      );

      values.push(input.limit, input.offset);
      const rows = await db.query<SubscriptionRow>(
        `SELECT ${COLUMNS} FROM subscriptions ${where}
         ORDER BY created_at DESC, id
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );

      return { items: rows.rows.map(toSubscription), total: total.rows[0]?.count ?? 0 };
    },
  };
}

export type SubscriptionRepository = ReturnType<typeof createSubscriptionRepository>;
