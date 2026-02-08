# NPS MCP Server

MCP (Model Context Protocol) server for **Netwrix Privilege Secure 4.2**. Enables Claude and other MCP-capable clients to manage privileged access sessions, resources, credentials, and policies.

## Quick Start

```bash
# Install dependencies
npm install

# Set environment variables
export NPS_URL="https://nps.adamsneed.com:6500"
export NPS_USERNAME="admin"
export NPS_PASSWORD="Temp123!"


# Run in dev mode
npm run dev

# Or test with MCP Inspector
npm run inspect
```

## Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nps": {
      "command": "npx",
      "args": ["tsx", "/path/to/nps-mcp-server/src/index.ts"],
      "env": {
        "NPS_URL": "https://192.168.86.51:6500",
        "NPS_USERNAME": "admin",
        "NPS_PASSWORD": "Temp123!"
      }
    }
  }
}
```

## Available Tools

### Phase 1 — Read-Only / Health
| Tool | Description |
|------|-------------|
| `nps_version` | Get NPS server version and validate connectivity |
| `nps_list_resources` | List managed resources with platform, IP, ports |
| `nps_list_sessions` | List active/recent activity sessions |
| `nps_list_policies` | List access control policies with bindings |
| `nps_list_users` | List managed accounts (stub — needs endpoint verification) |
| `nps_list_credentials` | List managed credentials (stub — needs endpoint verification) |

### Phase 2 — Session Lifecycle
| Tool | Description |
|------|-------------|
| `nps_create_session` | Create an activity session (resource + activity name) |
| `nps_session_status` | Check session status, get logs on failure |
| `nps_get_connection` | Get RDP file or SSH URL for running session |
| `nps_end_session` | End/cancel an active session |
| `nps_session_logs` | Detailed action queue logs for troubleshooting |

### Phase 3+ — Planned
- `nps_onboard_resource` — Add a managed resource
- `nps_rotate_credential` — Trigger credential rotation (stub implemented)
- `nps_create_policy` — Create an access policy
- `nps_search_audit` — Search audit logs
- `nps_list_platforms` — Platform definitions

## Architecture

```
src/
├── index.ts         # MCP server entry point
├── config.ts        # Environment-based configuration
├── auth.ts          # Two-step auth (signinBody → 2FA → token refresh)
├── client.ts        # Authenticated HTTP client wrapper
├── types.ts         # Platform constants, session status codes
└── tools/
    ├── system.ts      # Version, health
    ├── resources.ts   # Managed resources
    ├── sessions.ts    # Activity session lifecycle
    ├── policies.ts    # Access control policies
    ├── users.ts       # Users and groups
    └── credentials.ts # Credential management
```

## Development

### Adding a New Tool

1. Read the API endpoint doc from `reference/api-docs/`
2. Add the tool to the appropriate file in `src/tools/`
3. Follow the pattern in SKILL.md
4. Register the tool in the appropriate `register*Tools()` function
5. Test against the lab with MCP Inspector
6. Update this README

### API References
- API Docs: https://github.com/netwrix/privilege-secure/tree/main/api-docs/4.2
- Product Docs: https://docs.netwrix.com/docs/privilegesecure/4_2/
- Community Examples: https://community.netwrix.com/t/using-the-api-to-create-activity-sessions-in-privilege-secure/2517
