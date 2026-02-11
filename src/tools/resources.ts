/**
 * Resource Tools — list, query, onboard managed resources
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { npsApi, formatToolError } from "../client.js";
import { platformName, isRdpPlatform } from "../types.js";

// NPS ManagedResource response shape (subset of fields we care about)
interface NpsManagedResource {
  id: string;
  name: string;
  displayName?: string;
  ipAddress?: string;
  platformId: string;
  platform?: { name: string };
  hostId?: string;
  host?: { hostName?: string; ipAddress?: string };
  domainConfigId?: string;
  serviceAccountId?: string;
  dnsHostName?: string;
  hostName?: string;
  portSsh?: number;
  portRdp?: number;
  portWinRm?: number;
  nodeId?: string;
  createdDateTimeUtc?: string;
  modifiedDateTimeUtc?: string;
}

function formatResource(r: NpsManagedResource): string {
  const platform = r.platform?.name || platformName(r.platformId || null);
  const display = r.displayName || r.name;
  const ip = r.ipAddress || r.host?.ipAddress || "";
  const dns = r.dnsHostName || r.hostName || "";
  const ports = [];
  if (r.portRdp) ports.push(`RDP:${r.portRdp}`);
  if (r.portSsh) ports.push(`SSH:${r.portSsh}`);
  if (r.portWinRm) ports.push(`WinRM:${r.portWinRm}`);

  let line = `• ${display} [${platform}]`;
  if (ip) line += ` — ${ip}`;
  if (dns && dns !== ip && dns.toLowerCase() !== display.toLowerCase()) line += ` (${dns})`;
  if (ports.length) line += ` (${ports.join(", ")})`;
  line += `\n  ID: ${r.id}`;
  return line;
}

export function registerResourceTools(server: McpServer): void {
  /**
   * nps_list_resources — List all managed resources
   */
  server.tool(
    "nps_list_resources",
    "List all managed resources in NPS with their platform type, IP address, and connection ports. Use this to find resources before creating sessions.",
    {
      search: z
        .string()
        .optional()
        .describe("Optional search string to filter resources by name"),
    },
    async ({ search }) => {
      try {
        const resources = await npsApi<NpsManagedResource[]>(
          "/api/v1/ManagedResource"
        );

        let filtered = resources;
        if (search) {
          const term = search.toLowerCase();
          filtered = resources.filter(
            (r) =>
              r.name?.toLowerCase().includes(term) ||
              r.displayName?.toLowerCase().includes(term) ||
              r.ipAddress?.toLowerCase().includes(term) ||
              r.dnsHostName?.toLowerCase().includes(term) ||
              r.hostName?.toLowerCase().includes(term)
          );
        }

        if (filtered.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: search
                  ? `No resources found matching "${search}". There are ${resources.length} total resources.`
                  : "No managed resources found.",
              },
            ],
          };
        }

        const formatted = filtered.map(formatResource).join("\n\n");
        const header = search
          ? `Found ${filtered.length} resources matching "${search}" (${resources.length} total):`
          : `${filtered.length} managed resources:`;

        return {
          content: [{ type: "text", text: `${header}\n\n${formatted}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );

  /**
   * nps_resource_access — What activities can be used on a resource?
   */
  server.tool(
    "nps_resource_access",
    "Find what activities are available for a resource. Searches policies that include the resource and returns the bound activities. Use this before nps_create_session to find valid activity names for a resource.",
    {
      resourceName: z
        .string()
        .describe("Resource name, DNS hostname, or partial match (e.g., 'fs1', 'FS1.adamsneed.com')"),
    },
    async ({ resourceName }) => {
      try {
        // Step 1: Resolve resource name to ID
        const resources = await npsApi<NpsManagedResource[]>("/api/v1/ManagedResource");
        const term = resourceName.toLowerCase();
        const resource = resources.find(
          (r) =>
            r.name?.toLowerCase() === term ||
            r.displayName?.toLowerCase() === term ||
            r.dnsHostName?.toLowerCase() === term ||
            r.name?.toLowerCase().includes(term) ||
            r.dnsHostName?.toLowerCase().includes(term)
        );

        if (!resource) {
          return {
            content: [{ type: "text", text: `Resource "${resourceName}" not found. Use nps_list_resources to see available resources.` }],
            isError: true,
          };
        }

        const display = resource.displayName || resource.name;
        const platform = resource.platform?.name || platformName(resource.platformId);
        const connType = isRdpPlatform(resource.platformId) ? "RDP" : "SSH";

        // Step 2: Get all policies
        interface NpsPolicy {
          id: string;
          name: string;
          isDisabled?: boolean;
          policyType?: number;
        }
        const policies = await npsApi<NpsPolicy[]>("/api/v1/AccessControlPolicy");
        const activePolicies = policies.filter((p) => !p.isDisabled && p.policyType === 0);

        // Step 3: For each policy, check if it includes this resource
        interface PolicyResources {
          data?: Array<{ id?: string; name?: string }>;
          recordsTotal?: number;
        }
        interface PolicyActivities {
          data?: Array<{ id?: string; name?: string; description?: string }>;
          recordsTotal?: number;
        }

        const matchingPolicies: Array<{
          policyName: string;
          activities: Array<{ name: string; description?: string }>;
        }> = [];

        // Check policies in parallel (batch of 5)
        for (let i = 0; i < activePolicies.length; i += 5) {
          const batch = activePolicies.slice(i, i + 5);
          const results = await Promise.all(
            batch.map(async (policy) => {
              const res = await npsApi<PolicyResources>(
                `/api/v1/AccessControlPolicy/SearchResources/${policy.id}`
              );
              const hasResource = res.data?.some(
                (r) => r.id === resource.id
              );
              if (!hasResource) return null;

              const acts = await npsApi<PolicyActivities>(
                `/api/v1/AccessControlPolicy/SearchActivities/${policy.id}`
              );
              return {
                policyName: policy.name,
                activities: (acts.data ?? []).map((a) => ({
                  name: a.name ?? "Unknown",
                  description: a.description,
                })),
              };
            })
          );
          for (const r of results) {
            if (r) matchingPolicies.push(r);
          }
        }

        let text = `Access for ${display} [${platform}] (${connType})\n\n`;

        if (matchingPolicies.length === 0) {
          text += "No policies grant access to this resource for the current user.\n";
          text += "Ask an NPS administrator to add it to a policy.";
          return { content: [{ type: "text", text }] };
        }

        // Deduplicate activities across policies
        const allActivities = new Map<string, { name: string; description?: string; policies: string[] }>();
        for (const mp of matchingPolicies) {
          for (const act of mp.activities) {
            const existing = allActivities.get(act.name);
            if (existing) {
              existing.policies.push(mp.policyName);
            } else {
              allActivities.set(act.name, {
                name: act.name,
                description: act.description,
                policies: [mp.policyName],
              });
            }
          }
        }

        text += `${allActivities.size} available activity/activities:\n\n`;
        for (const [, act] of allActivities) {
          text += `• ${act.name}`;
          if (act.description) text += `\n  ${act.description}`;
          text += `\n  Policy: ${act.policies.join(", ")}\n`;
        }

        text += `\nTo create a session:\n`;
        const firstAct = allActivities.values().next().value;
        text += `  nps_create_session(resourceName: "${resource.dnsHostName || display}", activityName: "${firstAct?.name}")`;

        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );
}
