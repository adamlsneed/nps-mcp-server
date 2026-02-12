/**
 * Reporting Tools — session history, activity summaries, access reports
 *
 * These tools aggregate and summarize NPS data for reporting purposes.
 * No dedicated /Reports endpoint exists in this API version, so we
 * build reports from ActivitySession, ManagedAccount, and other endpoints.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { npsApi, formatToolError } from "../client.js";
import { platformName, formatDuration } from "../types.js";
import type { SessionSearchResults } from "../types.js";
import type { ManagedResource } from "../utils.js";

interface NpsManagedAccountSearch {
  data: Array<{
    id: string;
    name: string;
    displayName?: string;
    samAccountName?: string;
    domainName?: string;
    activeSessionCount?: number;
    scheduledSessionCount?: number;
    accessPolicyCount?: number;
    locked?: boolean;
    lastLogonTimestamp?: string;
    entityType?: number;
  }>;
  recordsTotal: number;
}

interface NpsPolicy {
  id: string;
  name: string;
  description?: string;
  policyType?: number;
  isDisabled?: boolean;
  activityConfiguration?: { name?: string };
  managedAccountPolicyJoin?: unknown[];
  managedResourcePolicyJoin?: unknown[];
  activityJoin?: unknown[];
  userAndGroupCollectionPolicyJoin?: unknown[];
  credentialPolicyJoin?: unknown[];
}

interface CredSearchRecord {
  id?: string;
  userName?: string;
  displayName?: string;
  samAccountName?: string;
  domain?: string;
  platform?: string;
  age?: number;
  passwordStatus?: number;
  rotationType?: number;
  lastPasswordChangeDateTimeUtc?: string;
  nextPasswordChangeDateTimeUtc?: string;
  lastVerifiedDateTimeUtc?: string;
  managedType?: number;
}

interface CredSearchResult {
  data: CredSearchRecord[];
  recordsTotal: number;
}

export function registerReportingTools(server: McpServer): void {
  /**
   * nps_session_report — Summarize session activity over a time period
   */
  server.tool(
    "nps_session_report",
    "Generate a session activity report with server-side analytics. Uses the Search endpoint for duration stats, top user breakdowns, and filtered results. Great for auditing who accessed what, when, and for how long.",
    {
      days: z
        .number()
        .optional()
        .default(7)
        .describe("Number of days to look back (default: 7)"),
      filterText: z
        .string()
        .optional()
        .describe("Filter by username, resource, or activity (server-side search)"),
      topUsers: z
        .enum(["None", "Top5", "Top10", "Everyone"])
        .optional()
        .default("Top10")
        .describe("Top user analytics breakdown (default: Top10)"),
    },
    async ({ days, filterText, topUsers }) => {
      try {
        const now = new Date();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);

        const params: Record<string, string | number | boolean | undefined> = {
          filterDateTimeMin: cutoff.toISOString(),
          filterDateTimeMax: now.toISOString(),
          filterTopUsersType: topUsers,
          orderBy: "createdDateTimeUtc",
          orderDescending: true,
          skip: 0,
          take: 50,
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
            content: [
              {
                type: "text",
                text: `No sessions found in the last ${days} day(s)${filterText ? ` matching "${filterText}"` : ""}.`,
              },
            ],
          };
        }

        let report = `Session Report — Last ${days} day(s)\n`;
        report += `Total sessions matched: ${total}\n`;

        // Duration statistics from server
        if (summary) {
          report += `\nDuration Statistics:\n`;
          report += `  Total: ${formatDuration(summary.sumDuration)}\n`;
          report += `  Average: ${formatDuration(summary.avgDuration)}\n`;
          report += `  Min: ${formatDuration(summary.minDuration)}\n`;
          report += `  Max: ${formatDuration(summary.maxDuration)}\n`;
        }

        // Top users from server analytics
        const topUserList = result.topUsers ?? [];
        if (topUserList.length > 0) {
          report += `\nTop Users:\n`;
          for (const u of topUserList) {
            const name = u.managedAccountName ?? "Unknown";
            const count = u.countSessions ?? 0;
            const dur = formatDuration(u.sumDuration);
            report += `  ${name}: ${count} session(s), ${dur} total\n`;
          }
        }

        // Aggregate by status and resource from the returned page
        const byStatus: Record<string, number> = {};
        const byResource: Record<string, number> = {};
        const byActivity: Record<string, number> = {};

        for (const s of sessions) {
          const statusKey = s.sessionStatusDescription ?? `Status ${s.sessionStatus}`;
          byStatus[statusKey] = (byStatus[statusKey] || 0) + 1;

          const resKey = s.managedResourceName ?? "Unknown";
          byResource[resKey] = (byResource[resKey] || 0) + 1;

          const actKey = s.activityName ?? "Unknown";
          byActivity[actKey] = (byActivity[actKey] || 0) + 1;
        }

        const sortedEntries = (obj: Record<string, number>) =>
          Object.entries(obj)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `  ${k}: ${v}`)
            .join("\n");

        report += `\nBy Status (from ${sessions.length} shown):\n${sortedEntries(byStatus)}`;
        report += `\n\nTop Resources:\n${sortedEntries(byResource)}`;
        report += `\n\nTop Activities:\n${sortedEntries(byActivity)}`;

        // Recent sessions with duration
        report += `\n\nRecent Sessions:\n`;
        for (const s of sessions.slice(0, 15)) {
          const res = s.managedResourceName ?? "Unknown";
          const user = s.createdByDisplayName ?? "?";
          const dur = formatDuration(s.durationInSeconds);
          const status = s.sessionStatusDescription ?? `Status ${s.sessionStatus}`;
          report += `  • ${s.id.substring(0, 8)}... — ${res} — ${user} — ${dur} — ${status}\n`;
        }
        if (total > 15) {
          report += `  ... ${total - 15} more. Use nps_search_sessions for paginated results.\n`;
        }

        return { content: [{ type: "text", text: report }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );

  /**
   * nps_session_dashboard — Quick session count overview
   */
  server.tool(
    "nps_session_dashboard",
    "Quick session activity dashboard. Shows all-time totals, 7-day and 24-hour activity with duration stats, and currently active session count. Uses lightweight Search queries with take=0 for minimal overhead.",
    {},
    async () => {
      try {
        const now = new Date();
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        // Parallel queries: all-time total, last 7 days, last 24 hours
        const [allTime, last7d, last24h] = await Promise.all([
          npsApi<SessionSearchResults>("/api/v1/ActivitySession/Search", {
            params: { take: 0 },
          }),
          npsApi<SessionSearchResults>("/api/v1/ActivitySession/Search", {
            params: {
              filterDateTimeMin: sevenDaysAgo.toISOString(),
              filterDateTimeMax: now.toISOString(),
              take: 0,
            },
          }),
          npsApi<SessionSearchResults>("/api/v1/ActivitySession/Search", {
            params: {
              filterDateTimeMin: oneDayAgo.toISOString(),
              filterDateTimeMax: now.toISOString(),
              take: 0,
            },
          }),
        ]);

        let text = `Session Dashboard\n\n`;
        text += `All-Time: ${allTime.recordsTotal ?? "?"} sessions`;
        if (allTime.summary) {
          text += `, ${formatDuration(allTime.summary.sumDuration)} total duration`;
        }
        text += `\n`;

        text += `Last 7 Days: ${last7d.recordsTotal ?? 0} sessions`;
        if (last7d.summary) {
          text += ` (avg ${formatDuration(last7d.summary.avgDuration)}, total ${formatDuration(last7d.summary.sumDuration)})`;
        }
        text += `\n`;

        text += `Last 24 Hours: ${last24h.recordsTotal ?? 0} sessions`;
        if (last24h.summary) {
          text += ` (avg ${formatDuration(last24h.summary.avgDuration)})`;
        }
        text += `\n`;

        text += `\nUse nps_list_sessions for active session details.`;

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
   * nps_access_report — Who has access to what
   */
  server.tool(
    "nps_access_report",
    "Generate an access report showing which users have access to NPS, their policy counts, active sessions, and lock status. Useful for access reviews and compliance auditing.",
    {
      onlyActive: z
        .boolean()
        .optional()
        .default(false)
        .describe("Only show users with active sessions"),
      onlyLocked: z
        .boolean()
        .optional()
        .default(false)
        .describe("Only show locked accounts"),
    },
    async ({ onlyActive, onlyLocked }) => {
      try {
        const result = await npsApi<NpsManagedAccountSearch>(
          "/api/v1/ManagedAccount/Search"
        );

        let accounts = result.data || [];

        if (onlyActive) {
          accounts = accounts.filter(
            (a) => a.activeSessionCount && a.activeSessionCount > 0
          );
        }
        if (onlyLocked) {
          accounts = accounts.filter((a) => a.locked);
        }

        if (accounts.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No accounts match the specified filters.",
              },
            ],
          };
        }

        // Summary stats
        const totalUsers = accounts.filter((a) => a.entityType === 0).length;
        const totalGroups = accounts.filter((a) => a.entityType === 1).length;
        const lockedCount = accounts.filter((a) => a.locked).length;
        const activeCount = accounts.filter(
          (a) => a.activeSessionCount && a.activeSessionCount > 0
        ).length;

        let report = `Access Report\n`;
        report += `Total accounts: ${accounts.length} (${result.recordsTotal} in system)\n`;
        report += `Users: ${totalUsers} | Groups: ${totalGroups}\n`;
        report += `Locked: ${lockedCount} | With active sessions: ${activeCount}\n`;

        // By domain
        const byDomain: Record<string, number> = {};
        for (const a of accounts) {
          const d = a.domainName || "Local";
          byDomain[d] = (byDomain[d] || 0) + 1;
        }
        report += `\nBy Domain:\n`;
        for (const [domain, count] of Object.entries(byDomain).sort(
          (a, b) => b[1] - a[1]
        )) {
          report += `  ${domain}: ${count}\n`;
        }

        // Users with most policies
        const topPolicies = [...accounts]
          .sort(
            (a, b) => (b.accessPolicyCount || 0) - (a.accessPolicyCount || 0)
          )
          .slice(0, 10);
        report += `\nTop Users by Policy Count:\n`;
        for (const a of topPolicies) {
          const name = a.displayName || a.samAccountName || a.name;
          report += `  ${name}: ${a.accessPolicyCount || 0} policies`;
          if (a.activeSessionCount) report += ` (${a.activeSessionCount} active)`;
          if (a.locked) report += ` [LOCKED]`;
          report += `\n`;
        }

        // Locked accounts
        if (lockedCount > 0 && !onlyLocked) {
          report += `\nLocked Accounts:\n`;
          const locked = accounts.filter((a) => a.locked);
          for (const a of locked) {
            report += `  • ${a.displayName || a.samAccountName || a.name} (${a.domainName || "Local"})\n`;
          }
        }

        return { content: [{ type: "text", text: report }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );

  /**
   * nps_resource_report — Resource inventory and status
   */
  server.tool(
    "nps_resource_report",
    "Generate a resource inventory report. Shows all managed resources grouped by platform type with connection details. Useful for infrastructure auditing.",
    {},
    async () => {
      try {
        const resources = await npsApi<ManagedResource[]>(
          "/api/v1/ManagedResource"
        );

        // Group by platform
        const byPlatform: Record<string, ManagedResource[]> = {};
        for (const r of resources) {
          const platform =
            r.platform?.name || platformName(r.platformId || null);
          if (!byPlatform[platform]) byPlatform[platform] = [];
          byPlatform[platform].push(r);
        }

        let report = `Resource Inventory Report\n`;
        report += `Total managed resources: ${resources.length}\n\n`;

        report += `By Platform:\n`;
        for (const [platform, items] of Object.entries(byPlatform).sort(
          (a, b) => b[1].length - a[1].length
        )) {
          report += `  ${platform}: ${items.length}\n`;
        }

        for (const [platform, items] of Object.entries(byPlatform).sort(
          (a, b) => b[1].length - a[1].length
        )) {
          report += `\n--- ${platform} (${items.length}) ---\n`;
          for (const r of items) {
            const name = r.displayName || r.name;
            const ip = r.ipAddress || r.host?.ipAddress || "";
            report += `  • ${name}`;
            if (ip) report += ` — ${ip}`;
            report += `\n`;
          }
        }

        return { content: [{ type: "text", text: report }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );

  /**
   * nps_policy_report — Policy coverage analysis
   */
  server.tool(
    "nps_policy_report",
    "Generate a policy coverage report. Shows all access control policies with their user, resource, and activity bindings. Helps identify gaps or overly broad policies.",
    {},
    async () => {
      try {
        const policies = await npsApi<NpsPolicy[]>(
          "/api/v1/AccessControlPolicy"
        );

        const active = policies.filter((p) => !p.isDisabled);
        const disabled = policies.filter((p) => p.isDisabled);

        let report = `Policy Coverage Report\n`;
        report += `Total policies: ${policies.length} (${active.length} active, ${disabled.length} disabled)\n\n`;

        // Policies sorted by binding count
        const policySummaries = policies.map((p) => ({
          name: p.name,
          disabled: p.isDisabled,
          type: p.policyType === 0 ? "Resource" : "Credential",
          users: p.userAndGroupCollectionPolicyJoin?.length || 0,
          resources: p.managedResourcePolicyJoin?.length || 0,
          activities: p.activityJoin?.length || 0,
          credentials: p.credentialPolicyJoin?.length || 0,
          profile: p.activityConfiguration?.name || "",
        }));

        report += `Policy Details:\n`;
        for (const p of policySummaries) {
          const status = p.disabled ? " [DISABLED]" : "";
          report += `  • ${p.name}${status} (${p.type})\n`;
          report += `    Users: ${p.users} | Resources: ${p.resources} | Activities: ${p.activities}`;
          if (p.credentials) report += ` | Credentials: ${p.credentials}`;
          if (p.profile) report += ` | Profile: ${p.profile}`;
          report += `\n`;
        }

        // Flag potential issues
        const noUsers = policySummaries.filter(
          (p) => p.users === 0 && !p.disabled
        );
        const noResources = policySummaries.filter(
          (p) => p.resources === 0 && !p.disabled && p.type === "Resource"
        );

        if (noUsers.length > 0 || noResources.length > 0) {
          report += `\nPotential Issues:\n`;
          if (noUsers.length > 0) {
            report += `  Policies with no users bound (${noUsers.length}):\n`;
            for (const p of noUsers) {
              report += `    • ${p.name}\n`;
            }
          }
          if (noResources.length > 0) {
            report += `  Resource policies with no resources bound (${noResources.length}):\n`;
            for (const p of noResources) {
              report += `    • ${p.name}\n`;
            }
          }
        }

        return { content: [{ type: "text", text: report }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );

  /**
   * nps_credential_rotation_report — Rotation compliance executive summary
   */
  server.tool(
    "nps_credential_rotation_report",
    "Credential rotation compliance report. Aggregates rotation health across all credentials: % managed, % auto-rotating, average age, overdue rotations. Groups by domain and platform for executive summary.",
    {
      take: z
        .number()
        .optional()
        .default(500)
        .describe("Max credentials to analyze (default: 500)"),
    },
    async ({ take }) => {
      try {
        const result = await npsApi<CredSearchResult>(
          "/api/v1/Credential/Search",
          { params: { skip: 0, take } }
        );

        const creds = result.data ?? [];
        const total = result.recordsTotal ?? creds.length;

        if (creds.length === 0) {
          return {
            content: [{ type: "text", text: "No credentials found." }],
          };
        }

        // Classify
        let managed = 0;
        let autoRotating = 0;
        let verified = 0;
        let staleOrFailed = 0;
        let totalAge = 0;
        let ageCount = 0;
        const overdue: CredSearchRecord[] = [];
        const byDomain: Record<string, { total: number; managed: number; stale: number }> = {};
        const byPlatform: Record<string, { total: number; managed: number; stale: number }> = {};

        const now = Date.now();

        for (const c of creds) {
          // Managed if managedType > 0 or rotationType > 0
          const isManaged = (c.managedType ?? 0) > 0 || (c.rotationType ?? 0) > 0;
          if (isManaged) managed++;
          if (c.rotationType === 1) autoRotating++;
          if (c.passwordStatus === 1 || c.passwordStatus === 2) verified++;
          if (c.passwordStatus === 3 || c.passwordStatus === 4) staleOrFailed++;

          if (c.age != null && c.age >= 0) {
            totalAge += c.age;
            ageCount++;
          }

          // Check overdue: nextPasswordChange in the past
          if (c.nextPasswordChangeDateTimeUtc) {
            const nextChange = new Date(c.nextPasswordChangeDateTimeUtc).getTime();
            if (nextChange < now) {
              overdue.push(c);
            }
          }

          // Group by domain
          const domain = c.domain || "Local";
          if (!byDomain[domain]) byDomain[domain] = { total: 0, managed: 0, stale: 0 };
          byDomain[domain].total++;
          if (isManaged) byDomain[domain].managed++;
          if (c.passwordStatus === 3 || c.passwordStatus === 4) byDomain[domain].stale++;

          // Group by platform
          const platform = c.platform || "Unknown";
          if (!byPlatform[platform]) byPlatform[platform] = { total: 0, managed: 0, stale: 0 };
          byPlatform[platform].total++;
          if (isManaged) byPlatform[platform].managed++;
          if (c.passwordStatus === 3 || c.passwordStatus === 4) byPlatform[platform].stale++;
        }

        const pct = (n: number, d: number) => d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "N/A";
        const avgAge = ageCount > 0 ? (totalAge / ageCount).toFixed(1) : "N/A";

        let report = `Credential Rotation Compliance Report\n`;
        report += `Analyzed: ${creds.length} of ${total} total credentials\n\n`;

        report += `Summary:\n`;
        report += `  Managed: ${managed} (${pct(managed, creds.length)})\n`;
        report += `  Auto-Rotating: ${autoRotating} (${pct(autoRotating, creds.length)})\n`;
        report += `  Verified/Changed: ${verified} (${pct(verified, creds.length)})\n`;
        report += `  Stale/Failed: ${staleOrFailed} (${pct(staleOrFailed, creds.length)})\n`;
        report += `  Average Age: ${avgAge} days\n`;
        report += `  Overdue Rotations: ${overdue.length}\n`;

        // By Domain
        const sortedDomains = Object.entries(byDomain).sort((a, b) => b[1].total - a[1].total);
        report += `\nBy Domain:\n`;
        for (const [domain, stats] of sortedDomains) {
          report += `  ${domain}: ${stats.total} total, ${stats.managed} managed (${pct(stats.managed, stats.total)})`;
          if (stats.stale > 0) report += `, ${stats.stale} stale`;
          report += `\n`;
        }

        // By Platform
        const sortedPlatforms = Object.entries(byPlatform).sort((a, b) => b[1].total - a[1].total);
        report += `\nBy Platform:\n`;
        for (const [platform, stats] of sortedPlatforms) {
          report += `  ${platform}: ${stats.total} total, ${stats.managed} managed (${pct(stats.managed, stats.total)})`;
          if (stats.stale > 0) report += `, ${stats.stale} stale`;
          report += `\n`;
        }

        // Overdue details
        if (overdue.length > 0) {
          report += `\nOverdue Rotations (${overdue.length}):\n`;
          for (const c of overdue.slice(0, 15)) {
            const name = c.displayName || c.samAccountName || c.userName || "?";
            const domain = c.domain || "";
            const due = c.nextPasswordChangeDateTimeUtc
              ? c.nextPasswordChangeDateTimeUtc.replace("T", " ").substring(0, 19)
              : "?";
            report += `  • ${domain ? `${domain}\\` : ""}${name} — due: ${due}\n`;
          }
          if (overdue.length > 15) {
            report += `  ... and ${overdue.length - 15} more\n`;
          }
        }

        return { content: [{ type: "text", text: report }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );
}
