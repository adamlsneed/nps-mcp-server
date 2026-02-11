/**
 * System Tools — version, health, diagnostics
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { npsApi, formatToolError } from "../client.js";
import { getTokenState, parseJwt, hasAdminRoleClaim } from "../auth.js";
import { loadConfig } from "../config.js";

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

        const lines: string[] = [];
        lines.push(`Auth Strategy: ${config.authStrategy}`);
        lines.push("");

        if (!tokenState) {
          lines.push("Token: Not yet acquired (will authenticate on first API call)");
        } else {
          const now = Date.now();
          const ageMs = now - tokenState.acquiredAt;
          const ageMin = Math.round(ageMs / 60_000);
          lines.push(`Token Age: ${ageMin} minutes`);

          if (tokenState.expiresAt) {
            const remainMs = tokenState.expiresAt - now;
            const remainMin = Math.round(remainMs / 60_000);
            if (remainMs > 0) {
              lines.push(`Token Expires In: ${remainMin} minutes`);
            } else {
              lines.push(`Token: EXPIRED (${Math.abs(remainMin)} minutes ago)`);
            }
          } else {
            lines.push("Token Expiry: Unknown (no exp claim in JWT)");
          }

          // Parse JWT claims
          const claims = parseJwt(tokenState.token);
          if (claims) {
            lines.push("");
            lines.push("JWT Claims:");

            // Username claims (NPS uses various claim URIs)
            const nameClaim =
              claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] ||
              claims["unique_name"] ||
              claims["sub"];
            if (nameClaim) lines.push(`  Username: ${nameClaim}`);

            // Role claim
            const roleClaim = claims["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"];
            if (roleClaim) {
              const roles = Array.isArray(roleClaim) ? roleClaim.join(", ") : String(roleClaim);
              lines.push(`  Role: ${roles}`);
            } else {
              lines.push("  Role: ⚠ MISSING (no role claim in JWT)");
            }

            // Admin role check
            const hasAdmin = hasAdminRoleClaim(tokenState.token);
            lines.push(`  Has Admin Role: ${hasAdmin ? "Yes" : "⚠ No"}`);

            // MFA claim
            if (claims["isMFA"] !== undefined) {
              lines.push(`  MFA Authenticated: ${claims["isMFA"]}`);
            }

            // Local user
            if (claims["isLocalUser"] !== undefined) {
              lines.push(`  Local User: ${claims["isLocalUser"]}`);
            }

            // Issued at
            if (typeof claims["iat"] === "number") {
              lines.push(`  Issued At: ${new Date(claims["iat"] * 1000).toISOString()}`);
            }
            if (typeof claims["exp"] === "number") {
              lines.push(`  Expires At: ${new Date(claims["exp"] * 1000).toISOString()}`);
            }
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
          lines.push("");
          lines.push(`NPS Server Version: ${version}`);
        } catch {
          lines.push("");
          lines.push("NPS Server: Unable to reach (authentication or connectivity issue)");
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
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
