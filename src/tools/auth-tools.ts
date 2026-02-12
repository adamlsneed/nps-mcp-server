/**
 * Auth Tools — browser login and manual token injection
 */

import { z } from "zod";
import { execSync } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startAuthServer } from "../auth-server.js";
import { setToken, parseJwt, hasAdminRoleClaim } from "../auth.js";
import { loadConfig } from "../config.js";

export function registerAuthTools(server: McpServer): void {
  /**
   * nps_login — Start browser-based login flow
   */
  server.tool(
    "nps_login",
    "Start browser-based login to NPS. Opens a local page with instructions to log in via your browser (supports all auth methods: local, domain, SAML, OIDC, Duo). After login, a bookmarklet sends the token back to Claude automatically.",
    {},
    async () => {
      try {
        const config = loadConfig();
        const { port, tokenPromise } = await startAuthServer(config.baseUrl);
        const localUrl = `http://localhost:${port}`;

        // Open browser to landing page
        try {
          if (process.platform === "darwin") {
            execSync(`open "${localUrl}"`);
          } else if (process.platform === "win32") {
            execSync(`start "" "${localUrl}"`);
          } else {
            execSync(`xdg-open "${localUrl}"`);
          }
        } catch {
          // Browser open failed — user can navigate manually
        }

        // Listen for the token in the background (don't block the tool response)
        tokenPromise
          .then((token) => {
            setToken(token);
            process.stderr.write("[auth] Browser login token received and stored\n");
          })
          .catch((err) => {
            process.stderr.write(`[auth] Browser login failed: ${err.message}\n`);
          });

        return {
          content: [
            {
              type: "text",
              text: [
                `Browser login started. A page should have opened at: ${localUrl}`,
                "",
                "Instructions:",
                "1. Drag the 'Send Token to Claude' bookmarklet to your bookmarks bar",
                `2. Click the NPS login link to open ${config.baseUrl}`,
                "3. Log in using any method (local, domain, SAML, Duo, etc.)",
                "4. Once on the NPS dashboard, click the bookmarklet",
                "",
                "The token will be sent back automatically. You can then use any NPS tool.",
                "",
                `If the browser didn't open, navigate to: ${localUrl}`,
                "",
                "Alternative: Copy the token from browser DevTools (F12 → Console → sessionStorage.getItem('Token'))",
                "and use the nps_set_token tool to paste it directly.",
              ].join("\n"),
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error starting login flow: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  /**
   * nps_set_token — Manually set a bearer token
   */
  server.tool(
    "nps_set_token",
    "Manually set an NPS bearer token. Use this if you have a token from browser DevTools (sessionStorage.getItem('Token')), a previous session, or another source. Validates the token against the NPS server before storing it.",
    { token: z.string().describe("NPS bearer token (JWT)") },
    async ({ token }) => {
      try {
        const config = loadConfig();

        // Validate the token against the NPS server
        const response = await fetch(`${config.baseUrl}/api/v1/Version`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Token validation failed (HTTP ${response.status}). The token may be expired or invalid.\n` +
                  "Get a fresh token by logging into NPS in your browser and running sessionStorage.getItem('Token') in DevTools.",
              },
            ],
            isError: true,
          };
        }

        const version = await response.text();

        // Store the token
        setToken(token);

        // Parse JWT for user info
        const claims = parseJwt(token);
        const lines: string[] = ["Token accepted and stored."];
        lines.push("");
        lines.push(`NPS Server: ${version.replace(/^"|"$/g, "")}`);

        if (claims) {
          const nameClaim =
            claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] ||
            claims["unique_name"] ||
            claims["sub"];
          if (nameClaim) lines.push(`User: ${nameClaim}`);

          const roleClaim = claims["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"];
          if (roleClaim) {
            const roles = Array.isArray(roleClaim) ? roleClaim.join(", ") : String(roleClaim);
            lines.push(`Role: ${roles}`);
          }

          const hasAdmin = hasAdminRoleClaim(token);
          lines.push(`Admin: ${hasAdmin ? "Yes" : "No — most API calls will fail with 403"}`);

          if (typeof claims["exp"] === "number") {
            const expDate = new Date(claims["exp"] * 1000);
            const remainMin = Math.round((expDate.getTime() - Date.now()) / 60_000);
            lines.push(`Expires: ${expDate.toISOString()} (${remainMin} minutes)`);
          }
        }

        process.stderr.write("[auth] Token manually set via nps_set_token\n");

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error setting token: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
