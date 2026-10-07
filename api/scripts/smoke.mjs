// Read-only post-deployment smoke test. It never creates or modifies data.
//
// Usage (values come from the environment so the key never appears in shell
// history or process listings):
//   SMOKE_API_URL="https://<your-api-host>/v1" SMOKE_API_KEY="<key>" npm run smoke
//
// It prints only HTTP statuses and pass/fail lines, never response data or the key.

const baseUrl = process.env.SMOKE_API_URL?.replace(/\/+$/, "");
const apiKey = process.env.SMOKE_API_KEY;

if (!baseUrl || !apiKey) {
  console.error("Set SMOKE_API_URL (including /v1) and SMOKE_API_KEY.");
  process.exit(2);
}

const checks = [
  { name: "health is public and OK", path: "/health", auth: false, expect: 200 },
  { name: "customers require an API key", path: "/customers?limit=1", auth: false, expect: 401 },
  { name: "a wrong API key is rejected", path: "/customers?limit=1", auth: "wrong", expect: 401 },
  { name: "list customers", path: "/customers?limit=1", auth: true, expect: 200 },
  { name: "list subscriptions", path: "/subscriptions?limit=1", auth: true, expect: 200 },
  { name: "unknown customer returns 404", path: "/customers/00000000-0000-4000-8000-00000000ffff", auth: true, expect: 404 },
  { name: "invalid input returns 422", path: "/customers?limit=0", auth: true, expect: 422 },
];

let failed = 0;
for (const check of checks) {
  const headers = { Accept: "application/json" };
  if (check.auth === true) headers.Authorization = `Bearer ${apiKey}`;
  if (check.auth === "wrong") headers.Authorization = "Bearer smoke-test-invalid-key-0000000000000000";

  let status = "network error";
  try {
    const response = await fetch(`${baseUrl}${check.path}`, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    status = response.status;
    await response.body?.cancel();
  } catch {
    // keep "network error"
  }
  const ok = status === check.expect;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${check.name} (expected ${check.expect}, got ${status})`);
}

console.log(failed === 0 ? "All smoke checks passed." : `${failed} smoke check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
