---
name: nps-mcp-tool-builder
description: Build and test MCP tools that wrap the Netwrix Privilege Secure 4.2 REST API
metadata:
  version: 1.0
  category: mcp-development
  target: claude-code
  references:
    - api-docs: ./reference/api-docs/
    - product-docs: ./reference/product-docs/
    - lab-endpoint: https://192.168.86.51:6500
---

# NPS MCP Tool Builder

## Purpose

Autonomously build, test, and refine individual MCP tools that wrap Netwrix Privilege Secure (NPS) 4.2 API endpoints. Each loop iteration produces one complete, tested MCP tool.

## Phase 1: Context Gathering

Before building any tool, read these files in order:

1. `./PROJECT_INSTRUCTIONS.md` — architecture, domain model, API auth flow
2. `./reference/api-docs/` — find the specific endpoint doc for the target tool
3. `./src/auth.ts` — understand the existing auth/token management
4. `./src/client.ts` — understand the HTTP client wrapper
5. Any existing tools in `./src/tools/` — follow established patterns

## Phase 2: Tool Implementation

### File Location
- Tool files go in `./src/tools/<domain>.ts` (e.g., `sessions.ts`, `resources.ts`)
- Group related tools in the same file
- Register tools in `./src/index.ts`

### Tool Structure Pattern

Every tool follows this pattern:

```typescript
server.tool(
  "nps_tool_name",
  "Human-readable description of what this tool does and when to use it",
  {
    // Zod schema for input parameters
    param1: z.string().describe("What this parameter is"),
    param2: z.string().optional().describe("Optional parameter"),
  },
  async ({ param1, param2 }) => {
    try {
      const client = await getAuthenticatedClient();
      const response = await client.get("/api/v1/Endpoint", { params });
      
      // Extract relevant fields — never return raw verbose API response
      const result = transformResponse(response);
      
      return {
        content: [{ type: "text", text: formatOutput(result) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${extractErrorMessage(error)}` }],
        isError: true,
      };
    }
  }
);
```

### Response Formatting Rules

- **Extract, don't dump.** NPS responses are deeply nested with related entities. Pull out the 5-10 most useful fields.
- **Format for readability.** Use structured text that Claude can reason about — not JSON blobs.
- **Include IDs.** Always include entity IDs so follow-up tools can reference them.
- **Include status.** For sessions, always include status code + statusDescription.
- **Include actionable info.** For sessions, include connection info or next steps.

### Naming Convention

- Tool names: `nps_<verb>_<noun>` (e.g., `nps_list_resources`, `nps_create_session`)
- Verbs: `list`, `get`, `create`, `update`, `delete`, `rotate`, `extend`, `end`
- Keep descriptions action-oriented: "List all managed resources with their platform type and status"

## Phase 3: Testing

### Test Against Lab

```bash
# Quick auth test
curl -k -X POST https://192.168.86.51:6500/signinBody \
  -H "Content-Type: application/json" \
  -d '{"Login":"admin","Password":"Temp123!"}'

# Version check (after getting token)
curl -k https://192.168.86.51:6500/api/v1/Version \
  -H "Authorization: Bearer <token>"
```

### MCP Inspector Test

```bash
# Run the server in dev mode
npx tsx src/index.ts

# Or test with MCP Inspector
npx @modelcontextprotocol/inspector npx tsx src/index.ts
```

### Validation Checklist

For each tool, verify:
- [ ] Tool registers without errors
- [ ] Input validation works (required params enforced, optional params handled)
- [ ] Successful API call returns formatted, human-readable output
- [ ] Failed API call returns meaningful error message
- [ ] Auth token is refreshed if expired
- [ ] Self-signed cert handling works
- [ ] Response doesn't include unnecessary nested data

## Phase 4: Iteration

After each tool is built and tested:

1. Update `./src/index.ts` to register the new tool
2. Update `./README.md` with the new tool's name and description
3. Commit with message: `feat: add nps_<tool_name> tool`
4. Check the tool priority list in PROJECT_INSTRUCTIONS.md for what to build next

## Key Patterns

### Authentication

```typescript
// Auth is handled centrally — never do auth in individual tools
import { getClient } from "../client";

// The client handles token acquisition, 2FA, refresh, and cert bypass
const client = await getClient();
```

### Session Status Codes

```
0 = Created (session is being set up)
1 = Started/Running (session is active, connections available)
2+ = Check statusDescription for end/error states
```

### Platform Detection for RDP vs SSH

```typescript
const WINDOWS_PLATFORM = "d07c4352-ea1a-44a2-8fe8-6f198ec1119f";
const AD_PLATFORM = "d6a07d9c-4b2e-4430-8c5b-401724dce933";

function isRdpPlatform(platformId: string): boolean {
  return platformId === WINDOWS_PLATFORM || platformId === AD_PLATFORM;
}
// All other platforms use SSH
```

### Error Extraction

NPS errors may come as HTTP status codes or as structured error objects. Always try to extract a human-readable message:

```typescript
function extractError(error: unknown): string {
  if (error instanceof Response) {
    // Try to parse error body
  }
  // Fall back to message or status code
}
```

## Memory

After each development session, write a brief summary to:
`~/.openclaw/memory/YYYY-MM-DD.md`

Include:
- Which tools were built/modified
- Any API quirks discovered
- Test results against the lab
- What to build next
