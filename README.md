# NPS MCP Server

MCP (Model Context Protocol) server for **Netwrix Privilege Secure (NPS) 25.12.00002**. Gives Claude and other MCP clients full control over privileged access sessions, resources, credentials, and policies through 35 tools.

## Quick Start

```bash
# Clone and install
git clone <repo-url> && cd nps-mcp-server
npm install

# Configure credentials
cp .env.example .env
# Edit .env with your NPS URL and credentials

# Build
npm run build

# Test connectivity
NPS_URL="https://your-nps:6500" NPS_USERNAME="admin" NPS_PASSWORD="pass" NPS_MFA_CODE="000000" \
  node dist/index.js
```

## Authentication

The server supports 4 auth strategies, auto-detected from environment variables.

### Strategy 1: Interactive + Static MFA (recommended for lab/dev)

Best for environments with "Not Required" MFA or static TOTP codes.

```bash
NPS_URL=https://your-nps-server:6500
NPS_USERNAME=admin
NPS_PASSWORD=YourPassword
NPS_MFA_CODE=000000
```

### Strategy 2: Interactive + MFA Prompt (Claude Code only)

Prompts for MFA code at startup via `/dev/tty`. Works with Duo TOTP, rotating codes, or any MFA that generates a one-time code.

```bash
NPS_URL=https://your-nps-server:6500
NPS_USERNAME=admin
NPS_PASSWORD=YourPassword
NPS_MFA_PROMPT=true
```

> Requires an interactive terminal. Does not work with Claude Desktop (no TTY).

### Strategy 3: Pre-supplied Token (any auth provider)

Use a bearer token obtained from a browser login. Works with SAML, OIDC, Duo Push, or any auth provider configured in NPS.

```bash
NPS_URL=https://your-nps-server:6500
NPS_TOKEN=eyJhbGciOiJSUzI1NiIs...
```

Get a token with the included helper:

```bash
npx nps-auth                          # Uses NPS_URL from .env
npx nps-auth --url https://nps:6500   # Explicit URL
npx nps-auth --save                   # Save token to .env automatically
```

The helper opens NPS in your browser, you log in with whatever provider is configured, then paste the token from DevTools.

### Strategy 4: API Key (limited)

Application user auth. Bypasses MFA but has a **known NPS bug** where the JWT token is missing role claims, causing 403 on most endpoints.

```bash
NPS_URL=https://your-nps-server:6500
NPS_USERNAME=AppName
NPS_API_KEY=your-api-key-here
```

> Not recommended until Netwrix fixes the role claims issue. Use `nps_auth_status` to diagnose.

### Auto-Detection Order

The server detects the strategy from which env vars are set:

`NPS_TOKEN` > `NPS_API_KEY` > `NPS_MFA_PROMPT` + `NPS_PASSWORD` > `NPS_PASSWORD` > error with guidance

### TLS / Self-Signed Certificates

Self-signed certs are common with NPS. TLS verification is disabled by default.

```bash
NPS_TLS_REJECT=true   # Set to enforce certificate validation
```

## Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "nps": {
      "command": "node",
      "args": ["/path/to/nps-mcp-server/dist/index.js"],
      "env": {
        "NPS_URL": "https://your-nps-server:6500",
        "NPS_USERNAME": "admin",
        "NPS_PASSWORD": "YourPassword",
        "NPS_MFA_CODE": "000000",
        "NODE_TLS_REJECT_UNAUTHORIZED": "0"
      }
    }
  }
}
```

Or with a pre-supplied token:

```json
{
  "mcpServers": {
    "nps": {
      "command": "node",
      "args": ["/path/to/nps-mcp-server/dist/index.js"],
      "env": {
        "NPS_URL": "https://your-nps-server:6500",
        "NPS_TOKEN": "eyJhbGciOiJSUzI1NiIs...",
        "NODE_TLS_REJECT_UNAUTHORIZED": "0"
      }
    }
  }
}
```

## Claude Code Configuration

Add to `.mcp.json` in your project root or `~/.claude/claude_code_config.json`:

```json
{
  "mcpServers": {
    "nps": {
      "command": "node",
      "args": ["/path/to/nps-mcp-server/dist/index.js"],
      "env": {
        "NPS_URL": "https://your-nps-server:6500",
        "NPS_USERNAME": "admin",
        "NPS_PASSWORD": "YourPassword",
        "NPS_MFA_CODE": "000000",
        "NODE_TLS_REJECT_UNAUTHORIZED": "0"
      }
    }
  }
}
```

## Tools (35)

### System & Diagnostics

| Tool | Description |
|------|-------------|
| `nps_version` | Get NPS server version and validate connectivity |
| `nps_auth_status` | Diagnose auth strategy, token health, JWT claims, admin role |

### Resources

| Tool | Description |
|------|-------------|
| `nps_list_resources` | List managed resources with platform, IP, ports |
| `nps_resource_access` | Find available activities for a resource via policy search |

### Session Lifecycle

| Tool | Description |
|------|-------------|
| `nps_list_sessions` | List sessions (running, pending, or all) |
| `nps_create_session` | Create a just-in-time privileged access session |
| `nps_session_status` | Check session status and get failure logs |
| `nps_get_connection` | Get RDP file or SSH URL for a running session |
| `nps_end_session` | End or cancel an active session |
| `nps_extend_session` | Extend a running session duration |
| `nps_session_logs` | Detailed action queue logs with pagination |

### Users & Credentials

| Tool | Description |
|------|-------------|
| `nps_list_users` | List managed accounts with domain and session counts |
| `nps_list_credentials` | List credentials with rotation policy and platform |
| `nps_rotate_credential` | Trigger immediate credential rotation |

### Policies

| Tool | Description |
|------|-------------|
| `nps_list_policies` | List access policies with user/resource/activity bindings |
| `nps_policy_detail` | Full policy drill-down with bound users, resources, activities |

### Administration

| Tool | Description |
|------|-------------|
| `nps_onboard_resource` | Add a new managed resource to NPS |
| `nps_create_policy` | Create a new access control policy |

### Platforms & Discovery

| Tool | Description |
|------|-------------|
| `nps_list_platforms` | Platform definitions with GUIDs and OS types |
| `nps_list_activities` | Activity definitions (what happens during sessions) |
| `nps_connector_config` | NPS connector configuration entries |
| `nps_authentication_connectors` | MFA/SAML/OIDC auth connectors |

### Reporting

| Tool | Description |
|------|-------------|
| `nps_session_report` | Session activity report with duration stats and top users |
| `nps_session_dashboard` | Quick dashboard: all-time, 7-day, and 24-hour stats |
| `nps_access_report` | User access report with active sessions and lock status |
| `nps_resource_report` | Resource inventory grouped by platform |
| `nps_policy_report` | Policy coverage report with binding counts |
| `nps_credential_rotation_report` | Credential rotation compliance summary |

### Audit & Search

| Tool | Description |
|------|-------------|
| `nps_search_sessions` | Rich session search with server-side filtering and analytics |
| `nps_resource_sessions` | Session history for a specific resource |
| `nps_user_sessions` | Session history for a specific user |
| `nps_historical_sessions` | Historical sessions with date ranges and multi-filters |
| `nps_credential_health` | Credential rotation health and compliance |
| `nps_action_queue` | NPS action execution queue |
| `nps_service_account_details` | Service account details for a credential |

## Development

```bash
# Dev mode (auto-compiles TypeScript)
npm run dev

# Build for production
npm run build

# Run production build
npm start

# Test with MCP Inspector
npm run inspect
```

## Project Structure

```
src/
  index.ts          # MCP server entry point, tool registration
  config.ts         # Environment config, auth strategy detection
  auth.ts           # Multi-strategy authentication (4 strategies)
  client.ts         # Authenticated HTTP client with auto-refresh
  types.ts          # Platform constants, session types, shared utilities
  auth-helper.ts    # Standalone CLI for browser-based token extraction
  tools/
    system.ts       # nps_version, nps_auth_status
    resources.ts    # Resource listing and access discovery
    sessions.ts     # Full session lifecycle (create, status, connect, end, extend)
    policies.ts     # Policy listing
    users.ts        # User/account listing
    credentials.ts  # Credential listing and rotation
    admin.ts        # Resource onboarding, policy creation
    platforms.ts    # Platforms, activities, connectors
    reporting.ts    # Session, access, resource, policy, credential reports
    audit.ts        # Session search, history, credential health, action queue
```

## Requirements

- Node.js 18+
- NPS 25.12.00002 or later
- Network access to NPS server (default port 6500)

## License

ISC
