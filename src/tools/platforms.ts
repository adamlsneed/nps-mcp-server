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

interface NpsRegisteredService {
  id: string;
  type?: number;
  name?: string;
  status?: number;
  statusDescription?: string;
  description?: string;
  version?: string;
  serviceNodeId?: string;
  nodeId?: string;
  added?: string;
  createdDateTimeUtc?: string;
  modifiedDateTimeUtc?: string;
  serviceRegistration?: {
    id?: string;
    type?: number;
    dnsHostName?: string;
    serviceName?: string;
    nodeId?: string;
  };
  actionServiceProperty?: Array<{
    name?: string;
    value?: string;
  }>;
}

interface NpsMfaConnector {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  isDefault?: boolean;
  isExclusive?: boolean;
  connectorType?: string;
  radiusOptionsId?: string;
  openIdOptionsId?: string;
  samlOptionsId?: string;
  useRemoteAccessGateway?: boolean;
  nodeId?: string;
  createdDateTimeUtc?: string;
  modifiedDateTimeUtc?: string;
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

function serviceTypeName(type?: number): string {
  switch (type) {
    case 0: return "ActionService";
    case 1: return "ProxyService";
    case 2: return "AgentService";
    case 3: return "EmailService";
    case 4: return "ServiceNode";
    case 5: return "SchedulerService";
    case 6: return "SiemService";
    case 7: return "ActiveDirectoryService";
    case 8: return "WebService";
    case 9: return "RagService";
    case 10: return "NginxService";
    default: return type !== undefined ? `Type ${type}` : "Unknown";
  }
}

function serviceStatusName(status?: number): string {
  switch (status) {
    case 0: return "Offline";
    case 1: return "Running";
    default: return status !== undefined ? `Status ${status}` : "Unknown";
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

  /**
   * nps_authentication_connectors — List MFA/SAML/OIDC connectors
   */
  server.tool(
    "nps_authentication_connectors",
    "List authentication connectors configured in NPS (MFA, SAML, OpenID Connect, etc.). Shows connector type, enabled/default/exclusive flags, and linked configuration IDs. Answers 'what auth methods are available?'",
    {
      search: z
        .string()
        .optional()
        .describe("Filter by connector name or type (partial match)"),
    },
    async ({ search }) => {
      try {
        const connectors = await npsApi<NpsMfaConnector[]>(
          "/api/v1/MfaConnector"
        );

        let filtered = connectors;
        if (search) {
          const term = search.toLowerCase();
          filtered = connectors.filter(
            (c) =>
              c.name?.toLowerCase().includes(term) ||
              c.connectorType?.toLowerCase().includes(term) ||
              c.description?.toLowerCase().includes(term)
          );
        }

        if (filtered.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: search
                  ? `No connectors matching "${search}". There are ${connectors.length} total.`
                  : "No authentication connectors found.",
              },
            ],
          };
        }

        let text = `${filtered.length} authentication connector(s)`;
        if (search) text += ` matching "${search}"`;
        text += ` (${connectors.length} total):\n\n`;

        for (const c of filtered) {
          text += `• ${c.name} [${c.connectorType ?? "Unknown"}]`;
          const flags: string[] = [];
          if (c.enabled) flags.push("Enabled");
          if (c.isDefault) flags.push("Default");
          if (c.isExclusive) flags.push("Exclusive");
          if (flags.length > 0) text += ` — ${flags.join(", ")}`;
          text += `\n  ID: ${c.id}`;
          if (c.description) text += `\n  ${c.description}`;
          if (c.radiusOptionsId) text += `\n  RADIUS Config: ${c.radiusOptionsId}`;
          if (c.openIdOptionsId) text += `\n  OpenID Config: ${c.openIdOptionsId}`;
          if (c.samlOptionsId) text += `\n  SAML Config: ${c.samlOptionsId}`;
          if (c.useRemoteAccessGateway) text += `\n  Uses Remote Access Gateway`;
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
   * nps_service_nodes — List registered services (service nodes, proxies, etc.)
   */
  server.tool(
    "nps_service_nodes",
    "List NPS service nodes and registered services. Shows the health and status of all NPS infrastructure components — action services, proxy services, scheduler, AD connectors, web service, SIEM, etc. Answers 'are all NPS services running?' and 'what version are the service nodes?'",
    {
      type: z
        .string()
        .optional()
        .describe("Filter by service type name (e.g., 'proxy', 'action', 'scheduler', 'ServiceNode')"),
    },
    async ({ type }) => {
      try {
        // Try the most likely endpoint first, fall back to alternatives
        let services: NpsRegisteredService[];
        try {
          services = await npsApi<NpsRegisteredService[]>("/api/v1/RegisteredService");
        } catch (err: unknown) {
          const is404 = err instanceof Error && err.message.includes("404");
          if (is404) {
            // Try alternate endpoint
            services = await npsApi<NpsRegisteredService[]>("/api/v1/ServiceNode");
          } else {
            throw err;
          }
        }

        if (!services || services.length === 0) {
          return {
            content: [{ type: "text", text: "No registered services found." }],
          };
        }

        let filtered = services;
        if (type) {
          const term = type.toLowerCase();
          filtered = services.filter(
            (s) =>
              serviceTypeName(s.type).toLowerCase().includes(term) ||
              s.name?.toLowerCase().includes(term)
          );
        }

        if (filtered.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No services matching "${type}". There are ${services.length} registered services total.`,
              },
            ],
          };
        }

        // Group by status for summary
        const running = filtered.filter((s) => s.status === 1).length;
        const offline = filtered.filter((s) => s.status === 0).length;
        const other = filtered.length - running - offline;

        let text = `${filtered.length} registered service(s)`;
        if (type) text += ` matching "${type}"`;
        text += ` (${services.length} total)`;
        text += ` — ${running} running, ${offline} offline`;
        if (other > 0) text += `, ${other} other`;
        text += `\n\n`;

        for (const s of filtered) {
          const statusLabel = serviceStatusName(s.status);
          const statusIcon = s.status === 1 ? "[Running]" : s.status === 0 ? "[Offline]" : `[${statusLabel}]`;
          const typeName = serviceTypeName(s.type);
          const displayName = s.name || s.serviceRegistration?.serviceName || typeName;

          text += `${statusIcon} ${displayName} (${typeName})\n`;

          const host = s.serviceRegistration?.dnsHostName;
          if (host) text += `  Host: ${host}\n`;
          if (s.version) text += `  Version: ${s.version}\n`;
          if (s.description) text += `  Description: ${s.description}\n`;
          text += `  ID: ${s.id}\n`;

          if (s.modifiedDateTimeUtc) {
            text += `  Last Updated: ${s.modifiedDateTimeUtc}\n`;
          } else if (s.added) {
            text += `  Added: ${s.added}\n`;
          }

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
