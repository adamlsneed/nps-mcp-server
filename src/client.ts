/**
 * NPS API Client
 *
 * Authenticated HTTP client that handles token management,
 * self-signed certs, and response parsing.
 */

import { NpsConfig, loadConfig } from "./config.js";
import { getToken, clearToken } from "./auth.js";

let config: NpsConfig | null = null;

function getConfig(): NpsConfig {
  if (!config) {
    config = loadConfig();
  }
  return config;
}

export interface NpsRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Build URL with query parameters
 */
function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  const url = new URL(path, baseUrl);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

/**
 * Make an authenticated request to the NPS API.
 *
 * Automatically handles:
 * - Token acquisition and refresh
 * - Self-signed certificate bypass
 * - JSON serialization/deserialization
 * - Retry on 401 (re-authenticate once)
 */
export async function npsApi<T = unknown>(
  path: string,
  options: NpsRequestOptions = {}
): Promise<T> {
  const cfg = getConfig();
  const { method = "GET", body, params } = options;

  const url = buildUrl(cfg.baseUrl, path, params);

  const makeRequest = async (token: string): Promise<Response> => {
    const fetchOptions: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    return fetch(url, fetchOptions);
  };

  // Get token and make request
  let token = await getToken(cfg);
  let response = await makeRequest(token);

  // If 401, try re-authenticating once
  if (response.status === 401) {
    clearToken();
    token = await getToken(cfg);
    response = await makeRequest(token);
  }

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage =
        errorJson.message || errorJson.error || errorJson.title || errorText;
    } catch {
      errorMessage = errorText;
    }
    throw new NpsApiError(response.status, errorMessage, path);
  }

  // Handle empty responses (204, etc.)
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  // Try to parse as JSON, fall back to raw text
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

/**
 * Structured error for NPS API failures
 */
export class NpsApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly apiMessage: string,
    public readonly endpoint: string
  ) {
    super(`NPS API error ${statusCode} on ${endpoint}: ${apiMessage}`);
    this.name = "NpsApiError";
  }

  /**
   * Format for MCP tool error responses
   */
  toToolError(): string {
    return `NPS API Error (${this.statusCode}): ${this.apiMessage}`;
  }
}

/**
 * Helper to safely extract error messages for MCP tool responses
 */
export function formatToolError(error: unknown): string {
  if (error instanceof NpsApiError) {
    return error.toToolError();
  }
  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }
  return `Unknown error: ${String(error)}`;
}
