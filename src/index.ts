#!/usr/bin/env node

/**
 * NPS MCP Server
 *
 * Model Context Protocol server for Netwrix Privilege Secure 4.2.
 * Provides tools to manage activity sessions, resources, credentials,
 * and policies through Claude and other MCP-capable clients.
 *
 * Usage (dev):
 *   NPS_URL="https://nps-server:6500" \
 *   NPS_USERNAME="admin" \
 *   NPS_PASSWORD="password" \
 *   npx tsx src/index.ts
 *
 * Usage (production — compiled):
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node dist/index.js
 *   (reads .env file from project root for credentials)
 *
 * For Claude Desktop, add to claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "nps": {
 *         "command": "node",
 *         "args": ["/path/to/nps-mcp-server/dist/index.js"],
 *         "env": {
 *           "NPS_URL": "https://nps-server:6500",
 *           "NPS_USERNAME": "admin",
 *           "NPS_PASSWORD": "password",
 *           "NPS_MFA_CODE": "000000",
 *           "NODE_TLS_REJECT_UNAUTHORIZED": "0"
 *         }
 *       }
 *     }
 *   }
 *
 * For Claude Code, add to ~/.claude/claude_code_config.json or project .mcp.json:
 *   {
 *     "mcpServers": {
 *       "nps": {
 *         "command": "node",
 *         "args": ["/path/to/nps-mcp-server/dist/index.js"],
 *         "env": {
 *           "NPS_URL": "https://nps-server:6500",
 *           "NPS_USERNAME": "admin",
 *           "NPS_PASSWORD": "password",
 *           "NPS_MFA_CODE": "000000",
 *           "NODE_TLS_REJECT_UNAUTHORIZED": "0"
 *         }
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Tool registrations
import { registerAuthTools } from "./tools/auth-tools.js";
import { registerSystemTools } from "./tools/system.js";
import { registerResourceTools } from "./tools/resources.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerPolicyTools } from "./tools/policies.js";
import { registerUserTools } from "./tools/users.js";
import { registerCredentialTools } from "./tools/credentials.js";
import { registerReportingTools } from "./tools/reporting.js";
import { registerPlatformTools } from "./tools/platforms.js";
import { registerAdminTools } from "./tools/admin.js";
import { registerAuditTools } from "./tools/audit.js";

async function main() {
  const server = new McpServer({
    name: "nps-mcp-server",
    version: "0.1.0",
    description:
      "MCP server for Netwrix Privilege Secure 4.2 — manage privileged access sessions, resources, credentials, and policies",
  });

  // Register all tool groups
  registerAuthTools(server);
  registerSystemTools(server);
  registerResourceTools(server);
  registerSessionTools(server);
  registerPolicyTools(server);
  registerUserTools(server);
  registerCredentialTools(server);
  registerReportingTools(server);
  registerPlatformTools(server);
  registerAdminTools(server);
  registerAuditTools(server);

  // Connect via stdio transport (for Claude Code / Claude Desktop)
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error("NPS MCP Server started (stdio transport)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
