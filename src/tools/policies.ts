/**
 * Policy Tools — list and query access control policies
 *
 * Access policies bind users + resources + activities together.
 * A user must be in a policy to create a session.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { npsApi, formatToolError } from "../client.js";

interface NpsAccessPolicy {
  id: string;
  name: string;
  description?: string;
  policyType?: number;
  isDisabled?: boolean;
  isDefault?: boolean;
  priority?: number;
  activityConfigurationId?: string;
  activityConfiguration?: { name?: string };
  // These contain the join records for users, resources, activities
  managedAccountPolicyJoin?: unknown[];
  managedResourcePolicyJoin?: unknown[];
  activityJoin?: unknown[];
  userAndGroupCollectionPolicyJoin?: unknown[];
  credentialPolicyJoin?: unknown[];
}

function formatPolicy(p: NpsAccessPolicy): string {
  const status = p.isDisabled ? "DISABLED" : "Active";
  const profile = p.activityConfiguration?.name || "";

  let text = `• ${p.name} [${status}]`;
  if (p.description) text += `\n  Description: ${p.description}`;
  if (profile) text += `\n  Connection Profile: ${profile}`;
  text += `\n  Type: ${p.policyType === 0 ? "Resource Based" : "Credential Based"}`;
  text += `\n  ID: ${p.id}`;

  // Count bindings if available
  const users = p.userAndGroupCollectionPolicyJoin?.length || 0;
  const resources = p.managedResourcePolicyJoin?.length || 0;
  const activities = p.activityJoin?.length || 0;
  if (users || resources || activities) {
    text += `\n  Bindings: ${users} user/group(s), ${resources} resource(s), ${activities} activity/ies`;
  }

  return text;
}

export function registerPolicyTools(server: McpServer): void {
  /**
   * nps_list_policies — List all access control policies
   */
  server.tool(
    "nps_list_policies",
    "List all access control policies in NPS. Policies define which users can perform which activities on which resources. Use this to understand what sessions can be created.",
    {
      search: z
        .string()
        .optional()
        .describe("Optional search string to filter policies by name"),
    },
    async ({ search }) => {
      try {
        const policies = await npsApi<NpsAccessPolicy[]>(
          "/api/v1/AccessControlPolicy"
        );

        let filtered = policies;
        if (search) {
          const term = search.toLowerCase();
          filtered = policies.filter(
            (p) =>
              p.name.toLowerCase().includes(term) ||
              p.description?.toLowerCase().includes(term)
          );
        }

        if (filtered.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: search
                  ? `No policies matching "${search}".`
                  : "No access policies configured.",
              },
            ],
          };
        }

        const formatted = filtered.map(formatPolicy).join("\n\n");
        return {
          content: [
            {
              type: "text",
              text: `${filtered.length} access policies:\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );
}
