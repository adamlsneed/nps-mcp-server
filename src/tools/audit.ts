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
import type { SessionSearchResults, SessionSummaryRecord } from "../types.js";

function formatSessionRow(s: SessionSummaryRecord): string {
  const res = s.managedResourceName ?? "Unknown";
  const user = s.createdByUserName ?? "?";
  const activity = s.activityName ?? "?";
  const dur = formatDuration(s.durationInSeconds);
  const status = s.statusDescription ?? s.status ?? "";
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
          text += `  Total: ${formatDuration(summary.sumDurationInSeconds)}\n`;
          text += `  Average: ${formatDuration(summary.avgDurationInSeconds)}\n`;
          text += `  Min: ${formatDuration(summary.minDurationInSeconds)} | Max: ${formatDuration(summary.maxDurationInSeconds)}\n`;
        }

        const topUserList = result.topUsers ?? [];
        if (topUserList.length > 0) {
          text += `\nTop Users:\n`;
          for (const u of topUserList) {
            text += `  ${u.userName ?? "?"}: ${u.sessionCount ?? 0} sessions, ${formatDuration(u.totalDurationInSeconds)} total\n`;
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
    "Get session history for a specific managed resource. Shows who accessed it, when, for how long, and what activity was used.",
    {
      resourceId: z.string().describe("The managed resource ID (GUID)"),
      startDate: z.string().optional().describe("Start date filter (ISO 8601)"),
      endDate: z.string().optional().describe("End date filter (ISO 8601)"),
      filterText: z.string().optional().describe("Search text to filter results"),
      skip: z.number().optional().default(0).describe("Skip N results"),
      take: z.number().optional().default(25).describe("Number of results (default: 25)"),
    },
    async ({ resourceId, startDate, endDate, filterText, skip, take }) => {
      try {
        const params: Record<string, string | number | boolean | undefined> = {
          skip,
          take,
        };
        if (startDate) params.startDate = startDate;
        if (endDate) params.endDate = endDate;
        if (filterText) params.filterText = filterText;

        const result = await npsApi<SessionSearchResults>(
          `/api/v1/ActivitySession/SummaryForResource/${resourceId}`,
          { params }
        );

        const sessions = result.data ?? [];
        const total = result.recordsTotal ?? sessions.length;

        if (total === 0) {
          return {
            content: [{ type: "text", text: `No sessions found for resource ${resourceId}.` }],
          };
        }

        let text = `Resource Session History — ${total} sessions\n`;
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
        interface CredentialSearchResult {
          data: Array<{
            id?: string;
            name?: string;
            displayName?: string;
            samAccountName?: string;
            domainName?: string;
            resourceName?: string;
            platformName?: string;
            age?: number;
            passwordStatus?: string;
            rotationType?: string;
            lastPasswordChangeDateTimeUtc?: string;
            nextPasswordChangeDateTimeUtc?: string;
            lastVerifiedDateTimeUtc?: string;
            dependencyCount?: number;
            privilege?: string;
            credentialType?: string;
            managedType?: string;
          }>;
          recordsTotal: number;
        }

        const params: Record<string, string | number | boolean | undefined> = {
          skip,
          take,
          managedType,
          credentialType,
        };
        if (filterText) params.filterText = filterText;
        if (onlyManaged) params.managedFilter = "Managed";

        const result = await npsApi<CredentialSearchResult>(
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

        // Classify health
        const stale: typeof creds = [];
        const healthy: typeof creds = [];
        const unverified: typeof creds = [];

        for (const c of creds) {
          const status = (c.passwordStatus ?? "").toLowerCase();
          if (status.includes("stale") || status.includes("expired") || status.includes("fail")) {
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
            const name = c.displayName || c.samAccountName || c.name || "?";
            const resource = c.resourceName ?? "";
            const lastChange = c.lastPasswordChangeDateTimeUtc
              ? c.lastPasswordChangeDateTimeUtc.replace("T", " ").substring(0, 19)
              : "never";
            text += `  • ${name} (${resource}) — Status: ${c.passwordStatus} — Last changed: ${lastChange}\n`;
          }
        }

        if (unverified.length > 0) {
          text += `\nUnverified Credentials:\n`;
          for (const c of unverified.slice(0, 10)) {
            const name = c.displayName || c.samAccountName || c.name || "?";
            const resource = c.resourceName ?? "";
            text += `  • ${name} (${resource}) — Never verified\n`;
          }
          if (unverified.length > 10) {
            text += `  ... and ${unverified.length - 10} more\n`;
          }
        }

        text += `\nAll Credentials:\n`;
        for (const c of creds) {
          const name = c.displayName || c.samAccountName || c.name || "?";
          const resource = c.resourceName ?? "";
          const age = c.age != null ? `${c.age}d old` : "?";
          const status = c.passwordStatus ?? "?";
          const rotation = c.rotationType ?? "";
          const lastChange = c.lastPasswordChangeDateTimeUtc
            ? c.lastPasswordChangeDateTimeUtc.replace("T", " ").substring(0, 19)
            : "never";
          text += `  ${name} | ${resource} | ${age} | ${status} | ${rotation} | Changed: ${lastChange}\n`;
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
        interface PolicyUsers {
          data?: Array<{
            id?: string;
            name?: string;
            displayName?: string;
            samAccountName?: string;
            domainName?: string;
            entityType?: number;
          }>;
          recordsTotal?: number;
        }
        interface PolicyResources {
          data?: Array<{
            id?: string;
            name?: string;
            displayName?: string;
            ipAddress?: string;
            platformId?: string;
            platformName?: string;
          }>;
          recordsTotal?: number;
        }
        interface PolicyActivities {
          data?: Array<{
            id?: string;
            name?: string;
            description?: string;
            activityType?: number;
          }>;
          recordsTotal?: number;
        }

        // Fetch all three in parallel
        const [users, resources, activities] = await Promise.all([
          npsApi<PolicyUsers>(
            `/api/v1/AccessControlPolicy/SearchManagedAccounts/${policyId}`
          ),
          npsApi<PolicyResources>(
            `/api/v1/AccessControlPolicy/SearchResources/${policyId}`
          ),
          npsApi<PolicyActivities>(
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
            const domain = u.domainName ? `${u.domainName}\\` : "";
            const type = u.entityType === 1 ? " [Group]" : "";
            text += `  • ${domain}${name}${type}\n`;
          }
        }

        text += `\nResources (${resources.recordsTotal ?? resourceList.length}):\n`;
        if (resourceList.length === 0) {
          text += `  (none)\n`;
        } else {
          for (const r of resourceList) {
            const name = r.displayName || r.name || "?";
            const ip = r.ipAddress ? ` — ${r.ipAddress}` : "";
            const platform = r.platformName ?? "";
            text += `  • ${name}${ip} [${platform}]\n`;
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
    "View the NPS action execution queue. Shows actions executed by the system (provisioning, credential rotation, cleanup, etc.) with status and timing. Useful for auditing what NPS actually did.",
    {
      sessionId: z.string().optional().describe("Filter by activity session ID"),
      filterText: z.string().optional().describe("Search text to filter actions"),
      skip: z.number().optional().default(0).describe("Skip N results"),
      take: z.number().optional().default(25).describe("Number of results (default: 25)"),
      orderDescending: z
        .boolean()
        .optional()
        .default(true)
        .describe("Sort newest first (default: true)"),
    },
    async ({ sessionId, filterText, skip, take, orderDescending }) => {
      try {
        interface ActionQueueItem {
          id?: string;
          status?: number;
          statusDescription?: string;
          actionType?: string;
          actionTypeDescription?: string;
          startTimeUtc?: string;
          endTimeUtc?: string;
          activitySessionId?: string;
          managedResourceName?: string;
          managedAccountName?: string;
          errorMessage?: string;
          queuePosition?: number;
        }
        interface ActionQueueResult {
          data?: ActionQueueItem[];
          recordsTotal?: number;
        }

        const params: Record<string, string | number | boolean | undefined> = {
          skip,
          take,
          orderDescending,
        };
        if (sessionId) params.activitySessionId = sessionId;
        if (filterText) params.filterText = filterText;

        // Try search-style response first, fall back to array
        const raw = await npsApi<ActionQueueResult | ActionQueueItem[]>(
          "/api/v1/ActionQueue",
          { params }
        );

        let items: ActionQueueItem[];
        let total: number;

        if (Array.isArray(raw)) {
          items = raw.slice(skip, skip + take);
          total = raw.length;
        } else {
          items = raw.data ?? [];
          total = raw.recordsTotal ?? items.length;
        }

        if (items.length === 0) {
          return {
            content: [{ type: "text", text: "No action queue items found." }],
          };
        }

        let text = `Action Queue — ${total} total items\n`;
        text += `Showing ${skip + 1}–${skip + items.length} of ${total}\n\n`;

        for (const a of items) {
          const id = a.id ? a.id.substring(0, 8) + "..." : "?";
          const status = a.statusDescription ?? `Status ${a.status}`;
          const type = a.actionTypeDescription ?? a.actionType ?? "?";
          const resource = a.managedResourceName ?? "";
          const account = a.managedAccountName ?? "";
          const start = a.startTimeUtc
            ? a.startTimeUtc.replace("T", " ").substring(0, 19)
            : "";
          const end = a.endTimeUtc
            ? a.endTimeUtc.replace("T", " ").substring(0, 19)
            : "";
          const session = a.activitySessionId
            ? `Session: ${a.activitySessionId.substring(0, 8)}...`
            : "";

          text += `  ${id} | ${start} → ${end} | ${type} | ${resource} ${account} | ${status}`;
          if (session) text += ` | ${session}`;
          if (a.errorMessage) text += ` | ERROR: ${a.errorMessage}`;
          text += "\n";
        }

        if (skip + items.length < total) {
          text += `\n... ${total - skip - items.length} more. Use skip=${skip + take} to continue.`;
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
