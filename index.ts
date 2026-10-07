import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { buildCreateCustomerApproval } from "./src/approval.js";
import { createSaasClient } from "./src/client.js";
import { resolveConfig } from "./src/config.js";
import { createSaasTools, type SaasTool } from "./src/tools.js";

export default definePluginEntry({
  id: "saas-manager",
  name: "SaaS Manager",
  description: "Manage SaaS customers, subscriptions and usage from OpenClaw.",

  // The config schema (including the SecretRef-capable apiKey) lives in
  // openclaw.plugin.json so OpenClaw can validate config without loading code.

  register(api) {
    // `api.pluginConfig` is this plugin's own config (plugins.entries.saas-manager.config),
    // with SecretRefs already resolved. Validation happens per call so a missing or
    // invalid setting becomes a clear tool error instead of a failed registration.
    const getClient = () => createSaasClient(resolveConfig(api.pluginConfig));
    const tools = createSaasTools(getClient);

    // Tool parameter types are erased at the registration boundary; OpenClaw
    // validates arguments against each tool's TypeBox schema before execute().
    const register = (tool: SaasTool<any>, options?: { optional?: boolean }) =>
      api.registerTool(tool as unknown as AnyAgentTool, { name: tool.name, ...options });

    register(tools.listCustomers);
    register(tools.getCustomer);
    register(tools.listSubscriptions);
    register(tools.getUsage);
    // Write tool: hidden until the operator opts in via tools.allow, and every
    // call additionally requires explicit approval (see before_tool_call below).
    register(tools.createCustomer, { optional: true });

    api.on("before_tool_call", async (event) => {
      if (event.toolName !== tools.createCustomer.name) return;
      return { requireApproval: buildCreateCustomerApproval(event.params) };
    });
  },
});
