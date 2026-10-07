/**
 * Approval request for write tools, returned from OpenClaw's documented
 * `before_tool_call` hook (`requireApproval`). OpenClaw pauses the call until a
 * user approves or denies it; timeouts, missing approval routes and unknown
 * decisions fail closed (the call is blocked).
 */
export type ApprovalRequest = {
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  allowedDecisions: Array<"allow-once" | "deny">;
  timeoutMs: number;
};

const APPROVAL_TIMEOUT_MS = 120_000;

/** Removes control characters and bounds length so values display safely in approval UIs. */
function display(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : "(missing)";
  const cleaned = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

export function buildCreateCustomerApproval(params: Record<string, unknown>): ApprovalRequest {
  return {
    title: "Create SaaS customer",
    // The Gateway caps descriptions at 512 characters; stay well below it.
    description:
      `Create a new customer record in the SaaS Manager API.\n` +
      `Name: ${display(params.name, 120)}\n` +
      `Email: ${display(params.email, 120)}\n` +
      `This writes data to the SaaS database.`,
    severity: "warning",
    // "allow-always" is not offered: every customer creation is approved individually.
    allowedDecisions: ["allow-once", "deny"],
    timeoutMs: APPROVAL_TIMEOUT_MS,
  };
}
