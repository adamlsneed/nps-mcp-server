/**
 * NPS Authentication Module
 *
 * Handles the two-step auth flow:
 *   1. POST /signinBody → initial bearer token
 *   2. POST /signin2fa → final bearer token (MFA code required)
 *
 * Also handles token refresh via GET /api/v1/UserToken
 *
 * For Application Users (headless/scheduled), the flow differs:
 *   - API key exchange for bearer token (TBD - not yet fully documented upstream)
 */

import { NpsConfig } from "./config.js";

interface TokenState {
  token: string;
  acquiredAt: number;
  expiresAt?: number;
}

let tokenState: TokenState | null = null;

/**
 * Parse a JWT to extract expiration time.
 * NPS tokens are standard JWTs with exp claim.
 */
function parseJwtExp(token: string): number | undefined {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    return decoded.exp ? decoded.exp * 1000 : undefined; // convert to ms
  } catch {
    return undefined;
  }
}

/**
 * Make an HTTP request to NPS, handling self-signed certs.
 */
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
    // Wait before retry (exponential backoff: 1s, 2s, 4s)
    if (attempt < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  return lastResponse!;
}

/**
 * Step 1: Authenticate with username/password → initial token
 */
async function signinBody(
  config: NpsConfig
): Promise<string> {
  const url = `${config.baseUrl}/signinBody`;
  const body = JSON.stringify({
    Login: config.username,
    Password: config.password,
  });

  const response = await npsRequestWithRetry(url, {
    method: "POST",
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `NPS signinBody failed (${response.status}): ${text}`
    );
  }

  // Response body is the token string (may be JSON-encoded)
  const token = await response.text();
  // Strip quotes if JSON-encoded string
  return token.replace(/^"|"$/g, "");
}

/**
 * Step 2: Submit MFA code → final bearer token
 */
async function signin2fa(
  config: NpsConfig,
  initialToken: string
): Promise<string> {
  const url = `${config.baseUrl}/signin2fa`;

  const response = await npsRequestWithRetry(url, {
    method: "POST",
    body: JSON.stringify(config.mfaCode || "000000"),
    headers: {
      Authorization: `Bearer ${initialToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `NPS signin2fa failed (${response.status}): ${text}`
    );
  }

  const token = await response.text();
  return token.replace(/^"|"$/g, "");
}

/**
 * Refresh an existing token before it expires
 */
async function refreshToken(
  config: NpsConfig,
  currentToken: string
): Promise<string> {
  const url = `${config.baseUrl}/api/v1/UserToken`;

  const response = await npsRequestWithRetry(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${currentToken}`,
    },
  });

  if (!response.ok) {
    // Token refresh failed — re-authenticate from scratch
    return authenticate(config);
  }

  const token = await response.text();
  return token.replace(/^"|"$/g, "");
}

/**
 * Full authentication flow: signinBody → signin2fa
 */
export async function authenticate(config: NpsConfig): Promise<string> {
  const initialToken = await signinBody(config);
  const finalToken = await signin2fa(config, initialToken);

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
    } catch {
      // Refresh failed, full re-auth
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
