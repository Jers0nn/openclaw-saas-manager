# SaaS Manager API — v1 reference

Base path: `/v1`. All request and response bodies are JSON (`application/json`).
The implementation lives in [`api/`](api/).

In this document `<API_URL>` means your deployed base URL, including `/v1`.
No public deployment exists yet.

## Authentication

Every endpoint except `GET /v1/health` requires an API key:

```
Authorization: Bearer <API_KEY>
```

- Keys are configured on the server with the `API_KEYS` environment variable
  (comma-separated, each at least 32 characters). Several keys can be active at
  the same time so you can rotate them without downtime.
- A missing, malformed or unknown key returns `401`.
- Authentication is checked before input validation, so an unauthenticated
  request never learns whether its parameters were valid.

## Conventions

### IDs

All IDs are UUIDs (for example `3f2b9c7e-8d1a-4c55-9e8f-2a6b1c0d4e5f`). A
malformed ID returns `422`, not `404`.

### Timestamps

ISO 8601 in UTC, for example `2026-10-07T05:07:10.449Z`.

### Pagination

List endpoints accept:

| Query param | Type | Default | Limits |
| --- | --- | --- | --- |
| `limit` | integer | 20 | 1–100 |
| `offset` | integer | 0 | 0–100000 |

They respond with:

```json
{ "data": [ ... ], "pagination": { "limit": 20, "offset": 0, "total": 57 } }
```

Results are ordered newest first (`createdAt` descending).

### Unknown parameters

Unknown query parameters and unknown body fields are rejected with `422`. This
catches typos such as `?staus=active` instead of silently ignoring them.

### Errors

Every error uses the same envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "email", "message": "must be a valid email address" }]
  },
  "requestId": "6f0c1b9e-3a54-4a4e-9d0e-2f1f7f3b8a11"
}
```

`details` is present only for validation errors. Error messages never contain
secrets, SQL, stack traces or internal hostnames. Use `requestId` when you look
for the request in the server logs.

| Status | `code` | When |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Malformed JSON body |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 404 | `NOT_FOUND` | Resource or route does not exist |
| 409 | `CONFLICT` | Unique constraint, e.g. duplicate customer email |
| 413 | `BAD_REQUEST` | Body larger than 16 KB |
| 415 | `BAD_REQUEST` | `Content-Type` is not JSON |
| 422 | `VALIDATION_ERROR` | Invalid path, query or body values |
| 429 | `RATE_LIMITED` | Too many requests from this client IP |
| 500 | `INTERNAL_ERROR` | Unexpected server error (generic message only) |
| 503 | — | Health check: database unavailable |

---

## GET /v1/health

Liveness and database check. **No authentication.** Use it as the hosting
platform's health check. It reveals no version or configuration details.

**200**

```json
{ "status": "ok", "checks": { "database": "ok" } }
```

**503** (database unreachable)

```json
{ "status": "error", "checks": { "database": "unavailable" } }
```

---

## GET /v1/customers

List customers, optionally filtered by a text search.

| Query param | Type | Description |
| --- | --- | --- |
| `search` | string, 1–200 chars | Case-insensitive substring match on `name` or `email`. `%` and `_` are matched literally. |
| `limit`, `offset` | integer | See [Pagination](#pagination) |

```bash
curl -H "Authorization: Bearer $SAAS_MANAGER_API_KEY" \
  "<API_URL>/customers?search=acme&limit=10"
```

**200**

```json
{
  "data": [
    {
      "id": "00000000-0000-4000-8000-000000000001",
      "name": "[DEMO] Acme Corp",
      "email": "billing@acme.demo.test",
      "status": "active",
      "createdAt": "2026-01-15T10:00:00.000Z",
      "updatedAt": "2026-10-07T05:07:10.449Z"
    }
  ],
  "pagination": { "limit": 10, "offset": 0, "total": 1 }
}
```

The examples in this document use the fictitious development seed data.

Customer `status` is `active` or `inactive`.

**Errors:** `401`, `422` (bad `limit`/`offset`, empty `search`, unknown param).

---

## GET /v1/customers/:id

Get one customer.

```bash
curl -H "Authorization: Bearer $SAAS_MANAGER_API_KEY" \
  "<API_URL>/customers/00000000-0000-4000-8000-000000000001"
```

**200**

```json
{ "data": { "id": "…", "name": "…", "email": "…", "status": "active", "createdAt": "…", "updatedAt": "…" } }
```

**Errors:** `401`, `404` (`Customer not found`), `422` (`id` is not a UUID).

---

## POST /v1/customers

Create a customer. **This is a write operation.**

Body (no other fields are accepted):

| Field | Type | Rules |
| --- | --- | --- |
| `name` | string | Required. 1–200 characters after trimming. No control characters. |
| `email` | string | Required. Valid email, max 320 characters. Must be unique (case-insensitive). |

New customers are created with `status: "active"`.

```bash
curl -X POST "<API_URL>/customers" \
  -H "Authorization: Bearer $SAAS_MANAGER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "[TEST] New Co", "email": "owner@newco.example.test"}'
```

**201** with a `Location: /v1/customers/<id>` header

```json
{ "data": { "id": "…", "name": "[TEST] New Co", "email": "owner@newco.example.test", "status": "active", "createdAt": "…", "updatedAt": "…" } }
```

**Errors:** `400` (malformed JSON), `401`, `409` (email already exists),
`413`, `415`, `422` (missing/invalid field, unknown field).

---

## GET /v1/subscriptions

List subscriptions.

| Query param | Type | Description |
| --- | --- | --- |
| `customerId` | UUID | Only this customer's subscriptions |
| `status` | enum | `trialing`, `active`, `past_due`, `paused`, `canceled` |
| `limit`, `offset` | integer | See [Pagination](#pagination) |

```bash
curl -H "Authorization: Bearer $SAAS_MANAGER_API_KEY" \
  "<API_URL>/subscriptions?status=active"
```

**200**

```json
{
  "data": [
    {
      "id": "00000000-0000-4000-8000-000000000101",
      "customerId": "00000000-0000-4000-8000-000000000001",
      "planCode": "demo-pro",
      "status": "active",
      "quantity": 5,
      "currentPeriodStart": "2026-10-01T00:00:00.000Z",
      "currentPeriodEnd": "2026-11-01T00:00:00.000Z",
      "cancelAt": null,
      "canceledAt": null,
      "createdAt": "…",
      "updatedAt": "…"
    }
  ],
  "pagination": { "limit": 20, "offset": 0, "total": 1 }
}
```

`planCode` is a free-form plan identifier today. A future `plans` resource will
use the same codes.

**Errors:** `401`, `422` (bad `customerId`, unknown `status`, bad pagination).

---

## GET /v1/customers/:id/usage

Usage totals per metric for one calendar month (UTC).

| Query param | Type | Description |
| --- | --- | --- |
| `period` | `YYYY-MM` | Month to summarize. Defaults to the current UTC month. |

The period covers `[start, end)`: from the first instant of the month,
inclusive, up to the first instant of the next month, exclusive.

```bash
curl -H "Authorization: Bearer $SAAS_MANAGER_API_KEY" \
  "<API_URL>/customers/00000000-0000-4000-8000-000000000001/usage?period=2026-10"
```

**200**

```json
{
  "data": {
    "customerId": "00000000-0000-4000-8000-000000000001",
    "period": "2026-10",
    "start": "2026-10-01T00:00:00.000Z",
    "end": "2026-11-01T00:00:00.000Z",
    "metrics": [
      { "metric": "api_calls", "total": "2000.0000", "events": 2 },
      { "metric": "storage_gb", "total": "12.5000", "events": 1 }
    ]
  }
}
```

- `total` is a **decimal string** (4 decimal places) to avoid floating-point
  rounding.
- `events` is the number of usage records summed.
- `metrics` is `[]` when nothing was recorded in the period.

**Errors:** `401`, `404` (`Customer not found`), `422` (bad `id` or `period`).

---

## Mapping to the OpenClaw tools

| Tool | Endpoint |
| --- | --- |
| `saas_list_customers` | `GET /v1/customers` |
| `saas_get_customer` | `GET /v1/customers/:id` |
| `saas_create_customer` | `POST /v1/customers` |
| `saas_list_subscriptions` | `GET /v1/subscriptions` |
| `saas_get_usage` | `GET /v1/customers/:id/usage` |

`tests/contract.test.ts` checks this mapping against the real API and database.

## CORS and rate limiting

- CORS is **off** by default: no `Access-Control-*` headers are sent. Set
  `CORS_ORIGINS` only when a browser app calls the API directly.
  Server-to-server clients such as the OpenClaw plugin do not need CORS.
- Rate limiting is applied per client IP (`RATE_LIMIT_MAX` per
  `RATE_LIMIT_WINDOW`, default 120 per minute). Behind a reverse proxy, set
  `TRUST_PROXY=true` so the real client IP is used.
