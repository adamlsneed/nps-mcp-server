/**
 * Platform & Activity Tools — list platforms, activities, and connector config
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { npsApi, formatToolError } from "../client.js";

interface NpsPlatform {
  id: string;
  name: string;
  description?: string;
  builtInAccount?: string;
  os?: string;
  type?: number;
  icon?: string;
  permanent?: boolean;
}

interface NpsActivity {
  id: string;
  name: string;
  description?: string;
  activityType?: number;
  isDefault?: boolean;
  isDeleted?: boolean;
  platformId?: string;
  platform?: { name?: string };
}

interface NpsConnectorConfig {
  id?: string;
  name: string;
  value?: string | null;
  defaultValue?: string | null;
  description?: string;
  type?: number;
  required?: boolean;
  advanced?: boolean;
  displayOrder?: number;
}

function activityTypeName(type?: number): string {
  switch (type) {
    case 0: return "Session";
    case 1: return "Credential";
    case 2: return "Service";
    default: return type !== undefined ? `Type ${type}` : "Unknown";
  }
}

export function registerPlatformTools(server: McpServer): void {
  /**
   * nps_list_platforms — List all platform definitions
   */
  server.tool(
    "nps_list_platforms",
    "List all platform definitions in NPS. Shows platform GUIDs, names, OS types, and built-in accounts. Useful for onboarding resources or understanding supported resource types.",
    {},
    async () => {
      try {
        const platforms = await npsApi<NpsPlatform[]>("/api/v1/Platform");

        if (!platforms || platforms.length === 0) {
          return {
            content: [{ type: "text", text: "No platforms found." }],
          };
        }

        let text = `${platforms.length} platform definitions:\n\n`;
        for (const p of platforms) {
          text += `• ${p.name}`;
          if (p.os) text += ` (${p.os})`;
          text += `\n  ID: ${p.id}`;
          if (p.description) text += `\n  Description: ${p.description}`;
          if (p.builtInAccount) text += `\n  Built-in Account: ${p.builtInAccount}`;
          if (p.permanent) text += `\n  [Permanent]`;
          text += `\n`;
        }

        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );

  /**
   * nps_list_activities — List activity definitions
   */
  server.tool(
    "nps_list_activities",
    "List activity definitions in NPS. Activities define what happens before, during, and after a session (e.g., create temp account, add to admins group). Use this to find activity names for creating sessions.",
    {
      platform: z
        .string()
        .optional()
        .describe("Filter by platform name (partial match)"),
    },
    async ({ platform }) => {
      try {
        const activities = await npsApi<NpsActivity[]>("/api/v1/Activity");

        let filtered = activities.filter((a) => !a.isDeleted);

        if (platform) {
          const term = platform.toLowerCase();
          filtered = filtered.filter(
            (a) =>
              a.platform?.name?.toLowerCase().includes(term) ||
              a.platformId?.toLowerCase().includes(term)
          );
        }

        if (filtered.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: platform
                  ? `No activities matching "${platform}". There are ${activities.length} total.`
                  : "No activities found.",
              },
            ],
          };
        }

        let text = `${filtered.length} activities:\n\n`;
        for (const a of filtered) {
          text += `• ${a.name} [${activityTypeName(a.activityType)}]`;
          if (a.platform?.name) text += ` — ${a.platform.name}`;
          if (a.isDefault) text += ` [Default]`;
          if (a.description) text += `\n  ${a.description}`;
          text += `\n  ID: ${a.id}\n`;
        }

        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );

  /**
   * nps_connector_config — List authentication connector configuration
   */
  server.tool(
    "nps_connector_config",
    "List NPS connector configuration entries. Shows authentication connectors and other system configuration key-value pairs (MFA, SAML, OIDC, etc.).",
    {
      search: z
        .string()
        .optional()
        .describe("Filter by key name (partial match)"),
    },
    async ({ search }) => {
      try {
        const configs = await npsApi<NpsConnectorConfig[]>(
          "/api/v1/ConnectorConfiguration"
        );

        let filtered = configs;
        if (search) {
          const term = search.toLowerCase();
          filtered = configs.filter(
            (c) =>
              c.name?.toLowerCase().includes(term) ||
              c.description?.toLowerCase().includes(term)
          );
        }

        if (filtered.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: search
                  ? `No config entries matching "${search}". There are ${configs.length} total.`
                  : "No connector configuration entries found.",
              },
            ],
          };
        }

        let text = `${filtered.length} configuration entries`;
        if (search) text += ` matching "${search}"`;
        text += ` (${configs.length} total):\n\n`;

        for (const c of filtered) {
          text += `• ${c.name}`;
          const val = c.value ?? c.defaultValue;
          if (val) text += ` = ${val}`;
          if (c.required) text += ` [required]`;
          if (c.description) text += `\n  ${c.description}`;
          text += `\n`;
        }

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
