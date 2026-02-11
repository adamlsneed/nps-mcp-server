/**
 * NPS MCP Server Configuration
 *
 * Configuration is loaded from environment variables.
 * For Claude Code / local dev, these can be set in .env or shell.
 *
 * Auth strategies (auto-detected from which env vars are present):
 *
 * 1. Pre-supplied token (any auth provider — SAML, OIDC, Duo Push):
 *    NPS_URL        - Base URL of the NPS server
 *    NPS_TOKEN      - Bearer token obtained from browser login
 *
 * 2. Interactive + static MFA (lab, "Not Required", static TOTP):
 *    NPS_URL        - Base URL of the NPS server
 *    NPS_USERNAME   - Login username (e.g., domain\user or admin)
 *    NPS_PASSWORD   - Login password
 *    NPS_MFA_CODE   - MFA code (default: 000000 for lab/dev)
 *
 * 3. Interactive + MFA prompt (Duo TOTP, rotating codes — Claude Code only):
 *    NPS_URL        - Base URL of the NPS server
 *    NPS_USERNAME   - Login username
 *    NPS_PASSWORD   - Login password
 *    NPS_MFA_PROMPT - Set to "true" to prompt for MFA code at startup
 *
 * 4. API key (headless — LIMITED, see note below):
 *    NPS_URL        - Base URL of the NPS server
 *    NPS_USERNAME   - Application user login name
 *    NPS_API_KEY    - API key from the Application User's Authentication tab
 *    NOTE: API key auth has a known NPS bug where the JWT token is missing
 *    role claims, causing 403 on most endpoints even with admin role assigned.
 *
 * Optional:
 *   NPS_TLS_REJECT - Set to "true" to enforce TLS cert validation (default: false)
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type AuthStrategy = "token" | "interactive" | "interactive-prompt" | "apikey";

export interface NpsConfig {
  baseUrl: string;
  username: string;
  password: string;
  mfaCode?: string;
  apiKey?: string;
  preSuppliedToken?: string;
  mfaPrompt: boolean;
  authStrategy: AuthStrategy;
  tlsRejectUnauthorized: boolean;
}

/**
 * Load .env file from project root if it exists.
 * Simple key=value parser — no dependency needed.
 */
function loadEnvFile(): void {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const envPath = resolve(dir, "..", ".env");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file doesn't exist or can't be read — that's fine
  }
}

/**
 * Auto-detect auth strategy from environment variables.
 * Priority: NPS_TOKEN > NPS_API_KEY > NPS_MFA_PROMPT > NPS_PASSWORD > error
 */
function detectAuthStrategy(): AuthStrategy {
  if (process.env.NPS_TOKEN) return "token";
  if (process.env.NPS_API_KEY) return "apikey";
  if (process.env.NPS_MFA_PROMPT === "true" && process.env.NPS_PASSWORD) return "interactive-prompt";
  if (process.env.NPS_PASSWORD) return "interactive";
  // Will be caught by validation below
  return "interactive";
}

export function loadConfig(): NpsConfig {
  loadEnvFile();

  const baseUrl = process.env.NPS_URL;
  const username = process.env.NPS_USERNAME;
  const password = process.env.NPS_PASSWORD;
  const apiKey = process.env.NPS_API_KEY;
  const preSuppliedToken = process.env.NPS_TOKEN;
  const mfaPrompt = process.env.NPS_MFA_PROMPT === "true";

  if (!baseUrl) {
    throw new Error(
      "Missing required environment variable: NPS_URL\n" +
        "Example:\n" +
        '  NPS_URL="https://192.168.86.51:6500"'
    );
  }

  const authStrategy = detectAuthStrategy();

  // Token strategy doesn't need username/password
  if (authStrategy === "token") {
    const tlsReject = process.env.NPS_TLS_REJECT === "true";
    if (!tlsReject) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }
    return {
      baseUrl: baseUrl.replace(/\/+$/, ""),
      username: username || "",
      password: "",
      preSuppliedToken,
      mfaPrompt: false,
      authStrategy,
      tlsRejectUnauthorized: tlsReject,
    };
  }

  if (!username) {
    throw new Error(
      "Missing required environment variable: NPS_USERNAME\n" +
        "Example:\n" +
        '  NPS_USERNAME="admin"'
    );
  }

  // Either API key, token, or password is required
  if (!apiKey && !password && !preSuppliedToken) {
    throw new Error(
      "Missing authentication credentials. Configure one of these strategies:\n\n" +
        "  1. Pre-supplied token (any auth provider — SAML, OIDC, Duo Push):\n" +
        '     NPS_TOKEN="<bearer-token-from-browser>"\n' +
        "     Tip: Run `npx nps-auth` to get a token from browser login\n\n" +
        "  2. Interactive + static MFA (lab, static TOTP):\n" +
        '     NPS_PASSWORD="password" NPS_MFA_CODE="000000"\n\n' +
        "  3. Interactive + MFA prompt (rotating codes, Claude Code only):\n" +
        '     NPS_PASSWORD="password" NPS_MFA_PROMPT=true\n\n' +
        "  4. API key (headless — LIMITED due to NPS role-claims bug):\n" +
        '     NPS_API_KEY="your-api-key"\n' +
        "     Note: Most endpoints return 403 due to missing role claims in JWT"
    );
  }

  const tlsReject = process.env.NPS_TLS_REJECT === "true";

  // Handle self-signed certs globally if not rejecting
  if (!tlsReject) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""), // strip trailing slash
    username,
    password: password ?? "",
    mfaCode: process.env.NPS_MFA_CODE || "000000",
    apiKey,
    preSuppliedToken,
    mfaPrompt,
    authStrategy,
    tlsRejectUnauthorized: tlsReject,
  };
}
