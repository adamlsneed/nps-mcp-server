#!/usr/bin/env node

/**
 * NPS Auth Helper — Browser-Based Token Extraction
 *
 * Standalone CLI tool for obtaining NPS bearer tokens when using
 * browser-redirect auth flows (SAML, OIDC, Duo Push).
 *
 * Usage:
 *   npx nps-auth                          # Uses NPS_URL from .env
 *   npx nps-auth --url https://nps:6500   # Explicit URL
 *   npx nps-auth --save                   # Write token to .env as NPS_TOKEN
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { createInterface } from "node:readline";

// ─── .env helpers ───────────────────────────────────────────────────────────

function getProjectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function loadEnvVar(key: string): string | undefined {
  // Check process.env first
  if (process.env[key]) return process.env[key];

  // Try loading from .env
  try {
    const envPath = resolve(getProjectRoot(), ".env");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      if (k === key) return v;
    }
  } catch {
    // No .env file
  }
  return undefined;
}

function saveTokenToEnv(token: string): void {
  const envPath = resolve(getProjectRoot(), ".env");
  let content = "";

  if (existsSync(envPath)) {
    content = readFileSync(envPath, "utf-8");
    // Replace existing NPS_TOKEN line or append
    if (content.match(/^NPS_TOKEN=/m)) {
      content = content.replace(/^NPS_TOKEN=.*/m, `NPS_TOKEN=${token}`);
    } else {
      content = content.trimEnd() + `\nNPS_TOKEN=${token}\n`;
    }
  } else {
    content = `NPS_TOKEN=${token}\n`;
  }

  writeFileSync(envPath, content);
}

// ─── Browser opener ─────────────────────────────────────────────────────────

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) {
      console.error(`Could not open browser automatically. Please navigate to:\n  ${url}`);
    }
  });
}

// ─── Token validation ───────────────────────────────────────────────────────

async function validateToken(baseUrl: string, token: string): Promise<boolean> {
  try {
    // Disable TLS verification for self-signed certs
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const response = await fetch(`${baseUrl}/api/v1/Version`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (response.ok) {
      const version = await response.text();
      console.error(`\n✓ Token is valid! NPS version: ${version.replace(/"/g, "")}`);
      return true;
    } else {
      console.error(`\n✗ Token validation failed (HTTP ${response.status})`);
      return false;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ Could not connect to NPS server: ${msg}`);
    return false;
  }
}

// ─── CLI ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse flags
  let baseUrl: string | undefined;
  let save = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && i + 1 < args.length) {
      baseUrl = args[++i];
    } else if (args[i] === "--save") {
      save = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
NPS Auth Helper — Get a bearer token from browser-based NPS login

Usage:
  npx nps-auth                          Uses NPS_URL from .env
  npx nps-auth --url https://nps:6500   Explicit NPS URL
  npx nps-auth --save                   Save token to .env as NPS_TOKEN

This tool helps you get a bearer token when NPS is configured with
browser-redirect auth (SAML, OIDC, Duo Push) that can't go through
the API's signin2fa endpoint.

Steps:
  1. Opens NPS login page in your default browser
  2. You log in using whatever auth provider is configured
  3. Copy the token using the DevTools console snippet shown below
  4. Paste the token when prompted
  5. Token is validated and output (or saved to .env with --save)
`);
      process.exit(0);
    }
  }

  if (!baseUrl) {
    baseUrl = loadEnvVar("NPS_URL");
  }

  if (!baseUrl) {
    console.error(
      "Error: NPS URL not specified.\n" +
      "Provide it via --url flag or set NPS_URL in .env / environment.\n" +
      "Example: npx nps-auth --url https://192.168.86.51:6500"
    );
    process.exit(1);
  }

  baseUrl = baseUrl.replace(/\/+$/, "");

  console.error("╔══════════════════════════════════════════════════════════╗");
  console.error("║  NPS Auth Helper — Browser Token Extraction             ║");
  console.error("╚══════════════════════════════════════════════════════════╝");
  console.error("");
  console.error(`NPS Server: ${baseUrl}`);
  console.error("");
  console.error("Opening NPS login page in your browser...");
  console.error("");

  openBrowser(`${baseUrl}/#/login`);

  console.error("After logging in, open the browser DevTools console (F12) and run:");
  console.error("");
  console.error("  ──────────────────────────────────────────────────────");
  console.error("  copy(JSON.parse(sessionStorage.getItem('user'))?.token || 'No token found')");
  console.error("  ──────────────────────────────────────────────────────");
  console.error("");
  console.error("This copies the bearer token to your clipboard.");
  console.error("Then paste it below.");
  console.error("");

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  const token = await new Promise<string>((resolve) => {
    rl.question("Paste bearer token: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  if (!token) {
    console.error("No token provided. Exiting.");
    process.exit(1);
  }

  // Validate
  const valid = await validateToken(baseUrl, token);
  if (!valid) {
    console.error("The token could not be validated. It may be expired or invalid.");
    process.exit(1);
  }

  if (save) {
    saveTokenToEnv(token);
    console.error(`\n✓ Token saved to .env as NPS_TOKEN`);
    console.error("  The MCP server will use this token on next startup.");
  } else {
    // Print token to stdout for piping
    console.log(token);
    console.error("\nTo save to .env automatically, use: npx nps-auth --save");
  }

  console.error("\nTo use this token with the MCP server, set:");
  console.error(`  NPS_TOKEN=${token.substring(0, 20)}...`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
