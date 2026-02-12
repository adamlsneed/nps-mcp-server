/**
 * Audit Tools — session search, credential health, policy detail, action queue
 *
 * Rich drill-down and analytics tools that leverage server-side search,
 * pagination, and summary endpoints the basic tools don't use.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { npsApi, formatToolError } from "../client.js";
import { formatDuration } from "../types.js";
import { resolveResource } from "../utils.js";
import type { SessionSearchResults, SessionSummaryRecord } from "../types.js";

interface CredentialHealthRecord {
  id?: string;
  userName?: string;
  displayName?: string;
  samAccountName?: string;
  domain?: string;
  resource?: string;
  platform?: string;
  platformId?: string;
  managedResourceId?: string;
  age?: number;
  passwordStatus?: number;
  rotationType?: number;
  lastPasswordChangeDateTimeUtc?: string;
  nextPasswordChangeDateTimeUtc?: string;
  lastVerifiedDateTimeUtc?: string;
  dependencyCount?: number;
  privilege?: number;
  privilegeName?: string;
  credentialType?: number;
  managedType?: number;
  status?: string;
}

interface CredentialHealthResult {
  data: CredentialHealthRecord[];
  recordsTotal: number;
}

interface PolicySearchResult {
  data?: Array<{
    id?: string;
    name?: string;
    displayName?: string;
    samAccountName?: string;
    email?: string;
    domain?: string;
    dnsHostName?: string;
    platformId?: string;
    os?: string;
    activeSessionCount?: number;
    description?: string;
    entityType?: number;
  }>;
  recordsTotal?: number;
}

interface ActionQueueItem {
  id?: string;
  status?: number;
  statusDescription?: string;
  actionQueueActionStatus?: number;
  startTime?: string;
  [key: string]: unknown;
}

function formatSessionRow(s: SessionSummaryRecord): string {
  const res = s.managedResourceName ?? "Unknown";
  const user = s.createdByDisplayName ?? "?";
  const activity = s.activityName ?? "?";
  const dur = formatDuration(s.durationInSeconds);
  const status = s.sessionStatusDescription ?? `Status ${s.sessionStatus}`;
  const date = s.createdDateTimeUtc
    ? s.createdDateTimeUtc.replace("T", " ").substring(0, 19)
    : "";
  return `  ${s.id.substring(0, 8)}... | ${date} | ${res} | ${user} | ${activity} | ${dur} | ${status}`;
}

export function registerAuditTools(server: McpServer): void {
  /**
   * nps_search_sessions — Rich session search with analytics
   */
  server.tool(
    "nps_search_sessions",
    "Search sessions with server-side filtering, pagination, duration analytics, and top-user breakdowns. More powerful than nps_session_report for drill-down queries.",
    {
      filterText: z
        .string()
        .optional()
        .describe("Search text (matches user, resource, activity, etc.)"),
      startDate: z
        .string()
        .optional()
        .describe("Start date (ISO 8601, e.g., '2025-01-01'). Default: 7 days ago"),
      endDate: z
        .string()
        .optional()
        .describe("End date (ISO 8601). Default: now"),
      topUsers: z
        .enum(["None", "Top5", "Top10", "Everyone"])
        .optional()
        .default("None")
        .describe("Top user analytics breakdown"),
      orderBy: z
        .string()
        .optional()
        .default("createdDateTimeUtc")
        .describe("Sort field (e.g., 'createdDateTimeUtc', 'durationInSeconds')"),
      orderDescending: z
        .boolean()
        .optional()
        .default(true)
        .describe("Sort descending (default: true)"),
      skip: z.number().optional().default(0).describe("Skip N results for pagination"),
      take: z.number().optional().default(25).describe("Number of results to return (default: 25)"),
    },
    async ({ filterText, startDate, endDate, topUsers, orderBy, orderDescending, skip, take }) => {
      try {
        const now = new Date();
        const defaultStart = new Date();
        defaultStart.setDate(defaultStart.getDate() - 7);

        const params: Record<string, string | number | boolean | undefined> = {
          filterDateTimeMin: startDate ?? defaultStart.toISOString(),
          filterDateTimeMax: endDate ?? now.toISOString(),
          filterTopUsersType: topUsers,
          orderBy,
          orderDescending,
          skip,
          take,
        };
        if (filterText) params.filterText = filterText;

        const result = await npsApi<SessionSearchResults>(
          "/api/v1/ActivitySession/Search",
          { params }
        );

        const sessions = result.data ?? [];
        const total = result.recordsTotal ?? sessions.length;
        const summary = result.summary;

        if (total === 0) {
          return {
            content: [{ type: "text", text: "No sessions found matching your search criteria." }],
          };
        }

        let text = `Session Search Results — ${total} total\n`;
        text += `Showing ${skip + 1}–${skip + sessions.length} of ${total}\n`;

        if (summary) {
          text += `\nDuration Statistics:\n`;
          text += `  Count: ${summary.countSessions ?? total}\n`;
          text += `  Total: ${formatDuration(summary.sumDuration)}\n`;
          text += `  Average: ${formatDuration(summary.avgDuration)}\n`;
          text += `  Min: ${formatDuration(summary.minDuration)} | Max: ${formatDuration(summary.maxDuration)}\n`;
        }

        const topUserList = result.topUsers ?? [];
        if (topUserList.length > 0) {
          text += `\nTop Users:\n`;
          for (const u of topUserList) {
            text += `  ${u.managedAccountName ?? "?"}: ${u.countSessions ?? 0} sessions, ${formatDuration(u.sumDuration)} total\n`;
          }
        }

        text += `\nSessions:\n`;
        text += `  ID       | Date                | Resource | User | Activity | Duration | Status\n`;
        for (const s of sessions) {
          text += formatSessionRow(s) + "\n";
        }

        if (skip + sessions.length < total) {
          text += `\n... ${total - skip - sessions.length} more. Use skip=${skip + take} to see next page.`;
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
   * nps_resource_sessions — Session history for a specific resource
   */
  server.tool(
    "nps_resource_sessions",
    "Get session history for a specific managed resource. Shows who accessed it, when, for how long, and what activity was used. Accepts either a resource ID (GUID) or name (DNS hostname).",
    {
      resourceId: z.string().optional().describe("The managed resource ID (GUID)"),
      resourceName: z.string().optional().describe("Resource name or DNS hostname (e.g., 'FS1.adamsneed.com'). Resolves to ID automatically."),
      startDate: z.string().optional().describe("Start date filter (ISO 8601)"),
      endDate: z.string().optional().describe("End date filter (ISO 8601)"),
      filterText: z.string().optional().describe("Search text to filter results"),
      skip: z.number().optional().default(0).describe("Skip N results"),
      take: z.number().optional().default(25).describe("Number of results (default: 25)"),
    },
    async ({ resourceId, resourceName, startDate, endDate, filterText, skip, take }) => {
      try {
        // Resolve resource name to ID if needed
        let resolvedId = resourceId;
        let resolvedName = resourceName;
        if (!resolvedId && resourceName) {
          const match = await resolveResource(resourceName);
          if (!match) {
            return {
              content: [{ type: "text", text: `Resource "${resourceName}" not found. Use nps_list_resources to find available resources.` }],
              isError: true,
            };
          }
          resolvedId = match.id;
          resolvedName = match.displayName || match.name;
        }
        if (!resolvedId) {
          return {
            content: [{ type: "text", text: "Provide either resourceId or resourceName." }],
            isError: true,
          };
        }

        const params: Record<string, string | number | boolean | undefined> = {
          skip,
          take,
        };
        if (startDate) params.startDate = startDate;
        if (endDate) params.endDate = endDate;
        if (filterText) params.filterText = filterText;

        const result = await npsApi<SessionSearchResults>(
          `/api/v1/ActivitySession/SummaryForResource/${resolvedId}`,
          { params }
        );

        const sessions = result.data ?? [];
        const total = result.recordsTotal ?? sessions.length;

        if (total === 0) {
          return {
            content: [{ type: "text", text: `No sessions found for resource ${resolvedName || resolvedId}.` }],
          };
        }

        let text = `Resource Session History for ${resolvedName || resolvedId} — ${total} sessions\n`;
        text += `Showing ${skip + 1}–${skip + sessions.length} of ${total}\n\n`;

        for (const s of sessions) {
          text += formatSessionRow(s) + "\n";
        }

        if (skip + sessions.length < total) {
          text += `\n... ${total - skip - sessions.length} more. Use skip=${skip + take} to continue.`;
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
   * nps_user_sessions — Session history for a specific user
   */
  server.tool(
    "nps_user_sessions",
    "Get session history for a specific user. Shows all sessions they created with resources, durations, and statuses.",
    {
      userId: z.string().optional().describe("User ID (GUID) to filter by"),
      userName: z.string().optional().describe("Username to filter by"),
      startDate: z.string().optional().describe("Start date filter (ISO 8601)"),
      endDate: z.string().optional().describe("End date filter (ISO 8601)"),
      skip: z.number().optional().default(0).describe("Skip N results"),
      take: z.number().optional().default(25).describe("Number of results (default: 25)"),
    },
    async ({ userId, userName, startDate, endDate, skip, take }) => {
      try {
        const params: Record<string, string | number | boolean | undefined> = {
          skip,
          take,
        };
        if (userId) params.userId = userId;
        if (userName) params.userName = userName;
        if (startDate) params.startDate = startDate;
        if (endDate) params.endDate = endDate;

        const result = await npsApi<SessionSearchResults>(
          "/api/v1/ActivitySession/SummaryByStatus/Historical",
          { params }
        );

        const sessions = result.data ?? [];
        const total = result.recordsTotal ?? sessions.length;

        if (total === 0) {
          const who = userName ?? userId ?? "the specified user";
          return {
            content: [{ type: "text", text: `No sessions found for ${who}.` }],
          };
        }

        const who = userName ?? userId ?? "user";
        let text = `Session History for ${who} — ${total} sessions\n`;
        text += `Showing ${skip + 1}–${skip + sessions.length} of ${total}\n\n`;

        for (const s of sessions) {
          text += formatSessionRow(s) + "\n";
        }

        if (skip + sessions.length < total) {
          text += `\n... ${total - skip - sessions.length} more. Use skip=${skip + take} to continue.`;
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
   * nps_historical_sessions — Full historical query with rich filtering
   */
  server.tool(
    "nps_historical_sessions",
    "Query historical sessions with rich filtering: date ranges, resource/user array filters, user type (User/Application/Local), text search, and pagination. More powerful than nps_session_report for compliance reporting.",
    {
      startDate: z
        .string()
        .optional()
        .describe("Start date (ISO 8601, e.g., '2025-01-01'). Default: 30 days ago"),
      endDate: z
        .string()
        .optional()
        .describe("End date (ISO 8601). Default: now"),
      resourceNames: z
        .array(z.string())
        .optional()
        .describe("Filter by resource names (exact match array)"),
      userNames: z
        .array(z.string())
        .optional()
        .describe("Filter by user names (exact match array)"),
      filterUserType: z
        .enum(["User", "Application", "Local"])
        .optional()
        .describe("Filter by user type"),
      filterText: z
        .string()
        .optional()
        .describe("Free-text search across all fields"),
      skip: z.number().optional().default(0).describe("Skip N results for pagination"),
      take: z.number().optional().default(25).describe("Number of results (default: 25)"),
    },
    async ({ startDate, endDate, resourceNames, userNames, filterUserType, filterText, skip, take }) => {
      try {
        const now = new Date();
        const defaultStart = new Date();
        defaultStart.setDate(defaultStart.getDate() - 30);

        const params: Record<string, string | number | boolean | undefined> = {
          startDate: startDate ?? defaultStart.toISOString(),
          endDate: endDate ?? now.toISOString(),
          skip,
          take,
        };
        if (filterText) params.filterText = filterText;
        if (filterUserType) params.filterUserType = filterUserType;

        // Resource and user name arrays: pass first value via params
        // (NPS API accepts single resourceName/userName query params)
        if (resourceNames && resourceNames.length > 0) {
          params.resourceName = resourceNames[0];
        }
        if (userNames && userNames.length > 0) {
          params.userName = userNames[0];
        }

        const result = await npsApi<SessionSearchResults>(
          "/api/v1/ActivitySession/SummaryByStatus/Historical",
          { params }
        );

        const sessions = result.data ?? [];
        const total = result.recordsTotal ?? sessions.length;

        if (total === 0) {
          return {
            content: [{ type: "text", text: "No historical sessions found matching your filters." }],
          };
        }

        let text = `Historical Sessions — ${total} total\n`;
        text += `Showing ${skip + 1}–${skip + sessions.length} of ${total}\n`;
        text += `Period: ${params.startDate} → ${params.endDate}\n`;
        if (filterUserType) text += `User type: ${filterUserType}\n`;
        if (filterText) text += `Search: "${filterText}"\n`;

        // Summary stats if available
        const summary = result.summary;
        if (summary) {
          text += `\nDuration Statistics:\n`;
          text += `  Total: ${formatDuration(summary.sumDuration)}\n`;
          text += `  Average: ${formatDuration(summary.avgDuration)}\n`;
          text += `  Min: ${formatDuration(summary.minDuration)} | Max: ${formatDuration(summary.maxDuration)}\n`;
        }

        text += `\nSessions:\n`;
        text += `  ID       | Date                | Resource | User | Activity | Duration | Status\n`;
        for (const s of sessions) {
          text += formatSessionRow(s) + "\n";
        }

        if (skip + sessions.length < total) {
          text += `\n... ${total - skip - sessions.length} more. Use skip=${skip + take} to see next page.`;
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
   * nps_credential_health — Credential rotation and compliance status
   */
  server.tool(
    "nps_credential_health",
    "Check credential rotation health and compliance. Shows password age, rotation status, last verified dates, and flags stale or unverified credentials. Uses the Credential/Search endpoint with server-side filtering.",
    {
      filterText: z.string().optional().describe("Search text to filter credentials"),
      managedType: z
        .enum(["All", "Internal", "Standard", "Service"])
        .optional()
        .default("All")
        .describe("Type of managed credentials to show"),
      credentialType: z
        .enum(["Any", "Configuration", "User", "Service"])
        .optional()
        .default("Any")
        .describe("Credential type filter"),
      onlyManaged: z
        .boolean()
        .optional()
        .default(false)
        .describe("Only show managed credentials"),
      skip: z.number().optional().default(0).describe("Skip N results"),
      take: z.number().optional().default(50).describe("Number of results (default: 50)"),
    },
    async ({ filterText, managedType, credentialType, onlyManaged, skip, take }) => {
      try {
        const params: Record<string, string | number | boolean | undefined> = {
          skip,
          take,
          managedType,
          credentialType,
        };
        if (filterText) params.filterText = filterText;
        if (onlyManaged) params.managedFilter = "Managed";

        const result = await npsApi<CredentialHealthResult>(
          "/api/v1/Credential/Search",
          { params }
        );

        const creds = result.data ?? [];
        const total = result.recordsTotal ?? creds.length;

        if (total === 0) {
          return {
            content: [{ type: "text", text: "No credentials found matching your filters." }],
          };
        }

        // passwordStatus is a number — map to labels
        const passwordStatusLabel = (s: number | undefined): string => {
          switch (s) {
            case 0: return "Unspecified";
            case 1: return "Verified";
            case 2: return "Changed";
            case 3: return "Failed";
            case 4: return "Stale";
            default: return `Status ${s ?? "?"}`;
          }
        };

        const rotationTypeLabel = (r: number | undefined): string => {
          switch (r) {
            case 0: return "None";
            case 1: return "Automatic";
            case 2: return "Manual";
            default: return `Type ${r ?? "?"}`;
          }
        };

        // Classify health
        const stale: typeof creds = [];
        const healthy: typeof creds = [];
        const unverified: typeof creds = [];

        for (const c of creds) {
          const ps = c.passwordStatus ?? 0;
          if (ps === 3 || ps === 4) {
            stale.push(c);
          } else if (!c.lastVerifiedDateTimeUtc) {
            unverified.push(c);
          } else {
            healthy.push(c);
          }
        }

        let text = `Credential Health Report — ${total} total credentials\n`;
        text += `Showing ${skip + 1}–${skip + creds.length} of ${total}\n`;
        text += `Healthy: ${healthy.length} | Stale/Failed: ${stale.length} | Unverified: ${unverified.length}\n`;

        if (stale.length > 0) {
          text += `\nStale/Failed Credentials:\n`;
          for (const c of stale) {
            const name = c.displayName || c.samAccountName || c.userName || "?";
            const location = c.domain || c.platform || "";
            const lastChange = c.lastPasswordChangeDateTimeUtc
              ? c.lastPasswordChangeDateTimeUtc.replace("T", " ").substring(0, 19)
              : "never";
            text += `  • ${name} (${location}) — ${passwordStatusLabel(c.passwordStatus)} — Last changed: ${lastChange}\n`;
          }
        }

        if (unverified.length > 0) {
          text += `\nUnverified Credentials:\n`;
          for (const c of unverified.slice(0, 10)) {
            const name = c.displayName || c.samAccountName || c.userName || "?";
            const location = c.domain || c.platform || "";
            text += `  • ${name} (${location}) — Never verified\n`;
          }
          if (unverified.length > 10) {
            text += `  ... and ${unverified.length - 10} more\n`;
          }
        }

        text += `\nAll Credentials:\n`;
        for (const c of creds) {
          const name = c.displayName || c.samAccountName || c.userName || "?";
          const location = c.domain || c.platform || "";
          const age = c.age != null ? `${c.age}d old` : "?";
          const status = passwordStatusLabel(c.passwordStatus);
          const rotation = rotationTypeLabel(c.rotationType);
          const privilege = c.privilegeName ?? "";
          const lastChange = c.lastPasswordChangeDateTimeUtc
            ? c.lastPasswordChangeDateTimeUtc.replace("T", " ").substring(0, 19)
            : "never";
          text += `  ${name} | ${location} | ${age} | ${status} | ${rotation} | ${privilege} | Changed: ${lastChange}\n`;
        }

        if (skip + creds.length < total) {
          text += `\n... ${total - skip - creds.length} more. Use skip=${skip + take} to continue.`;
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
   * nps_policy_detail — Full policy drill-down with actual bindings
   */
  server.tool(
    "nps_policy_detail",
    "Get full details of an access control policy including the actual users, resources, and activities bound to it. The policy list endpoint only shows counts — this reveals who and what is actually covered.",
    {
      policyId: z.string().describe("The access control policy ID (GUID)"),
    },
    async ({ policyId }) => {
      try {
        // Fetch all three in parallel
        const [users, resources, activities] = await Promise.all([
          npsApi<PolicySearchResult>(
            `/api/v1/AccessControlPolicy/SearchManagedAccounts/${policyId}`
          ),
          npsApi<PolicySearchResult>(
            `/api/v1/AccessControlPolicy/SearchResources/${policyId}`
          ),
          npsApi<PolicySearchResult>(
            `/api/v1/AccessControlPolicy/SearchActivities/${policyId}`
          ),
        ]);

        const userList = users.data ?? [];
        const resourceList = resources.data ?? [];
        const activityList = activities.data ?? [];

        let text = `Policy Detail — ${policyId}\n\n`;

        text += `Users/Groups (${users.recordsTotal ?? userList.length}):\n`;
        if (userList.length === 0) {
          text += `  (none)\n`;
        } else {
          for (const u of userList) {
            const name = u.displayName || u.samAccountName || u.name || "?";
            const domain = u.domain ? `${u.domain}\\` : "";
            const type = u.entityType === 1 ? " [Group]" : "";
            text += `  • ${domain}${name}${type}\n`;
          }
        }

        text += `\nResources (${resources.recordsTotal ?? resourceList.length}):\n`;
        if (resourceList.length === 0) {
          text += `  (none)\n`;
        } else {
          for (const r of resourceList) {
            const name = r.name || "?";
            const host = r.dnsHostName ? ` — ${r.dnsHostName}` : "";
            const os = r.os ?? "";
            text += `  • ${name}${host}${os ? ` [${os}]` : ""}\n`;
          }
        }

        text += `\nActivities (${activities.recordsTotal ?? activityList.length}):\n`;
        if (activityList.length === 0) {
          text += `  (none)\n`;
        } else {
          for (const a of activityList) {
            const desc = a.description ? ` — ${a.description}` : "";
            text += `  • ${a.name ?? "?"}${desc}\n`;
          }
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
   * nps_action_queue — Action execution history
   */
  server.tool(
    "nps_action_queue",
    "View the NPS action execution queue. Shows recent system actions (provisioning, credential rotation, cleanup, etc.). NOTE: This downloads a large dataset (77K+ items). For session-specific logs, prefer nps_session_logs which is much faster.",
    {
      recentOnly: z
        .boolean()
        .optional()
        .default(true)
        .describe("Only show the most recent 100 items (default: true). Set false for full queue."),
      skip: z.number().optional().default(0).describe("Skip N results"),
      take: z.number().optional().default(25).describe("Number of results (default: 25)"),
    },
    async ({ recentOnly, skip, take }) => {
      try {
        // ActionQueue returns a flat array (77K+ items, ~1.5s).
        // The API does NOT support server-side filtering or pagination.
        const raw = await npsApi<ActionQueueItem[]>("/api/v1/ActionQueue");

        const allItems = Array.isArray(raw) ? raw : [];
        const total = allItems.length;

        // Limit to recent items by default to avoid overwhelming output
        const pool = recentOnly ? allItems.slice(0, 100) : allItems;
        const items = pool.slice(skip, skip + take);

        if (items.length === 0) {
          return {
            content: [{ type: "text", text: "No action queue items found." }],
          };
        }

        // Status codes for action queue
        const aqStatusLabel = (s: number | undefined): string => {
          switch (s) {
            case 0: return "Pending";
            case 1: return "Running";
            case 2: return "Completed";
            case 3: return "Failed";
            case 4: return "Cancelled";
            default: return `Status ${s ?? "?"}`;
          }
        };

        let text = `Action Queue — ${total} total items`;
        if (recentOnly) text += ` (showing recent only)`;
        text += `\nShowing ${skip + 1}–${skip + items.length} of ${pool.length}`;
        if (recentOnly && total > 100) text += ` (${total} total, limited to 100 most recent)`;
        text += `\n\n`;

        for (const a of items) {
          const id = a.id ? a.id.substring(0, 8) + "..." : "?";
          const status = a.statusDescription ?? aqStatusLabel(a.status);
          const start = a.startTime
            ? a.startTime.replace("T", " ").substring(0, 19)
            : "";

          text += `  ${id} | ${start} | ${status}`;
          text += "\n";
        }

        if (skip + items.length < pool.length) {
          text += `\n... ${pool.length - skip - items.length} more. Use skip=${skip + take} to continue.`;
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
   * nps_service_account_details — Service account health check
   */
  server.tool(
    "nps_service_account_details",
    "Get service account details for a credential. Shows password status, rotation status, rollback status, and resource association. Use nps_list_credentials to find credential IDs.",
    {
      credentialId: z.string().describe("The credential ID (GUID) to get service account details for"),
    },
    async ({ credentialId }) => {
      try {
        interface ServiceAccountDetail {
          id?: string;
          name?: string;
          displayName?: string;
          samAccountName?: string;
          domainName?: string;
          resourceName?: string;
          platformName?: string;
          passwordStatus?: string;
          rotationStatus?: string;
          rollbackStatus?: string;
          lastPasswordChangeDateTimeUtc?: string;
          nextPasswordChangeDateTimeUtc?: string;
          lastVerifiedDateTimeUtc?: string;
          dependencyCount?: number;
        }

        const sa = await npsApi<ServiceAccountDetail>(
          `/api/v1/Credential/Details/${credentialId}/ServiceAccount`
        );

        const name = sa.displayName || sa.samAccountName || sa.name || "Unknown";
        const domain = sa.domainName ?? "";
        const resource = sa.resourceName ?? "";
        const platform = sa.platformName ?? "";

        let text = `Service Account Details\n\n`;
        text += `  Name: ${domain ? `${domain}\\` : ""}${name}\n`;
        text += `  Resource: ${resource} [${platform}]\n`;
        text += `  Password Status: ${sa.passwordStatus ?? "Unknown"}\n`;
        text += `  Rotation Status: ${sa.rotationStatus ?? "Unknown"}\n`;
        text += `  Rollback Status: ${sa.rollbackStatus ?? "N/A"}\n`;

        const lastChange = sa.lastPasswordChangeDateTimeUtc
          ? sa.lastPasswordChangeDateTimeUtc.replace("T", " ").substring(0, 19)
          : "never";
        const nextChange = sa.nextPasswordChangeDateTimeUtc
          ? sa.nextPasswordChangeDateTimeUtc.replace("T", " ").substring(0, 19)
          : "not scheduled";
        const lastVerified = sa.lastVerifiedDateTimeUtc
          ? sa.lastVerifiedDateTimeUtc.replace("T", " ").substring(0, 19)
          : "never";

        text += `  Last Password Change: ${lastChange}\n`;
        text += `  Next Password Change: ${nextChange}\n`;
        text += `  Last Verified: ${lastVerified}\n`;

        if (sa.dependencyCount != null) {
          text += `  Dependencies: ${sa.dependencyCount}\n`;
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
