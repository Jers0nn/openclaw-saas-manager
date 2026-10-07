# Deploying the SaaS Manager API

This guide deploys **only the API** (`api/`) and its PostgreSQL database. The
OpenClaw plugin is installed on the machine that runs your OpenClaw Gateway and
just needs the deployed URL and an API key.

> Nothing in this repository creates cloud resources by itself. Every step
> below is something you run or click yourself.

## Environments

| | Development | Test | Production |
| --- | --- | --- | --- |
| Database | Local, e.g. `saas_manager_dev` (`api/docker-compose.yml`) | Disposable, name **must end in `_test`** | Managed PostgreSQL (e.g. Render) |
| Config | `api/.env` (git-ignored) | `TEST_DATABASE_URL` | Platform environment variables |
| Schema | `npm run migrate:up` | Applied automatically by the test setup | Applied automatically at every start (`start:prod`) |
| Data | `npm run seed:dev`: fictitious `[DEMO]` records, `*.demo.test` emails | Fictitious `[TEST]` fixtures, reset before each test | Real data only. The seed refuses `NODE_ENV=production` and non-local hosts. |
| `NODE_ENV` | `development` | `test` (set by Vitest) | `production` |

## Recommended for beginners: Render

[Render](https://render.com) can create the web service and the PostgreSQL
database from the [`render.yaml`](render.yaml) Blueprint in this repository.

### What the Blueprint creates

| Resource | Name | Plan in `render.yaml` |
| --- | --- | --- |
| Web service (Node) | `saas-manager-api`, root directory `api/` | `free` |
| PostgreSQL 16 | `saas-manager-db` (no public access: `ipAllowList: []`) | `free` |

**Know the free-plan limits before you rely on them** (they come from Render's
documentation and can change, so check Render's pricing page):

- Free web services sleep after about 15 minutes without traffic. The first
  request afterwards is slow, and the plugin may hit its 10 s timeout. Raise
  `timeoutMs` in the plugin config or use a paid plan.
- Free PostgreSQL databases **expire after 30 days**. Do not store real
  customer data on the free plan.
- Render's `preDeployCommand` needs a paid plan. That is why migrations run in
  the start command, which works on every plan.

To use paid plans, change `plan:` for the service and the database before you
apply the Blueprint, or upgrade later in the dashboard. Paid plans cost money:
review Render's current pricing first.

### Settings used

| Setting | Value |
| --- | --- |
| Root directory | `api` |
| Build command | `npm ci --include=dev && npm run build && npm prune --omit=dev` |
| Start command | `npm run start:prod` (runs `migrate:up`, then `node dist/server.js`) |
| Health check path | `/v1/health` |
| Node.js version | 24, from `api/.node-version` |

### Steps

1. **Generate an API key on your own computer.** Do not paste it anywhere
   except the Render prompt and your OpenClaw secret:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. In the Render dashboard: **New → Blueprint**, connect this GitHub repository
   and choose the branch to deploy.
3. Render shows the resources from `render.yaml` and asks for `API_KEYS`
   (`sync: false`). Paste the key there. It is stored only in Render.
4. Apply the Blueprint. Render builds the service. On start, the service
   creates the tables (`Migrations complete!` in the logs) and listens on the
   port Render provides.
5. Copy the service URL from the dashboard. The plugin's `apiUrl` is that URL
   followed by `/v1`.
6. Verify with the read-only smoke test (it never writes data):

   ```bash
   cd api
   SMOKE_API_URL="https://<your-service-url>/v1" SMOKE_API_KEY="<your key>" npm run smoke
   ```

7. Configure the plugin (see README → *Configure it*) with that `apiUrl` and
   the key as a SecretRef.

**Do not run `npm run seed:dev` against production.** The production database
starts empty.

### Database connection notes

- `DATABASE_URL` is injected from the Render database (`fromDatabase`,
  `connectionString`). Inside Render it uses the private network.
- If your provider requires TLS, set `DATABASE_SSL=verify` (TLS with
  certificate verification) or `DATABASE_SSL=true` (TLS without verification),
  and add `?sslmode=require` to `DATABASE_URL` so the migration step uses TLS
  too.

## Alternative: any container platform (Railway, Fly.io, a VPS…)

`api/Dockerfile` builds a production image:

- Node 24
- runs as the non-root `node` user
- contains only `dist/`, production dependencies and `migrations/`, so no
  tests, seeds or `.env` files
- on start, applies migrations and then runs the server as PID 1 for clean
  SIGTERM shutdown

```bash
cd api
docker build -t saas-manager-api .
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgres://<user>:<password>@<host>:5432/<db>" \
  -e API_KEYS="<generated key>" \
  saas-manager-api
```

Configure the platform's health check as `GET /v1/health`. It returns 200 when
the database is reachable and 503 otherwise.

## Production environment variables

| Variable | Required | Production value |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` |
| `DATABASE_URL` | yes | From your managed PostgreSQL (13+) |
| `API_KEYS` | yes | One or more random keys, at least 32 characters, comma-separated. Placeholders from `.env.example` are rejected at startup. |
| `PORT` | no | Usually injected by the platform |
| `HOST` | no | `0.0.0.0` (default) |
| `TRUST_PROXY` | behind a proxy | `true` on Render and other platforms that terminate TLS for you |
| `DATABASE_SSL` | depends | `false` (default), `true` or `verify` |
| `CORS_ORIGINS` | no | Leave empty unless a browser app calls the API directly |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` | no | `120` / `1 minute` |
| `LOG_LEVEL` | no | `info` |

If configuration is invalid, the server refuses to start. The error names the
variable but never prints its value.

## Operations

- **Rotate the API key:**
  1. Set `API_KEYS="<new>,<old>"`.
  2. Update the OpenClaw secret to the new key.
  3. Remove the old key from `API_KEYS`.
- **New migrations:** add a file with
  `npm run migrate -- create <name> --migration-file-language sql` in `api/`.
  It is applied automatically on the next deploy. Never edit a migration that
  production has already run.
- **Backups:** use your database provider's backups. Check what your plan
  includes. Free databases are not meant for durable data.
- **Logs:** JSON lines with method, path (no query string), status and a
  random request id. Authorization headers are redacted.
