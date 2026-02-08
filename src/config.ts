/**
 * NPS MCP Server Configuration
 *
 * Configuration is loaded from environment variables.
 * For Claude Code / local dev, these can be set in .env or shell.
 *
 * Required:
 *   NPS_URL        - Base URL of the NPS server (e.g., https://192.168.86.51:6500)
 *   NPS_USERNAME   - Login username (e.g., domain\user or admin)
 *   NPS_PASSWORD   - Login password
 *
 * Optional:
 *   NPS_MFA_CODE   - MFA code (default: 000000 for lab/dev)
 *   NPS_TLS_REJECT - Set to "true" to enforce TLS cert validation (default: false)
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface NpsConfig {
  baseUrl: string;
  username: string;
  password: string;
  mfaCode?: string;
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

export function loadConfig(): NpsConfig {
  loadEnvFile();
  const baseUrl = process.env.NPS_URL;
  const username = process.env.NPS_USERNAME;
  const password = process.env.NPS_PASSWORD;

  if (!baseUrl || !username || !password) {
    throw new Error(
      "Missing required environment variables: NPS_URL, NPS_USERNAME, NPS_PASSWORD\n" +
        "Example:\n" +
        '  NPS_URL="https://192.168.86.51:6500"\n' +
        '  NPS_USERNAME="admin"\n' +
        '  NPS_PASSWORD="Temp123!"'
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
    password,
    mfaCode: process.env.NPS_MFA_CODE || "000000",
    tlsRejectUnauthorized: tlsReject,
  };
}
