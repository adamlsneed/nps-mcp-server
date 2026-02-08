/**
 * System Tools — version, health, diagnostics
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { npsApi, formatToolError } from "../client.js";

export function registerSystemTools(server: McpServer): void {
  /**
   * nps_version — Get NPS server version and validate connectivity
   */
  server.tool(
    "nps_version",
    "Get the Netwrix Privilege Secure server version. Use this to verify connectivity and check what version is running.",
    {},
    async () => {
      try {
        const version = await npsApi<string>("/api/v1/Version");
        return {
          content: [
            {
              type: "text",
              text: `NPS Server Version: ${version}`,
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
