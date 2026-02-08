/**
 * Credential Tools — list, query, rotate managed credentials
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { npsApi, formatToolError } from "../client.js";
import { platformName } from "../types.js";

interface NpsCredential {
  id: string;
  domain: string;
  username: string;
  name: string;
  description?: string;
  type?: number;
  platformId?: string;
  changeOnCheckout?: boolean;
  changeOnRelease?: boolean;
  isDeleted?: boolean;
  createdDateTimeUtc?: string;
  modifiedDateTimeUtc?: string;
  authenticationMethod?: number;
}

function credentialTypeName(type?: number): string {
  switch (type) {
    case 0: return "Password";
    case 1: return "SSH Key";
    case 2: return "Certificate";
    default: return type !== undefined ? `Type ${type}` : "Unknown";
  }
}

function authMethodName(method?: number): string {
  switch (method) {
    case 0: return "Password";
    case 1: return "SSH Key";
    default: return method !== undefined ? `Method ${method}` : "Password";
  }
}

function formatCredential(c: NpsCredential): string {
  const platform = platformName(c.platformId || null);
  const type = credentialTypeName(c.type);
  const flags = [];
  if (c.changeOnCheckout) flags.push("rotate on checkout");
  if (c.changeOnRelease) flags.push("rotate on release");
  if (c.isDeleted) flags.push("DELETED");

  let line = `• ${c.username}@${c.domain} [${type}] [${platform}]`;
  if (flags.length) line += `\n  Rotation: ${flags.join(", ")}`;
  if (c.description) line += `\n  Description: ${c.description}`;
  line += `\n  Auth: ${authMethodName(c.authenticationMethod)}`;
  if (c.modifiedDateTimeUtc) line += `\n  Last modified: ${c.modifiedDateTimeUtc}`;
  line += `\n  ID: ${c.id}`;
  return line;
}

export function registerCredentialTools(server: McpServer): void {
  server.tool(
    "nps_list_credentials",
    "List managed credentials in NPS with their domain, rotation policy, and platform type.",
    {
      search: z
        .string()
        .optional()
        .describe("Optional search string to filter by username or domain"),
    },
    async ({ search }) => {
      try {
        const credentials = await npsApi<NpsCredential[]>("/api/v1/Credential");

        let filtered = credentials;
        if (search) {
          const term = search.toLowerCase();
          filtered = credentials.filter(
            (c) =>
              c.username?.toLowerCase().includes(term) ||
              c.domain?.toLowerCase().includes(term) ||
              c.name?.toLowerCase().includes(term)
          );
        }

        if (filtered.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: search
                  ? `No credentials matching "${search}". There are ${credentials.length} total.`
                  : "No managed credentials found.",
              },
            ],
          };
        }

        const formatted = filtered.map(formatCredential).join("\n\n");
        const header = search
          ? `Found ${filtered.length} credentials matching "${search}" (${credentials.length} total):`
          : `${filtered.length} managed credentials:`;

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

  server.tool(
    "nps_rotate_credential",
    "Trigger an immediate credential rotation for a managed credential. Use nps_list_credentials to find the credential ID.",
    {
      credentialId: z
        .string()
        .describe("The credential ID (GUID) to rotate"),
    },
    async ({ credentialId }) => {
      try {
        await npsApi(`/api/v1/Credential/${credentialId}/Rotate`, {
          method: "POST",
        });

        return {
          content: [
            {
              type: "text",
              text: `Credential rotation triggered for ${credentialId}. Check credential status to confirm completion.`,
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
