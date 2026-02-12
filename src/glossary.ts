/**
 * NPS Glossary — Terminology resource for MCP clients
 *
 * Provides correct NPS/PAM terminology so Claude (and other LLM clients)
 * use accurate language when generating reports, summaries, and explanations.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const GLOSSARY = `# NPS Terminology & Concepts

## Core Concepts

**Activity Session**
A time-bound, just-in-time privileged access session. The core unit of work in NPS. A user requests access to a resource, NPS provisions credentials (or an ephemeral account), and the session has a lifecycle: Created → Running → Completed/Failed. Sessions are recorded and audited.

**Activity / Activity Token / Ephemeral Account**
An "activity token" is an ephemeral (temporary) account that NPS creates at session start and removes at session end. This is the key Zero Standing Privilege mechanism — no persistent privileged account exists outside of an active session. The activity defines what NPS does before, during, and after the session (e.g., create a temp local admin, inject credentials, clean up on end).

**Managed Account (Actively Rotated)**
When we say an account is "managed," it means NPS is actively rotating its credentials on a schedule. Not all accounts in NPS are managed — NPS discovers accounts by scanning resources (Active Directory accounts, local accounts on Windows/Linux hosts), but only accounts explicitly enrolled in rotation are "managed." An account simply appearing in the NPS inventory does not mean it is managed.

**Discovered Accounts vs. Managed Accounts**
NPS scans resources and discovers existing accounts — these are AD domain accounts, local accounts on Windows/Linux hosts, etc. These discovered accounts appear in the NPS inventory but are NOT managed unless explicitly enrolled for credential rotation. The distinction matters: discovered = NPS knows about it; managed = NPS actively rotates its password.

**Managed Resource**
A server, endpoint, Entra ID tenant, database, or secret vault that NPS manages access to. Resources are onboarded into NPS and associated with a platform type (Windows, Linux, Active Directory, etc.). NPS uses a service account to reach into each resource.

**Access Control Policy**
Binds users + resources + activities together. A user must be included in a policy to create a session against a resource. Policies define who can access what, using which activity, and under what conditions (approval, time limits, etc.).

**Connection Profile (ActivityConfiguration)**
Session parameters: max duration, session recording, approval workflows, extension rules, proxy settings. Defines the operational constraints of a session.

**Credential**
A username/password pair associated with a resource. Credentials can be rotated (managed) or simply stored. Key states: Verified (rotation succeeded), Failed (rotation failed), Stale (overdue for rotation), Unspecified (not yet checked).

**Service Account**
An account NPS uses to authenticate to target resources — for example, an AD domain account that can SSH into Linux hosts or manage local accounts on Windows. Service accounts are not end-user accounts; they're NPS infrastructure.

**Platform**
Defines a resource type. Each platform has a fixed GUID:
- Windows: RDP-based access, local account management
- Active Directory: Domain-level operations
- Linux/Unix: SSH-based access
- Others: Entra ID, MSSQL, Cisco, Secret Vaults

## Session Lifecycle

1. **Created** — Session request submitted, NPS provisioning credentials/ephemeral account
2. **Running** — Session active, user connected (or can connect). Ephemeral account exists.
3. **Completed** — Session ended normally. Ephemeral account removed, cleanup done.
4. **Failed** — Something went wrong (connectivity, service account can't authenticate, etc.)

## Key Distinctions

- "Activity token" and "ephemeral account" are the SAME thing — a temporary account created for the duration of a session
- "Managed" specifically means credential rotation is active — don't use "managed" for accounts that are merely discovered/inventoried
- NPS is a Zero Standing Privilege (ZSP) solution — the goal is that no persistent privileged accounts exist; all access is temporary and just-in-time
- Sessions go through NPS as a proxy — users never connect directly to resources. This enables recording, credential injection, and audit.
`;

export function registerGlossary(server: McpServer): void {
  server.resource(
    "nps-glossary",
    "nps://glossary",
    {
      description:
        "NPS terminology and concepts reference. Read this before generating reports or summaries about NPS to ensure correct terminology (e.g., ephemeral accounts, managed vs. discovered accounts, activity tokens).",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: "text/markdown",
          text: GLOSSARY,
        },
      ],
    })
  );
}
