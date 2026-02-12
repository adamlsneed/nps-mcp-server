/**
 * System Tools — version, health, diagnostics
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { npsApi, formatToolError } from "../client.js";
import { getTokenState, hasAdminRoleClaim } from "../auth.js";
import { loadConfig } from "../config.js";
import { summarizeJwt } from "../utils.js";

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
          content: [{ type: "text", text: `NPS Server Version: ${version}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );

  /**
   * nps_auth_status — Report current auth strategy, token health, and JWT claims
   */
  server.tool(
    "nps_auth_status",
    "Diagnose authentication status: shows auth strategy, token age/expiry, JWT claims (username, role, MFA), and whether the token has admin privileges. Essential for debugging 403 errors.",
    {},
    async () => {
      try {
        const config = loadConfig();
        const tokenState = getTokenState();
        const lines: string[] = [`Auth Strategy: ${config.authStrategy}`, ""];

        if (!tokenState) {
          if (config.authStrategy === "browser") {
            lines.push("Token: Awaiting browser login");
            lines.push("  Use the nps_login tool to log in via your browser,");
            lines.push("  or nps_set_token to provide a token directly.");
          } else {
            lines.push("Token: Not yet acquired (will authenticate on first API call)");
          }
        } else {
          const ageMin = Math.round((Date.now() - tokenState.acquiredAt) / 60_000);
          lines.push(`Token Age: ${ageMin} minutes`);

          const jwt = summarizeJwt(tokenState.token);

          if (jwt.expiresAt) {
            const remainMs = jwt.expiresAt.getTime() - Date.now();
            if (remainMs > 0) {
              lines.push(`Token Expires In: ${jwt.remainingMinutes} minutes`);
            } else {
              lines.push(`Token: EXPIRED (${Math.abs(jwt.remainingMinutes!)} minutes ago)`);
            }
          } else {
            lines.push("Token Expiry: Unknown (no exp claim in JWT)");
          }

          lines.push("");
          lines.push("JWT Claims:");
          if (jwt.username) lines.push(`  Username: ${jwt.username}`);
          if (jwt.roles) {
            lines.push(`  Role: ${jwt.roles}`);
          } else {
            lines.push("  Role: ⚠ MISSING (no role claim in JWT)");
          }
          lines.push(`  Has Admin Role: ${jwt.hasAdmin ? "Yes" : "⚠ No"}`);

          // Extra claims not covered by summarizeJwt
          const claims = (await import("../auth.js")).parseJwt(tokenState.token);
          if (claims) {
            if (claims["isMFA"] !== undefined) lines.push(`  MFA Authenticated: ${claims["isMFA"]}`);
            if (claims["isLocalUser"] !== undefined) lines.push(`  Local User: ${claims["isLocalUser"]}`);
            if (typeof claims["iat"] === "number") {
              lines.push(`  Issued At: ${new Date(claims["iat"] * 1000).toISOString()}`);
            }
            if (jwt.expiresAt) lines.push(`  Expires At: ${jwt.expiresAt.toISOString()}`);
          }

          // Warn if API key auth without role claims
          if (config.authStrategy === "apikey" && !hasAdminRoleClaim(tokenState.token)) {
            lines.push("");
            lines.push("⚠ API KEY LIMITATION:");
            lines.push("  Token is missing admin role claims (known NPS bug).");
            lines.push("  Most API endpoints will return 403 Forbidden.");
            lines.push("  Switch to interactive auth or use NPS_TOKEN from browser login.");
          }
        }

        // Server version
        try {
          const version = await npsApi<string>("/api/v1/Version");
          lines.push("", `NPS Server Version: ${version}`);
        } catch {
          lines.push("", "NPS Server: Unable to reach (authentication or connectivity issue)");
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );
}
