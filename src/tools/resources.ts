/**
 * Resource Tools — list, query, onboard managed resources
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { npsApi, formatToolError } from "../client.js";
import { platformName } from "../types.js";

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
  const ports = [];
  if (r.portRdp) ports.push(`RDP:${r.portRdp}`);
  if (r.portSsh) ports.push(`SSH:${r.portSsh}`);
  if (r.portWinRm) ports.push(`WinRM:${r.portWinRm}`);

  let line = `• ${display} [${platform}]`;
  if (ip) line += ` — ${ip}`;
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
        // TODO: Confirm the exact endpoint path from API docs
        // Common patterns: /api/v1/ManagedResource or /api/v1/ManagedResource/Search
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
}
