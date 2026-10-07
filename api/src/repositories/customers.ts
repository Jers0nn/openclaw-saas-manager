import type { Queryable } from "../db.js";
import { conflict } from "../errors.js";
import type { CreateCustomerInput, ListCustomersInput } from "../schemas.js";

export type Customer = {
  id: string;
  name: string;
  email: string;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  status: Customer["status"];
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = "id, name, email, status, created_at, updated_at";

const toCustomer = (row: CustomerRow): Customer => ({
  id: row.id,
  name: row.name,
  email: row.email,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/** Escapes LIKE wildcards so user input is matched literally. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export function createCustomerRepository(db: Queryable) {
  return {
    async list(input: ListCustomersInput): Promise<{ items: Customer[]; total: number }> {
      const values: unknown[] = [];
      let where = "";
      if (input.search) {
        values.push(`%${escapeLike(input.search)}%`);
        where = `WHERE name ILIKE $1 ESCAPE '\\' OR email ILIKE $1 ESCAPE '\\'`;
      }

      const total = await db.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM customers ${where}`,
        values,
      );

      values.push(input.limit, input.offset);
      const rows = await db.query<CustomerRow>(
        `SELECT ${COLUMNS} FROM customers ${where}
         ORDER BY created_at DESC, id
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );

      return { items: rows.rows.map(toCustomer), total: total.rows[0]?.count ?? 0 };
    },

    async getById(id: string): Promise<Customer | null> {
      const result = await db.query<CustomerRow>(
        `SELECT ${COLUMNS} FROM customers WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      return row ? toCustomer(row) : null;
    },

    async exists(id: string): Promise<boolean> {
      const result = await db.query("SELECT 1 FROM customers WHERE id = $1", [id]);
      return (result.rowCount ?? 0) > 0;
    },

    async create(input: CreateCustomerInput): Promise<Customer> {
      try {
        const result = await db.query<CustomerRow>(
          `INSERT INTO customers (name, email) VALUES ($1, $2) RETURNING ${COLUMNS}`,
          [input.name, input.email],
        );
        return toCustomer(result.rows[0]!);
      } catch (error) {
        if (isUniqueViolation(error, "customers_email_lower_key")) {
          throw conflict("A customer with this email already exists");
        }
        throw error;
      }
    },
  };
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505" &&
    (error as { constraint?: unknown }).constraint === constraint
  );
}

export type CustomerRepository = ReturnType<typeof createCustomerRepository>;
