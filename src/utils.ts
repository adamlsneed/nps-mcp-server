/**
 * Shared utilities — browser launch, resource resolution, JWT claim formatting
 */

import { execSync } from "node:child_process";
import { npsApi } from "./client.js";
import { parseJwt, hasAdminRoleClaim } from "./auth.js";

// ─── Browser / File Launch ──────────────────────────────────────────────────

/**
 * Open a URL or file path using the platform's default handler.
 * Returns true if launch succeeded, false otherwise.
 */
export function openWithDefault(target: string): boolean {
  try {
    if (process.platform === "darwin") {
      execSync(`open "${target}"`);
    } else if (process.platform === "win32") {
      execSync(`start "" "${target}"`);
    } else {
      execSync(`xdg-open "${target}"`);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Open a shell script in a terminal (macOS Terminal.app, Windows cmd, Linux x-terminal-emulator).
 * Returns true if launch succeeded, false otherwise.
 */
export function openInTerminal(scriptPath: string): boolean {
  try {
    if (process.platform === "darwin") {
      execSync(`open -a Terminal "${scriptPath}"`);
    } else if (process.platform === "win32") {
      execSync(`start cmd /k "${scriptPath}"`);
    } else {
      try {
        execSync(`x-terminal-emulator -e "${scriptPath}"`);
      } catch {
        execSync(`xterm -e "${scriptPath}"`);
      }
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Resource Resolution ────────────────────────────────────────────────────

export interface ManagedResource {
  id: string;
  name: string;
  displayName?: string;
  ipAddress?: string;
  platformId: string;
  platform?: { name: string };
  hostId?: string;
  host?: { hostName?: string; ipAddress?: string };
  domainConfigId?: string;
  serviceAccountId?: string;
  dnsHostName?: string;
  hostName?: string;
  portSsh?: number;
  portRdp?: number;
  portWinRm?: number;
  nodeId?: string;
  createdDateTimeUtc?: string;
  modifiedDateTimeUtc?: string;
}

/**
 * Resolve a resource name/hostname/IP to a ManagedResource object.
 * Fetches all resources and does fuzzy matching (exact first, then partial).
 * Returns null if no match found.
 */
export async function resolveResource(nameOrIp: string): Promise<ManagedResource | null> {
  const resources = await npsApi<ManagedResource[]>("/api/v1/ManagedResource");
  const term = nameOrIp.toLowerCase();

  // Exact match first, then partial
  return (
    resources.find(
      (r) =>
        r.name?.toLowerCase() === term ||
        r.displayName?.toLowerCase() === term ||
        r.dnsHostName?.toLowerCase() === term
    ) ??
    resources.find(
      (r) =>
        r.name?.toLowerCase().includes(term) ||
        r.dnsHostName?.toLowerCase().includes(term)
    ) ??
    null
  );
}

// ─── JWT Claim Formatting ───────────────────────────────────────────────────

const NAME_CLAIM = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name";
const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";

export interface JwtSummary {
  username?: string;
  roles?: string;
  hasAdmin: boolean;
  expiresAt?: Date;
  remainingMinutes?: number;
}

/**
 * Extract key fields from an NPS JWT token for display.
 */
export function summarizeJwt(token: string): JwtSummary {
  const claims = parseJwt(token);
  const summary: JwtSummary = { hasAdmin: hasAdminRoleClaim(token) };

  if (!claims) return summary;

  const nameClaim = claims[NAME_CLAIM] || claims["unique_name"] || claims["sub"];
  if (nameClaim) summary.username = String(nameClaim);

  const roleClaim = claims[ROLE_CLAIM];
  if (roleClaim) {
    summary.roles = Array.isArray(roleClaim) ? roleClaim.join(", ") : String(roleClaim);
  }

  if (typeof claims["exp"] === "number") {
    summary.expiresAt = new Date(claims["exp"] * 1000);
    summary.remainingMinutes = Math.round((summary.expiresAt.getTime() - Date.now()) / 60_000);
  }

  return summary;
}
