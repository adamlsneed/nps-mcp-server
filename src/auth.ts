/**
 * NPS Authentication Module
 *
 * Multi-strategy auth supporting:
 *   1. "token"              — Pre-supplied bearer token (validated on first use)
 *   2. "apikey"             — Application user API key auth (warns about role-claims bug)
 *   3. "interactive-prompt" — Username/password + prompted MFA code via /dev/tty
 *   4. "interactive"        — Username/password + static MFA code
 *
 * Also handles token refresh via GET /api/v1/UserToken
 */

import { NpsConfig } from "./config.js";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

interface TokenState {
  token: string;
  acquiredAt: number;
  expiresAt?: number;
}

let tokenState: TokenState | null = null;

// ─── JWT Helpers ────────────────────────────────────────────────────────────

/**
 * Parse a JWT payload (without verification — NPS tokens are validated server-side).
 */
export function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
}

/**
 * Extract expiration time from JWT.
 */
function parseJwtExp(token: string): number | undefined {
  const payload = parseJwt(token);
  if (payload && typeof payload.exp === "number") {
    return payload.exp * 1000; // convert to ms
  }
  return undefined;
}

/**
 * Check if JWT has an admin role claim.
 * NPS uses the Microsoft role claim URI.
 */
export function hasAdminRoleClaim(token: string): boolean {
  const payload = parseJwt(token);
  if (!payload) return false;
  const roleClaim = payload["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"];
  if (!roleClaim) return false;
  const isAdmin = (r: unknown): boolean =>
    typeof r === "string" && (r.toLowerCase() === "administrator" || r.toLowerCase() === "admin");
  if (Array.isArray(roleClaim)) {
    return roleClaim.some(isAdmin);
  }
  return isAdmin(roleClaim);
}

/**
 * Get token state for diagnostics (nps_auth_status tool).
 */
export function getTokenState(): TokenState | null {
  return tokenState;
}

// ─── HTTP Helpers ───────────────────────────────────────────────────────────

async function npsRequest(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
  });
}

/**
 * Retry a request up to maxRetries times on transient 500 errors.
 * NPS server intermittently 500s on auth endpoints.
 */
async function npsRequestWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3
): Promise<Response> {
  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    lastResponse = await npsRequest(url, options);
    if (lastResponse.status !== 500) {
      return lastResponse;
    }
    if (attempt < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  return lastResponse!;
}

// ─── TTY Prompt ─────────────────────────────────────────────────────────────

/**
 * Prompt for MFA code via /dev/tty (Unix) or CON (Windows).
 * This bypasses stdin which is owned by the MCP protocol.
 * Output goes to stderr (stdout is MCP protocol).
 */
async function promptMfaCode(): Promise<string> {
  const ttyPath = process.platform === "win32" ? "CON" : "/dev/tty";

  try {
    const ttyStream = createReadStream(ttyPath, { encoding: "utf8" });
    const rl = createInterface({
      input: ttyStream,
      terminal: false,
    });

    process.stderr.write("\n╔══════════════════════════════════════════╗\n");
    process.stderr.write("║  NPS MFA Code Required                   ║\n");
    process.stderr.write("╚══════════════════════════════════════════╝\n");
    process.stderr.write("Enter MFA code: ");

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        rl.close();
        ttyStream.destroy();
        reject(new Error(
          "MFA prompt timed out after 120 seconds.\n" +
          "If running in a non-interactive environment (e.g., Claude Desktop),\n" +
          "use NPS_MFA_CODE for static codes or NPS_TOKEN for browser-based auth."
        ));
      }, 120_000);

      rl.once("line", (line) => {
        clearTimeout(timeout);
        rl.close();
        ttyStream.destroy();
        resolve(line.trim());
      });

      rl.once("error", (err) => {
        clearTimeout(timeout);
        rl.close();
        ttyStream.destroy();
        reject(new Error(
          `Cannot read MFA code from TTY (${ttyPath}): ${err.message}\n` +
          "This auth strategy requires an interactive terminal (e.g., Claude Code).\n" +
          "For non-interactive environments, use NPS_MFA_CODE or NPS_TOKEN instead."
        ));
      });
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot open TTY (${ttyPath}) for MFA prompt: ${msg}\n` +
      "This auth strategy requires an interactive terminal (e.g., Claude Code).\n" +
      "For non-interactive environments, use NPS_MFA_CODE or NPS_TOKEN instead."
    );
  }
}

// ─── Auth Strategy: signinBody (shared by interactive + apikey) ─────────────

async function signinBody(
  config: NpsConfig,
  password: string
): Promise<string> {
  const url = `${config.baseUrl}/signinBody`;
  const body = JSON.stringify({
    Login: config.username,
    Password: password,
  });

  const response = await npsRequestWithRetry(url, {
    method: "POST",
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`NPS signinBody failed (${response.status}): ${text}`);
  }

  const token = await response.text();
  return token.replace(/^"|"$/g, "");
}

/**
 * Submit MFA code → final bearer token
 */
async function signin2fa(
  config: NpsConfig,
  initialToken: string,
  mfaCode: string
): Promise<string> {
  const url = `${config.baseUrl}/signin2fa`;

  const response = await npsRequestWithRetry(url, {
    method: "POST",
    body: JSON.stringify(mfaCode),
    headers: {
      Authorization: `Bearer ${initialToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`NPS signin2fa failed (${response.status}): ${text}`);
  }

  const token = await response.text();
  return token.replace(/^"|"$/g, "");
}

// ─── Auth Strategy: Token ──────────────────────────────────────────────────

async function authenticateWithToken(config: NpsConfig): Promise<string> {
  const token = config.preSuppliedToken!;

  // Validate token by calling a lightweight endpoint
  const url = `${config.baseUrl}/api/v1/Version`;
  const response = await npsRequest(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(
      `Pre-supplied token is invalid or expired (${response.status}).\n` +
      "Get a new token by running: npx nps-auth\n" +
      "Or log into NPS in your browser and extract the token from DevTools."
    );
  }

  process.stderr.write("[auth] Using pre-supplied token\n");
  return token;
}

// ─── Auth Strategy: API Key ────────────────────────────────────────────────

async function authenticateWithApiKey(config: NpsConfig): Promise<string> {
  const token = await signinBody(config, config.apiKey!);

  // Check for missing role claims (known NPS bug)
  if (!hasAdminRoleClaim(token)) {
    process.stderr.write(
      "\n⚠ WARNING: API key auth succeeded but the JWT token is missing admin role claims.\n" +
      "This is a known NPS bug — most API endpoints will return 403 Forbidden.\n" +
      "Workarounds:\n" +
      "  1. Switch to interactive auth: NPS_PASSWORD + NPS_MFA_CODE\n" +
      "  2. Use a browser token: NPS_TOKEN (run `npx nps-auth` to get one)\n\n"
    );
  }

  process.stderr.write("[auth] Authenticated via API key\n");
  return token;
}

// ─── Auth Strategy: Interactive + Prompt ─────────────────────────────────

async function authenticateInteractivePrompt(config: NpsConfig): Promise<string> {
  const initialToken = await signinBody(config, config.password);
  const mfaCode = await promptMfaCode();
  const finalToken = await signin2fa(config, initialToken, mfaCode);
  process.stderr.write("[auth] Authenticated with interactive MFA prompt\n");
  return finalToken;
}

// ─── Auth Strategy: Interactive + Static MFA ────────────────────────────

async function authenticateInteractive(config: NpsConfig): Promise<string> {
  const initialToken = await signinBody(config, config.password);
  const finalToken = await signin2fa(config, initialToken, config.mfaCode || "000000");
  process.stderr.write("[auth] Authenticated with static MFA code\n");
  return finalToken;
}

// ─── Token Refresh ──────────────────────────────────────────────────────────

async function refreshToken(
  config: NpsConfig,
  currentToken: string
): Promise<string> {
  const url = `${config.baseUrl}/api/v1/UserToken`;

  const response = await npsRequestWithRetry(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${currentToken}` },
  });

  if (!response.ok) {
    // For token strategy, we can't re-authenticate — no credentials
    if (config.authStrategy === "token") {
      throw new Error(
        "Token expired and cannot be refreshed. Update NPS_TOKEN with a new token.\n" +
        "Run `npx nps-auth` to get a fresh token from browser login."
      );
    }
    // For other strategies, re-authenticate from scratch
    return authenticate(config);
  }

  const token = await response.text();
  return token.replace(/^"|"$/g, "");
}

// ─── Main Entry Points ─────────────────────────────────────────────────────

/**
 * Full authentication flow — dispatches to the configured strategy.
 */
export async function authenticate(config: NpsConfig): Promise<string> {
  let finalToken: string;

  switch (config.authStrategy) {
    case "token":
      finalToken = await authenticateWithToken(config);
      break;
    case "apikey":
      finalToken = await authenticateWithApiKey(config);
      break;
    case "interactive-prompt":
      finalToken = await authenticateInteractivePrompt(config);
      break;
    case "interactive":
      finalToken = await authenticateInteractive(config);
      break;
    default:
      throw new Error(`Unknown auth strategy: ${config.authStrategy}`);
  }

  tokenState = {
    token: finalToken,
    acquiredAt: Date.now(),
    expiresAt: parseJwtExp(finalToken),
  };

  return finalToken;
}

/**
 * Get a valid token, refreshing if needed.
 * This is the main entry point for other modules.
 */
export async function getToken(config: NpsConfig): Promise<string> {
  if (!tokenState) {
    return authenticate(config);
  }

  // Check if token is expiring within 7 minutes (matching NPS PS module pattern)
  const bufferMs = 7 * 60 * 1000;
  const now = Date.now();

  if (tokenState.expiresAt && tokenState.expiresAt - now < bufferMs) {
    try {
      const newToken = await refreshToken(config, tokenState.token);
      tokenState = {
        token: newToken,
        acquiredAt: Date.now(),
        expiresAt: parseJwtExp(newToken),
      };
    } catch (err) {
      // For token strategy, don't silently retry — surface the error
      if (config.authStrategy === "token") {
        throw err;
      }
      // Other strategies: full re-auth
      return authenticate(config);
    }
  }

  return tokenState.token;
}

/**
 * Clear cached token (for logout or error recovery)
 */
export function clearToken(): void {
  tokenState = null;
}
