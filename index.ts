import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

type Config = {
  apiUrl: string;
  apiKey: string;
};

async function request(
  config: Config,
  path: string,
  options: RequestInit = {}
) {
  const url = `${config.apiUrl.replace(/\/$/, "")}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const error = await response.text();

    throw new Error(
      `SaaS API error ${response.status}: ${error}`
    );
  }

  return response.json();
}

export default definePluginEntry({
  id: "saas-manager",
  name: "SaaS Manager",
  description:
    "Manage SaaS customers, subscriptions and usage from OpenClaw.",

  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      apiUrl: {
        type: "string"
      },
      apiKey: {
        type: "string"
      }
    },
    required: [
      "apiUrl",
      "apiKey"
    ]
  },

  register(api) {

    /*
     * LIST CUSTOMERS
     */

    api.registerTool({
      name: "saas_list_customers",

      description:
        "List customers from the SaaS platform.",

      parameters: Type.Object({
        search: Type.Optional(
          Type.String({
            description:
              "Optional customer name or email search"
          })
        ),

        limit: Type.Optional(
          Type.Number({
            description:
              "Maximum number of customers to return"
          })
        )
      }),

      async execute(_id, params) {

        const search = params.search
          ? `?search=${encodeURIComponent(params.search)}`
          : "";

        const data = await request(
          api.config as Config,
          `/customers${search}`
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2)
            }
          ],
          details: data
        };
      }
    });


    /*
     * GET CUSTOMER
     */

    api.registerTool({
      name: "saas_get_customer",

      description:
        "Get detailed information about a SaaS customer.",

      parameters: Type.Object({
        customerId: Type.String({
          description:
            "Unique customer ID"
        })
      }),

      async execute(_id, params) {

        const data = await request(
          api.config as Config,
          `/customers/${encodeURIComponent(params.customerId)}`
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2)
            }
          ],
          details: data
        };
      }
    });


    /*
     * CREATE CUSTOMER
     */

    api.registerTool({
      name: "saas_create_customer",

      description:
        "Create a new customer in the SaaS platform.",

      parameters: Type.Object({
        name: Type.String({
          description:
            "Customer or company name"
        }),

        email: Type.String({
          description:
            "Customer email address"
        })
      }),

      async execute(_id, params) {

        const data = await request(
          api.config as Config,
          "/customers",
          {
            method: "POST",

            body: JSON.stringify({
              name: params.name,
              email: params.email
            })
          }
        );

        return {
          content: [
            {
              type: "text",
              text: `Customer created successfully:\n${JSON.stringify(
                data,
                null,
                2
              )}`
            }
          ],
          details: data
        };
      }
    });


    /*
     * LIST SUBSCRIPTIONS
     */

    api.registerTool({
      name: "saas_list_subscriptions",

      description:
        "List SaaS subscriptions.",

      parameters: Type.Object({
        customerId: Type.Optional(
          Type.String({
            description:
              "Optional customer ID"
          })
        ),

        status: Type.Optional(
          Type.String({
            description:
              "Optional subscription status"
          })
        )
      }),

      async execute(_id, params) {

        const query = new URLSearchParams();

        if (params.customerId) {
          query.set(
            "customerId",
            params.customerId
          );
        }

        if (params.status) {
          query.set(
            "status",
            params.status
          );
        }

        const queryString = query.toString();

        const data = await request(
          api.config as Config,
          `/subscriptions${
            queryString
              ? `?${queryString}`
              : ""
          }`
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2)
            }
          ],
          details: data
        };
      }
    });


    /*
     * USAGE
     */

    api.registerTool({
      name: "saas_get_usage",

      description:
        "Get usage metrics for a SaaS customer.",

      parameters: Type.Object({
        customerId: Type.String({
          description:
            "Customer ID"
        }),

        period: Type.Optional(
          Type.String({
            description:
              "Usage period, for example 2026-10"
          })
        )
      }),

      async execute(_id, params) {

        const query = params.period
          ? `?period=${encodeURIComponent(
              params.period
            )}`
          : "";

        const data = await request(
          api.config as Config,
          `/customers/${encodeURIComponent(
            params.customerId
          )}/usage${query}`
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2)
            }
          ],
          details: data
        };
      }
    });

  }
});
