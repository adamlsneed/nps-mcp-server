/**
 * User Tools — list users and managed accounts
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { npsApi, formatToolError } from "../client.js";

interface NpsManagedAccountSearchResult {
  data: NpsManagedAccount[];
  recordsTotal: number;
}

interface NpsManagedAccount {
  id: string;
  name: string;
  displayName?: string;
  samAccountName?: string;
  domainName?: string;
  userPrincipalName?: string;
  email?: string;
  entityType?: number;
  activeSessionCount?: number;
  scheduledSessionCount?: number;
  accessPolicyCount?: number;
  locked?: boolean;
  isReviewer?: boolean;
  isDeleted?: boolean;
  lastLogonTimestamp?: string;
}

function entityTypeName(type?: number): string {
  switch (type) {
    case 0: return "User";
    case 1: return "Group";
    case 2: return "Application";
    default: return type !== undefined ? `Type ${type}` : "Unknown";
  }
}

function formatAccount(a: NpsManagedAccount): string {
  const display = a.displayName || a.samAccountName || a.name;
  const type = entityTypeName(a.entityType);
  const flags = [];
  if (a.locked) flags.push("LOCKED");
  if (a.isReviewer) flags.push("reviewer");
  if (a.isDeleted) flags.push("deleted");
  if (a.activeSessionCount) flags.push(`${a.activeSessionCount} active session(s)`);

  let line = `• ${display} [${type}]`;
  if (a.domainName) line += ` — ${a.domainName}`;
  if (flags.length) line += ` (${flags.join(", ")})`;
  if (a.userPrincipalName) line += `\n  UPN: ${a.userPrincipalName}`;
  if (a.accessPolicyCount) line += `\n  Policies: ${a.accessPolicyCount}`;
  if (a.lastLogonTimestamp) line += `\n  Last logon: ${a.lastLogonTimestamp}`;
  line += `\n  ID: ${a.id}`;
  return line;
}

export function registerUserTools(server: McpServer): void {
  server.tool(
    "nps_list_users",
    "List managed accounts in NPS. Shows users, groups, and service accounts with their domain, session counts, and policy bindings.",
    {
      search: z
        .string()
        .optional()
        .describe("Optional search string to filter by name"),
    },
    async ({ search }) => {
      try {
        const params: Record<string, string> = {};
        if (search) params.filterText = search;

        const result = await npsApi<NpsManagedAccountSearchResult>(
          "/api/v1/ManagedAccount/Search",
          { params }
        );

        const accounts = result.data || [];

        if (accounts.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: search
                  ? `No managed accounts matching "${search}".`
                  : "No managed accounts found.",
              },
            ],
          };
        }

        const formatted = accounts.map(formatAccount).join("\n\n");
        const total = result.recordsTotal || accounts.length;
        const header = search
          ? `Found ${accounts.length} accounts matching "${search}" (${total} total):`
          : `${accounts.length} managed accounts (${total} total):`;

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
