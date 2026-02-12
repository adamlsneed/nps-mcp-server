# NPS MCP Server — Claude Project Instructions

## Project Overview

This project builds an MCP (Model Context Protocol) server that wraps the Netwrix Privilege Secure (NPS) for Access Management 4.2 REST API. The goal is to allow Claude (via Claude Code, Claude Desktop, or other MCP-capable clients) to interact with NPS programmatically — creating sessions, managing resources, querying credentials, and performing common SA/admin workflows.

## Product Context

Netwrix Privilege Secure (NPS) is a Privileged Access Management (PAM) solution focused on Zero Standing Privilege. Key concepts:

- **Activity Sessions** — The core unit of work. A session grants temporary, just-in-time privileged access to a resource. Sessions have a lifecycle: created → started → running → ended.
- **Activities** — Define what NPS does before, during, and after a session (e.g., create a temp account, add to local admins, remove on end).
- **Managed Resources** — Servers, endpoints, Entra ID tenants, databases, or secret vaults that NPS manages access to.
- **Managed Accounts** — AD users/groups whose access NPS orchestrates.
- **Access Control Policies** — Bind users + resources + activities together. A user must be in a policy to create a session.
- **Connection Profiles (ActivityConfiguration)** — Session parameters: max duration, recording, approval workflows, extension rules, proxy settings.
- **Credentials** — Managed credentials with rotation schedules, password complexity policies, and vault integration.
- **Service Accounts** — Accounts NPS uses to reach into target systems.
- **Platforms** — Define resource types with fixed GUIDs:
  - Windows: `d07c4352-ea1a-44a2-8fe8-6f198ec1119f`
  - Active Directory: `d6a07d9c-4b2e-4430-8c5b-401724dce933`
  - Linux/Unix: `43a54a6d-1ba3-4b98-a2eb-552e03c60766`
  - (Others exist for Entra ID, databases, websites, secret vaults)

## API Details

- **Base URL:** `https://<server>:6500`
- **API Prefix:** `/api/v1/`
- **Auth Flow (Interactive User):**
  1. `POST /signinBody` with `{ "Login": "domain\\user", "Password": "..." }` → returns initial bearer token
  2. `POST /signin2fa` with MFA code as body, `Authorization: Bearer <token>` header → returns final bearer token
  3. Use `Authorization: Bearer <token>` for all subsequent calls
  4. Token refresh via `GET /api/v1/UserToken`
- **Auth Flow (Application User):** API key exchange for bearer token (details TBD — still being documented upstream)
- **Self-signed certs are common** — always support `rejectUnauthorized: false` or equivalent, configurable

## Architecture Decisions

- **Language:** TypeScript with the official MCP SDK (`@modelcontextprotocol/sdk`)
- **Transport:** stdio (for Claude Code / Claude Desktop integration)
- **HTTP Client:** Native `fetch` or `undici` — no heavy dependencies
- **Auth Module:** Centralized token management with auto-refresh
- **Error Handling:** All NPS API errors should surface meaningful messages, not raw HTTP errors. Session logs (`/api/v1/ActivitySession/{id}/Log`) are critical for debugging failed sessions.

## Tool Priority List

### Phase 1 — Read-Only / Health (build first)
1. `nps_version` — `GET /api/v1/Version`
2. `nps_list_resources` — List managed resources with status
3. `nps_list_sessions` — Active/recent sessions
4. `nps_list_policies` — Access policies with bindings
5. `nps_list_users` — Users/groups with roles
6. `nps_list_credentials` — Credential status and rotation info

### Phase 2 — Session Lifecycle (core value)
7. `nps_create_session` — Create activity session (resource + activity name)
8. `nps_session_status` — Poll session status + get logs
9. `nps_get_connection` — Fetch RDP file or SSH URL (platform-aware)
10. `nps_extend_session` — Extend a running session
11. `nps_end_session` — End/cancel a session

### Phase 3 — Administration
12. `nps_onboard_resource` — Add a managed resource
13. `nps_rotate_credential` — Trigger credential rotation
14. `nps_create_policy` — Create an access policy
15. `nps_session_logs` — Detailed action queue logs for a session

### Phase 4 — Advanced
16. `nps_search_audit` — Search audit/activity logs
17. `nps_list_platforms` — Platform definitions
18. `nps_service_accounts` — Service account management
19. `nps_authentication_connectors` — MFA/SAML/OIDC config queries

## Lab Environment

- **NPS Server:** `https://your-nps-server:6500/`
- **Admin Credentials:** Set in `.env` file (not committed)
- **AD domains and Linux targets available for testing session creation and credential rotation**
- **Self-signed certificates** — all HTTP calls must handle this

## Key References

- **API Docs Repo:** `https://github.com/netwrix/privilege-secure/tree/main/api-docs/4.2`
- **Product Docs Repo:** `https://github.com/netwrix/docs/tree/dev/docs/privilegesecure/4.2`
- **KB Articles:** `https://github.com/netwrix/docs/tree/dev/docs/kb/privilegesecure`
- **Published Docs:** `https://docs.netwrix.com/docs/privilegesecure/4_2/`
- **Community API Examples:** `https://community.netwrix.com/t/using-the-api-to-create-activity-sessions-in-privilege-secure/2517`
- **PowerShell Module Guide:** `https://community.netwrix.com/t/getting-started-with-the-api-and-powershell-module-a-beginners-guide/111025`

## Development Workflow

1. Clone both repos locally for reference
2. Read the SKILL.md for tool development patterns
3. Build each tool following the pattern: read API doc → implement → test against lab → validate response parsing → commit
4. Test tools via MCP Inspector or Claude Desktop before shipping

## Important Notes

- NPS API returns very verbose response objects (deeply nested with all related entities). Tools should extract and return only the relevant fields — don't dump raw API responses.
- Session status codes: 0 = created, 1 = started/running. Poll every 10-15 seconds when waiting for session start.
- RDP files are only valid for Windows (`d07c4352-...`) and AD (`d6a07d9c-...`) platforms. All others use SSH URLs.
- The PowerShell module is `SbPAMAPI` (installed from `SbPAMPowershellModules.msi` in Extras). The MCP server replaces this for Claude-driven workflows.
- MFA is required for all interactive users. Application Users with API keys bypass MFA but have their own auth flow.
