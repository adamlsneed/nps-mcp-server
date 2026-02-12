/**
 * Session Tools — create, monitor, connect, extend, end activity sessions
 *
 * Activity Sessions are the core unit of work in NPS. A session grants
 * temporary, just-in-time privileged access to a resource.
 */

import { z } from "zod";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { npsApi, formatToolError } from "../client.js";
import { isRdpPlatform, platformName, sessionStatusLabel } from "../types.js";
import { openWithDefault, openInTerminal } from "../utils.js";
import type { ActionLogCollection } from "../types.js";

// Subset of the (very verbose) ActivitySession response
interface NpsActivitySession {
  id: string;
  status: number;
  statusDescription: string;
  createdByUserName?: string;
  createdDateTimeUtc?: string;
  loginAccountName?: string;
  activityId?: string;
  activity?: { name?: string; activityType?: number };
  managedResourceId?: string;
  managedResource?: {
    name?: string;
    displayName?: string;
    platformId: string;
    ipAddress?: string;
  };
  accessControlPolicy?: { name?: string };
  scheduledStartDateTimeUtc?: string;
  scheduledEndDateTimeUtc?: string;
  actualStartDateTimeUtc?: string;
  actualEndDateTimeUtc?: string;
  note?: string;
  ticket?: string;
  proxySessions?: unknown[];
}

function formatSession(s: NpsActivitySession): string {
  const resource = s.managedResource?.displayName || s.managedResource?.name || "Unknown";
  const activity = s.activity?.name || "Unknown";
  const policy = s.accessControlPolicy?.name || "";
  const statusDesc = s.statusDescription || sessionStatusLabel(s.status);
  const status = statusDesc;
  const platform = s.managedResource?.platformId
    ? platformName(s.managedResource.platformId)
    : "";
  const connType = s.managedResource?.platformId
    ? isRdpPlatform(s.managedResource.platformId)
      ? "RDP"
      : "SSH"
    : "";

  let text = `Session: ${s.id}\n`;
  text += `  Status: ${status}\n`;
  text += `  Resource: ${resource} [${platform}] (${connType})\n`;
  text += `  Activity: ${activity}\n`;
  if (policy) text += `  Policy: ${policy}\n`;
  if (s.loginAccountName) text += `  Login Account: ${s.loginAccountName}\n`;
  if (s.createdByUserName) text += `  Created By: ${s.createdByUserName}\n`;
  if (s.scheduledStartDateTimeUtc)
    text += `  Scheduled: ${s.scheduledStartDateTimeUtc} → ${s.scheduledEndDateTimeUtc || "?"}\n`;
  if (s.note) text += `  Note: ${s.note}\n`;
  if (s.ticket) text += `  Ticket: ${s.ticket}\n`;
  return text;
}

export function registerSessionTools(server: McpServer): void {
  /**
   * nps_list_sessions — List active and recent sessions
   */
  server.tool(
    "nps_list_sessions",
    "List activity sessions in NPS. By default shows only Running sessions. Use 'running_and_pending' to include recently created sessions (last hour), or 'all' for everything (can be large).",
    {
      status: z
        .enum(["running", "running_and_pending", "all"])
        .optional()
        .default("running")
        .describe("Filter: 'running' (default), 'running_and_pending' (includes Created in last hour), 'all' (everything)"),
    },
    async ({ status }) => {
      try {
        const sessions = await npsApi<NpsActivitySession[]>(
          "/api/v1/ActivitySession"
        );

        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        let filtered: NpsActivitySession[];

        if (status === "all") {
          filtered = sessions;
        } else if (status === "running_and_pending") {
          filtered = sessions.filter((s) => {
            if (s.status === 1) return true; // Running
            if (s.status === 0) {
              // Only include Created sessions from the last hour
              const created = s.createdDateTimeUtc ? new Date(s.createdDateTimeUtc).getTime() : 0;
              return created > oneHourAgo;
            }
            return false;
          });
        } else {
          // Default: running only
          filtered = sessions.filter((s) => s.status === 1);
        }

        if (filtered.length === 0) {
          const msg = status === "running"
            ? "No running sessions. Use nps_create_session to start one, or 'running_and_pending' to include recently created sessions."
            : status === "running_and_pending"
              ? "No running or recently pending sessions."
              : "No sessions found.";
          return { content: [{ type: "text", text: msg }] };
        }

        // Group by status for summary
        const running = filtered.filter((s) => s.status === 1);
        const pending = filtered.filter((s) => s.status === 0);

        let text = "";
        if (running.length > 0) {
          text += `${running.length} running session(s):\n\n`;
          text += running.map(formatSession).join("\n---\n");
        }
        if (pending.length > 0) {
          if (text) text += "\n\n";
          const pendingLabel = status === "running_and_pending"
            ? `${pending.length} pending session(s) (created in last hour):`
            : `${pending.length} pending/created session(s):`;
          text += `${pendingLabel}\n\n`;
          text += pending.map(formatSession).join("\n---\n");
        }
        if (status === "all" && filtered.length > running.length + pending.length) {
          const other = filtered.filter((s) => s.status > 1);
          if (text) text += "\n\n";
          text += `${other.length} other session(s) (completed/failed/etc.):\n\n`;
          text += other.slice(0, 10).map(formatSession).join("\n---\n");
          if (other.length > 10) {
            text += `\n... and ${other.length - 10} more. Use nps_search_sessions for full history.`;
          }
        }

        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );

  /**
   * nps_create_session — Create a new activity session
   */
  server.tool(
    "nps_create_session",
    "Create a new activity session in NPS. This grants temporary, just-in-time privileged access to a resource. You need the resource name (DNS hostname) and activity name. Use nps_resource_access to find valid activities for a resource.",
    {
      resourceName: z
        .string()
        .describe("Name or IP of the managed resource to access"),
      activityName: z
        .string()
        .describe("Name of the activity to perform (e.g., 'Connect as Managed')"),
      note: z.string().optional().describe("Optional note for the session"),
      ticket: z.string().optional().describe("Optional ticket number"),
    },
    async ({ resourceName, activityName, note, ticket }) => {
      try {
        const payload: Record<string, string> = {
          ManagedResourceName: resourceName,
          ActivityName: activityName,
        };
        if (note) payload.Note = note;
        if (ticket) payload.Ticket = ticket;

        const session = await npsApi<NpsActivitySession>(
          "/api/v1/ActivitySession",
          { method: "POST", body: payload }
        );

        const connType = session.managedResource?.platformId
          ? isRdpPlatform(session.managedResource.platformId)
            ? "RDP"
            : "SSH"
          : "unknown";

        let text = `Session created successfully!\n\n${formatSession(session)}`;
        text += `\nConnection type: ${connType}`;
        text += `\n\nThe session is provisioning. Use nps_session_status with ID "${session.id}" to check when it's ready.`;
        text += `\nOnce running, use nps_get_connection to get the ${connType} connection details.`;

        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );

  /**
   * nps_session_status — Check session status and get logs if failed
   */
  server.tool(
    "nps_session_status",
    "Check the status of an activity session. If the session failed, this also retrieves the session logs to help diagnose the issue.",
    {
      sessionId: z.string().describe("The activity session ID (GUID)"),
    },
    async ({ sessionId }) => {
      try {
        const session = await npsApi<NpsActivitySession>(
          `/api/v1/ActivitySession/${sessionId}`
        );

        let text = formatSession(session);

        // If session ended (completed/failed), fetch recent logs
        if (session.status > 1) {
          try {
            const logData = await npsApi<ActionLogCollection>(
              `/api/v1/ActivitySession/${sessionId}/Log`,
              { params: { skip: 0, take: 10 } }
            );
            const lines = logData?.lines ?? [];
            const totalCount = logData?.totalCount ?? lines.length;
            if (lines.length > 0) {
              text += `\nRecent Logs (last ${lines.length} of ${totalCount}):\n`;
              for (const line of lines) {
                const ts = line.timestamp ? line.timestamp.replace("T", " ").substring(0, 19) : "";
                const status = line.statusString ?? "";
                const msg = line.logMessage ?? "";
                text += `  [${ts}] [${status}] ${msg}\n`;
              }
              if (totalCount > lines.length) {
                text += `  ... Use nps_session_logs for full history (${totalCount} total entries)\n`;
              }
            }
          } catch {
            text += `\n(Could not retrieve session logs)`;
          }
        }

        if (session.status === 0) {
          text += `\nSession is still provisioning. Check again in 10-15 seconds.`;
        } else if (session.status === 1) {
          text += `\nSession is running! Use nps_get_connection to connect.`;
        }

        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );

  /**
   * nps_get_connection — Get and launch RDP/SSH connection for a running session
   */
  server.tool(
    "nps_get_connection",
    "Get and launch a connection for a running session. For Windows/AD resources, fetches a tokenized RDP file and immediately opens it (the token expires in ~60 seconds so auto-launch is required). For Linux/SSH resources, opens a terminal with the SSH command. The connection is proxied through NPS for recording and credential injection.",
    {
      sessionId: z.string().describe("The activity session ID (GUID)"),
    },
    async ({ sessionId }) => {
      try {
        // First get the session to determine platform
        const session = await npsApi<NpsActivitySession>(
          `/api/v1/ActivitySession/${sessionId}`
        );

        if (session.status !== 1) {
          return {
            content: [
              {
                type: "text",
                text: `Session is not running (status: ${session.statusDescription || sessionStatusLabel(session.status)}). Cannot retrieve connection details.`,
              },
            ],
          };
        }

        const platformId = session.managedResource?.platformId;
        if (!platformId) {
          return {
            content: [
              {
                type: "text",
                text: "Could not determine resource platform. Cannot fetch connection info.",
              },
            ],
          };
        }

        const resourceName = session.managedResource?.displayName || session.managedResource?.name || "unknown";
        const shortId = sessionId.substring(0, 8);

        if (isRdpPlatform(platformId)) {
          const rdpContent = await npsApi<string>(
            `/api/v1/ActivitySession/Rdp/${sessionId}`
          );

          // Save RDP file to temp directory
          const filename = `nps-${resourceName.replace(/[^a-zA-Z0-9._-]/g, "_")}-${shortId}.rdp`;
          const rdpPath = join(tmpdir(), filename);
          writeFileSync(rdpPath, rdpContent, "utf-8");

          // Parse key fields from the RDP content for display
          const fullAddr = rdpContent.match(/full address:s:(.+)/)?.[1] || "?";
          const port = rdpContent.match(/server port:i:(\d+)/)?.[1] || "?";

          // Immediately launch the RDP file — the token expires in ~60 seconds
          const launched = openWithDefault(rdpPath);

          let text = `RDP Connection for ${resourceName}\n\n`;
          text += `Session ID: ${sessionId}\n`;
          text += `Proxy: ${fullAddr}:${port} (NPS gateway)\n`;
          text += `Connection is proxied through NPS for recording and credential injection.\n\n`;

          if (launched) {
            text += `RDP connection launched automatically. Microsoft Remote Desktop should be opening now.`;
          } else {
            text += `RDP file saved to: ${rdpPath}\n`;
            text += `Auto-launch failed — open the file manually ASAP (token expires in ~60 seconds):\n`;
            text += `  open "${rdpPath}"`;
          }

          return { content: [{ type: "text", text }] };
        } else {
          const sshUrl = await npsApi<string>(
            `/api/v1/ActivitySession/Ssh/${sessionId}`
          );

          // Parse ssh:// URL into a usable command
          const sshMatch = sshUrl.match(/ssh:\/\/([^@]+)@([^:]+):?(\d+)?/);
          let sshCommand = "";
          if (sshMatch) {
            const [, user, host, sshPort] = sshMatch;
            const portFlag = sshPort && sshPort !== "22" ? ` -p ${sshPort}` : "";
            sshCommand = `ssh ${user}@${host}${portFlag}`;
          }

          // Try to launch a terminal with the SSH command
          let launched = false;
          if (sshCommand) {
            const scriptPath = join(tmpdir(), `nps-ssh-${shortId}.sh`);
            writeFileSync(scriptPath, `#!/bin/bash\n${sshCommand}\n`, { mode: 0o755 });
            launched = openInTerminal(scriptPath);
          }

          let text = `SSH Connection for ${resourceName}\n\n`;
          text += `Session ID: ${sessionId}\n`;
          text += `Connection is proxied through NPS for recording and credential injection.\n\n`;

          if (launched) {
            text += `SSH terminal launched automatically.\n`;
            text += `Command: ${sshCommand}`;
          } else if (sshCommand) {
            text += `SSH command: ${sshCommand}\n`;
            text += `(Could not auto-launch terminal — run the command above manually)`;
          } else {
            text += `SSH URL: ${sshUrl}\n`;
            text += `(Could not parse SSH URL into a command)`;
          }

          return { content: [{ type: "text", text }] };
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );

  /**
   * nps_end_session — End or cancel an activity session
   */
  server.tool(
    "nps_end_session",
    "End or cancel an active activity session. This triggers the session's end actions (cleanup, remove from groups, etc.).",
    {
      sessionId: z.string().describe("The activity session ID (GUID) to end"),
    },
    async ({ sessionId }) => {
      try {
        await npsApi(`/api/v1/ActivitySession/${sessionId}`, {
          method: "DELETE",
        });

        return {
          content: [
            {
              type: "text",
              text: `Session ${sessionId} has been ended. End actions (cleanup, group removal, etc.) are now executing.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );

  /**
   * nps_extend_session — Extend a running session
   */
  server.tool(
    "nps_extend_session",
    "Extend a running activity session. Adds additional time to prevent the session from ending at the scheduled time. The session must be running and the policy must allow extensions.",
    {
      sessionId: z.string().describe("The activity session ID (GUID) to extend"),
      minutes: z
        .number()
        .optional()
        .describe("Number of minutes to extend by (uses policy default if not specified)"),
    },
    async ({ sessionId, minutes }) => {
      try {
        const body: Record<string, unknown> = {};
        if (minutes !== undefined) {
          body.extensionMinutes = minutes;
        }

        const session = await npsApi<NpsActivitySession>(
          `/api/v1/ActivitySession/${sessionId}/Extend`,
          { method: "POST", body: Object.keys(body).length > 0 ? body : undefined }
        );

        let text = `Session extended successfully!\n\n${formatSession(session)}`;
        if (session.scheduledEndDateTimeUtc) {
          text += `\nNew end time: ${session.scheduledEndDateTimeUtc}`;
        }

        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );

  /**
   * nps_session_logs — Get detailed logs for a session
   */
  server.tool(
    "nps_session_logs",
    "Get detailed action queue logs for an activity session. Supports pagination and filtering. Useful for troubleshooting failed or problematic sessions.",
    {
      sessionId: z.string().describe("The activity session ID (GUID)"),
      skip: z.number().optional().default(0).describe("Number of log entries to skip (default: 0)"),
      take: z.number().optional().default(100).describe("Number of log entries to return (default: 100)"),
      logLevel: z.string().optional().describe("Filter by log level (e.g., 'Error', 'Warning')"),
      filterText: z.string().optional().describe("Filter log messages by text"),
    },
    async ({ sessionId, skip, take, logLevel, filterText }) => {
      try {
        const params: Record<string, string | number | boolean | undefined> = {
          skip,
          take,
        };
        if (logLevel) params.logLevel = logLevel;
        if (filterText) params.filterText = filterText;

        const logData = await npsApi<ActionLogCollection>(
          `/api/v1/ActivitySession/${sessionId}/Log`,
          { params }
        );

        const lines = logData?.lines ?? [];
        const totalCount = logData?.totalCount ?? lines.length;

        if (lines.length === 0) {
          return {
            content: [
              { type: "text", text: `No logs found for session ${sessionId}.` },
            ],
          };
        }

        let text = `Session logs for ${sessionId} (${lines.length} of ${totalCount} entries`;
        if (skip > 0) text += `, skipped ${skip}`;
        text += `):\n\n`;

        for (const line of lines) {
          const ts = line.timestamp ? line.timestamp.replace("T", " ").substring(0, 19) : "";
          const status = line.statusString ?? "";
          const msg = line.logMessage ?? "";
          text += `[${ts}] [${status}] ${msg}\n`;
        }

        if (skip + lines.length < totalCount) {
          text += `\n... ${totalCount - skip - lines.length} more entries. Use skip=${skip + take} to continue.`;
        }

        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatToolError(error) }],
          isError: true,
        };
      }
    }
  );
}
