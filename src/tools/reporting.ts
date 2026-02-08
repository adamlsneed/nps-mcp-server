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
import { platformName, sessionStatusLabel } from "../types.js";

interface NpsSessionSummary {
  id: string;
  status: number;
  statusDescription: string;
  createdByUserName?: string;
  createdDateTimeUtc?: string;
  loginAccountName?: string;
  activityId?: string;
  activity?: { name?: string; activityType?: number };
  managedResourceId?: string;
  managedResource?: {
    name?: string;
    displayName?: string;
    platformId?: string;
    ipAddress?: string;
  };
  accessControlPolicy?: { name?: string };
  scheduledStartDateTimeUtc?: string;
  scheduledEndDateTimeUtc?: string;
  actualStartDateTimeUtc?: string;
  actualEndDateTimeUtc?: string;
  note?: string;
  ticket?: string;
}

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

export function registerReportingTools(server: McpServer): void {
  /**
   * nps_session_report — Summarize session activity over a time period
   */
  server.tool(
    "nps_session_report",
    "Generate a session activity report. Summarizes sessions by status, user, resource, and activity over a given time period. Great for auditing who accessed what and when.",
    {
      days: z
        .number()
        .optional()
        .default(7)
        .describe("Number of days to look back (default: 7)"),
      user: z
        .string()
        .optional()
        .describe("Filter by username (partial match)"),
      resource: z
        .string()
        .optional()
        .describe("Filter by resource name (partial match)"),
    },
    async ({ days, user, resource }) => {
      try {
        const sessions = await npsApi<NpsSessionSummary[]>(
          "/api/v1/ActivitySession"
        );

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);

        let filtered = sessions.filter((s) => {
          const created = s.createdDateTimeUtc
            ? new Date(s.createdDateTimeUtc)
            : null;
          return created && created >= cutoff;
        });

        if (user) {
          const term = user.toLowerCase();
          filtered = filtered.filter(
            (s) =>
              s.createdByUserName?.toLowerCase().includes(term) ||
              s.loginAccountName?.toLowerCase().includes(term)
          );
        }

        if (resource) {
          const term = resource.toLowerCase();
          filtered = filtered.filter(
            (s) =>
              s.managedResource?.name?.toLowerCase().includes(term) ||
              s.managedResource?.displayName?.toLowerCase().includes(term)
          );
        }

        if (filtered.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No sessions found in the last ${days} day(s) matching your filters.`,
              },
            ],
          };
        }

        // Aggregate stats
        const byStatus: Record<string, number> = {};
        const byUser: Record<string, number> = {};
        const byResource: Record<string, number> = {};
        const byActivity: Record<string, number> = {};

        for (const s of filtered) {
          const statusKey = s.statusDescription || `Status ${s.status}`;
          byStatus[statusKey] = (byStatus[statusKey] || 0) + 1;

          const userKey = s.createdByUserName || "Unknown";
          byUser[userKey] = (byUser[userKey] || 0) + 1;

          const resKey =
            s.managedResource?.displayName ||
            s.managedResource?.name ||
            "Unknown";
          byResource[resKey] = (byResource[resKey] || 0) + 1;

          const actKey = s.activity?.name || "Unknown";
          byActivity[actKey] = (byActivity[actKey] || 0) + 1;
        }

        const sortedEntries = (obj: Record<string, number>) =>
          Object.entries(obj)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `  ${k}: ${v}`)
            .join("\n");

        let report = `Session Report — Last ${days} day(s)\n`;
        report += `Total sessions: ${filtered.length}\n`;
        report += `\nBy Status:\n${sortedEntries(byStatus)}`;
        report += `\n\nBy User:\n${sortedEntries(byUser)}`;
        report += `\n\nTop Resources:\n${sortedEntries(byResource)}`;
        report += `\n\nTop Activities:\n${sortedEntries(byActivity)}`;

        // Failed sessions detail
        const failed = filtered.filter((s) => s.status >= 4);
        if (failed.length > 0) {
          report += `\n\nFailed Sessions (${failed.length}):\n`;
          for (const s of failed.slice(0, 10)) {
            const res =
              s.managedResource?.displayName ||
              s.managedResource?.name ||
              "Unknown";
            report += `  • ${s.id.substring(0, 8)}... — ${res} — ${s.statusDescription} (${s.createdByUserName || "?"})\n`;
          }
          if (failed.length > 10) {
            report += `  ... and ${failed.length - 10} more\n`;
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
        interface NpsResource {
          id: string;
          name: string;
          displayName?: string;
          ipAddress?: string;
          platformId?: string;
          platform?: { name?: string };
          portSsh?: number;
          portRdp?: number;
          portWinRm?: number;
          host?: { ipAddress?: string };
        }

        const resources = await npsApi<NpsResource[]>(
          "/api/v1/ManagedResource"
        );

        // Group by platform
        const byPlatform: Record<string, NpsResource[]> = {};
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
}
