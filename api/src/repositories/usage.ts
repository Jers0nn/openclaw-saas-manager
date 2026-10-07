import type { Queryable } from "../db.js";

export type UsagePeriod = {
  /** Calendar month in YYYY-MM form (UTC). */
  period: string;
  /** Inclusive start, ISO 8601. */
  start: string;
  /** Exclusive end, ISO 8601. */
  end: string;
};

export type UsageMetric = {
  metric: string;
  /** Decimal string to avoid floating point rounding (e.g. "1500.0000"). */
  total: string;
  events: number;
};

/** Resolves a YYYY-MM period (or the current UTC month) to a [start, end) range. */
export function resolvePeriod(period: string | undefined, now: Date = new Date()): UsagePeriod {
  const [year, month] = period
    ? period.split("-").map((part) => Number.parseInt(part, 10))
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const start = new Date(Date.UTC(year!, month! - 1, 1));
  const end = new Date(Date.UTC(year!, month!, 1));
  return {
    period: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export function createUsageRepository(db: Queryable) {
  return {
    async summarize(customerId: string, period: UsagePeriod): Promise<UsageMetric[]> {
      const result = await db.query<{ metric: string; total: string; events: number }>(
        `SELECT metric, SUM(quantity)::text AS total, COUNT(*)::int AS events
           FROM usage_records
          WHERE customer_id = $1 AND occurred_at >= $2 AND occurred_at < $3
          GROUP BY metric
          ORDER BY metric`,
        [customerId, period.start, period.end],
      );
      return result.rows.map((row) => ({
        metric: row.metric,
        total: row.total,
        events: row.events,
      }));
    },
  };
}

export type UsageRepository = ReturnType<typeof createUsageRepository>;
