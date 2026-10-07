# OpenClaw SaaS Manager

Manage SaaS customers, subscriptions and usage from an AI agent.

This repository contains three parts that are deployed separately:

| Part | Folder | What it is |
| --- | --- | --- |
| **OpenClaw plugin** | repository root (`index.ts`, `src/`, `openclaw.plugin.json`) | Five agent tools that call the SaaS Manager API |
| **Agent Skill** | `SKILL.md` | Instructions that teach an agent how to use the tools safely (OpenClaw, LobeHub and other SKILL.md-compatible agents) |
| **SaaS Manager API** | `api/` | REST API (`/v1`) with PostgreSQL. Node.js, Fastify, Zod and node-pg-migrate |

> **Status:** works end to end in local development and in automated tests.
> No public API deployment exists yet. Deployment is prepared in a later phase.

## Architecture

```
 OpenClaw agent  ─┐                      LobeHub
 (or LobeHub's    │                         │
  "Connect        │  reads                  │  reads
  External        ▼                         ▼
  Agents")    SKILL.md                  SKILL.md (imported Skill)
                  │                         │
                  ▼  calls tools            ▼  needs a connector (MCP) to call tools
          OpenClaw plugin              (not implemented yet, see "LobeHub")
          saas_* tools
                  │  HTTPS + Authorization: Bearer <API key>
                  ▼
          SaaS Manager API  (/v1, api/)
                  │
                  ▼
             PostgreSQL
```

- The **plugin** only talks HTTP to the API. It has no database access and
  does not depend on code in `api/`.
- The **API** is self-contained in `api/` (own `package.json`, build, tests and
  migrations), so it can be deployed or moved to its own repository later.
- The **Skill** contains no code and no data. It tells the agent when to use
  each tool, to confirm before writing, and never to invent data.

### Tools ↔ endpoints

| Tool | Type | Endpoint |
| --- | --- | --- |
| `saas_list_customers` | read | `GET /v1/customers` |
| `saas_get_customer` | read | `GET /v1/customers/:id` |
| `saas_create_customer` | **write** | `POST /v1/customers` |
| `saas_list_subscriptions` | read | `GET /v1/subscriptions` |
| `saas_get_usage` | read | `GET /v1/customers/:id/usage` |

Full endpoint reference: [API.md](API.md).

## Requirements

- **API:** Node.js 22.12+ and PostgreSQL 13+ (16 recommended).
- **Plugin:** OpenClaw **2026.8.35 or newer**. OpenClaw itself requires Node.js
  24.16+ (or 26.1+). Building and testing the plugin works on Node.js 22.12+.

## Run the API locally

```bash
cd api
npm install

# 1. Start a local PostgreSQL (Docker), or use your own PostgreSQL 13+ server.
#    It also creates the saas_manager_test database used by the tests.
docker compose up -d

# 2. Configure the environment
cp .env.example .env
#    Edit .env: set DATABASE_URL and API_KEYS. Generate a key with:
#    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#    Then load the variables into your shell, for example:
set -a; . ./.env; set +a

# 3. Create the tables
npm run migrate:up

# 4. (Optional) load fictitious demo data: "[DEMO]" names, *.demo.test emails
npm run seed:dev

# 5. Start
npm run dev            # development, auto-reload
# or
npm run build && npm start

curl http://localhost:3000/v1/health
curl -H "Authorization: Bearer $API_KEYS" http://localhost:3000/v1/customers   # if you configured one key
```

`seed:dev` refuses to run with `NODE_ENV=production` or against a non-local
database host unless you explicitly set `ALLOW_REMOTE_SEED=true`.

### API environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `API_KEYS` | yes | — | Comma-separated Bearer keys, each at least 32 characters |
| `DATABASE_SSL` | no | `false` | `false`, `true` (TLS without cert check) or `verify` (TLS with cert check) |
| `PORT` / `HOST` | no | `3000` / `0.0.0.0` | Listen address |
| `NODE_ENV` | no | `development` | `development`, `test` or `production` |
| `LOG_LEVEL` | no | `info` | Pino log level |
| `CORS_ORIGINS` | no | empty (CORS off) | Comma-separated browser origins, no `*` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` | no | `120` / `1 minute` | Per-IP rate limit |
| `TRUST_PROXY` | no | `false` | `true` behind a trusted reverse proxy |
| `TEST_DATABASE_URL` | tests | — | Disposable database whose name ends in `_test` |

See [`api/.env.example`](api/.env.example). Never commit a `.env` file:
`.gitignore` excludes it.

### Database schema

Migrations live in `api/migrations/` (plain SQL with `-- Up` / `-- Down`
sections, run by node-pg-migrate):

- `customers`: unique email (case-insensitive), `active`/`inactive` status
- `subscriptions`: `plan_code`, status, quantity, billing period dates
- `usage_records`: append-only metered events (`metric`, `quantity`,
  `occurred_at`, optional `idempotency_key`)

Every table has UUID keys, timestamps and a `metadata` JSONB column, so plans,
invoices, payments and analytics can be added later without rewriting this data.

```bash
npm run migrate:up      # apply pending migrations
npm run migrate:down    # roll back the last migration (development only)
npm run migrate -- create add-plans-table --migration-file-language sql
```

## Install the OpenClaw plugin

The plugin is not published to npm or ClawHub yet. To try it locally:

```bash
npm install
npm run build
npm pack --pack-destination /tmp
openclaw plugins install npm-pack:/tmp/jers0nn-openclaw-saas-manager-1.1.0.tgz
```

OpenClaw asks you to accept the plugin's capabilities. The plugin stays
disabled until it is configured.

### Configure it (API key as a secret)

Store the API key in an environment variable on the machine that runs the
OpenClaw Gateway, and reference it with a **SecretRef**. The key is then never
written to `openclaw.json`:

```bash
export SAAS_MANAGER_API_KEY="<your API key>"   # e.g. in the Gateway's service environment

openclaw config set plugins.entries.saas-manager.config.apiUrl "https://<your-api-host>/v1"
openclaw config set plugins.entries.saas-manager.config.apiKey \
  --ref-provider default --ref-source env --ref-id SAAS_MANAGER_API_KEY
openclaw plugins enable saas-manager

openclaw plugins inspect saas-manager --runtime --json   # should show status "loaded"
openclaw secrets audit --check                           # should report plaintext=0
```

The same settings as JSON (`plugins.entries.saas-manager`):

```json
{
  "enabled": true,
  "config": {
    "apiUrl": "https://<your-api-host>/v1",
    "apiKey": { "source": "env", "provider": "default", "id": "SAAS_MANAGER_API_KEY" },
    "timeoutMs": 10000
  }
}
```

| Setting | Required | Description |
| --- | --- | --- |
| `apiUrl` | yes | API base URL **including `/v1`**. Must be `https://`. Plain `http://` is accepted only for `localhost`. |
| `apiKey` | yes | API key: a SecretRef (`env`, `file`, `exec` or `store`) or plaintext. Plaintext is discouraged. |
| `timeoutMs` | no | Per-request timeout, 1000–60000 ms (default 10000) |

### Write safety: `saas_create_customer`

Creating a customer is protected twice, using OpenClaw's documented mechanisms:

1. **Optional tool (opt-in).** The tool is hidden from the model until the
   operator allows it:

   ```bash
   openclaw config set tools.alsoAllow '["saas_create_customer"]' --strict-json
   ```

2. **Per-call approval.** A `before_tool_call` hook returns `requireApproval`,
   so every call waits for a human to choose *Allow once* or *Deny*. *Allow
   always* is not offered. If the approval is denied, times out (2 minutes) or
   no approval surface is connected, OpenClaw blocks the call.

The Skill also tells the agent to confirm the exact name and email with the
user before calling the tool.

The read tools need no opt-in and no approval.

## LobeHub

The LobeHub documentation (checked in the `lobehub/lobehub` repository, October
2026) describes two different setups:

1. **Connect OpenClaw as an external agent (no MCP needed).** In LobeHub,
   *Create Agent → Connect External Agents → OpenClaw*. The agent runs inside
   your own OpenClaw, on a device connected through the LobeHub desktop app or
   the LobeHub CLI, so it uses this plugin and its Skill directly. LobeHub
   lists platform agents as **beta**. Enable them in *Settings → Advanced → Labs*.
2. **A native LobeHub agent.** A LobeHub Skill is instructions only: it cannot
   call an API by itself. External tools are connected through **Connectors**:
   service connectors or MCP integrations over HTTP or STDIO; STDIO works on
   desktop only. A native LobeHub agent would therefore need an **MCP server**
   that exposes the same five operations. This repository does not include one
   yet.

To import the Skill into LobeHub: *Skills → Add Skill… → Add → import from
GitHub* with this repository's URL. The `SKILL.md` must be at the root of the
directory you import.

## Development

```bash
npm install            # plugin dependencies
npm run typecheck
npm test               # plugin tests
npm run build          # compiles to dist/ and copies SKILL.md to dist/skills/

cd api
npm install
npm run typecheck
npm test               # API tests (needs TEST_DATABASE_URL, see below)
npm run build
```

### Tests

- **API (`api/test/`)** runs against a real PostgreSQL database.
  `TEST_DATABASE_URL` must point to a disposable database whose name ends in
  `_test`; the tests refuse any other database. They apply the migrations,
  truncate the tables and insert fictitious `[TEST]` fixtures before each test.
  To run only the tests that need no database: `SKIP_DB_TESTS=1 npm test`.
- **Plugin (`tests/`)**
  - unit tests run against a local mock HTTP server: no real API, no real data
  - `tests/contract.test.ts` runs the real plugin tools against the real API
    and test database. It runs when `TEST_DATABASE_URL` is set and `api/`
    dependencies are installed.

```bash
export TEST_DATABASE_URL="postgres://<user>:<password>@localhost:5432/saas_manager_test"
npm test && (cd api && npm test)
```

## Deployment

Not done yet. The API is designed for a managed platform (build command,
start command, `/v1/health` check, `DATABASE_URL`, `API_KEYS`, migrations as a
release step). Instructions will be added once a platform is chosen.

## Security

- **No secrets in code or Git:** keys come from environment variables (API) or
  OpenClaw SecretRefs (plugin). `.env` files are git-ignored. Only
  `.env.example` files with placeholders are committed.
- **Authentication:** `Authorization: Bearer` keys are compared as SHA-256
  digests with a constant-time comparison. Several keys can be active for
  rotation.
- **Input validation:**
  - strict Zod schemas: unknown fields are rejected, UUIDs are checked, lengths
    are bounded, control characters are refused
  - parameterized SQL only
  - LIKE wildcards are escaped
  - 16 KB body limit
- **Errors:** clients get a stable envelope. 5xx responses never include
  internal details. The plugin relays only the API's documented error message,
  sanitized and truncated, never raw bodies.
- **Logging:** request logs contain the method, the path without its query
  string, the status and a random request id. Authorization headers are
  redacted. Tests check that API keys and search terms never reach the logs.
- **Transport:**
  - the plugin requires `https://` except for localhost
  - the plugin never follows redirects, so the key cannot leak to another host
  - `helmet` security headers are set
  - CORS is off unless `CORS_ORIGINS` is set
  - requests are rate-limited per IP
- **Agent safety:**
  - tool results are marked as external network content
  - the Skill forbids inventing data and requires confirmation before writes
  - the write tool is opt-in and needs approval on every call

## Examples

Ask the agent:

- "Busca el cliente juan@example.com"
- "¿Qué suscripciones activas hay?"
- "¿Cuánto consumió Acme en septiembre de 2026?"
- "Crea el cliente Acme Corp con email admin@acme.com". The agent confirms the
  values, then OpenClaw asks for approval.

## License

[MIT](LICENSE)
