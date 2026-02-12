/**
 * Admin Tools — onboard resources, create policies
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { npsApi, formatToolError } from "../client.js";
import { platformName, PLATFORMS } from "../types.js";
import type { ManagedResource } from "../utils.js";

interface NpsAccessControlPolicy {
  id: string;
  name: string;
  description?: string;
  policyType?: number;
  isDisabled?: boolean;
}

export function registerAdminTools(server: McpServer): void {
  /**
   * nps_onboard_resource — Add a managed resource to NPS
   */
  server.tool(
    "nps_onboard_resource",
    "Onboard a new managed resource into NPS. Registers a server, endpoint, or service that NPS will manage privileged access to. Use nps_list_platforms to find valid platform IDs.",
    {
      name: z
        .string()
        .describe("Display name for the resource (e.g., 'prod-web-01')"),
      hostAddress: z
        .string()
        .describe("IP address or FQDN of the resource"),
      platformId: z
        .string()
        .optional()
        .describe(
          "Platform GUID (use nps_list_platforms to find). Defaults to Windows."
        ),
      dnsHostName: z
        .string()
        .optional()
        .describe("DNS hostname if different from hostAddress"),
      portSsh: z
        .number()
        .optional()
        .describe("SSH port (default: 22 for Linux platforms)"),
      portRdp: z
        .number()
        .optional()
        .describe("RDP port (default: 3389 for Windows platforms)"),
    },
    async ({ name, hostAddress, platformId, dnsHostName, portSsh, portRdp }) => {
      try {
        const body: Record<string, unknown> = {
          name,
          displayName: name,
          ipAddress: hostAddress,
          platformId: platformId || PLATFORMS.WINDOWS,
        };

        if (dnsHostName) body.dnsHostName = dnsHostName;
        if (portSsh !== undefined) body.portSsh = portSsh;
        if (portRdp !== undefined) body.portRdp = portRdp;

        // Host object required by the API
        body.host = {
          ipAddress: hostAddress,
          dnsHostName: dnsHostName || hostAddress,
        };

        const resource = await npsApi<ManagedResource>(
          "/api/v1/ManagedResource",
          { method: "POST", body }
        );

        const platform = platformName(resource.platformId || null);
        let text = `Resource onboarded successfully!\n\n`;
        text += `  Name: ${resource.displayName || resource.name}\n`;
        text += `  ID: ${resource.id}\n`;
        text += `  Platform: ${platform}\n`;
        text += `  Address: ${resource.ipAddress || resource.host?.ipAddress || hostAddress}\n`;
        text += `\nNext steps:\n`;
        text += `  1. Add credentials for this resource (service accounts)\n`;
        text += `  2. Add it to an access control policy\n`;
        text += `  3. Users in that policy can then create sessions to this resource\n`;

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
   * nps_create_policy — Create an access control policy
   */
  server.tool(
    "nps_create_policy",
    "Create a new access control policy in NPS. Policies bind users to resources and activities, defining who can access what. The policy name must be unique.",
    {
      name: z
        .string()
        .describe("Unique name for the policy (e.g., 'Dev Team - Linux Servers')"),
      description: z
        .string()
        .optional()
        .describe("Description of the policy's purpose"),
      policyType: z
        .enum(["resource", "credential"])
        .optional()
        .default("resource")
        .describe("Policy type: 'resource' for session access, 'credential' for credential checkout"),
    },
    async ({ name, description, policyType }) => {
      try {
        const body: Record<string, unknown> = {
          name,
          policyType: policyType === "credential" ? 1 : 0,
        };

        if (description) body.description = description;

        const policy = await npsApi<NpsAccessControlPolicy>(
          "/api/v1/AccessControlPolicy",
          { method: "POST", body }
        );

        const typeLabel = policy.policyType === 1 ? "Credential" : "Resource";
        let text = `Policy created successfully!\n\n`;
        text += `  Name: ${policy.name}\n`;
        text += `  ID: ${policy.id}\n`;
        text += `  Type: ${typeLabel}\n`;
        if (policy.description) text += `  Description: ${policy.description}\n`;
        text += `\nNext steps:\n`;
        text += `  1. Add users or groups to this policy\n`;
        text += `  2. Add managed resources to this policy\n`;
        text += `  3. Add activities to define what actions are available\n`;
        text += `  4. Optionally assign a connection profile for session parameters\n`;

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
