/**
 * Session Tools — create, monitor, connect, extend, end activity sessions
 *
 * Activity Sessions are the core unit of work in NPS. A session grants
 * temporary, just-in-time privileged access to a resource.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { npsApi, formatToolError } from "../client.js";
import { isRdpPlatform, platformName, sessionStatusLabel } from "../types.js";
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
  const status = `${sessionStatusLabel(s.status)} — ${s.statusDescription}`;
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
    "List activity sessions in NPS. Shows active, pending, and recent sessions with their status, resource, and activity.",
    {
      status: z
        .enum(["active", "all"])
        .optional()
        .default("active")
        .describe("Filter: 'active' for running sessions, 'all' for all recent"),
    },
    async ({ status }) => {
      try {
        // TODO: Verify exact endpoint — may be /api/v1/ActivitySession with query params
        const sessions = await npsApi<NpsActivitySession[]>(
          "/api/v1/ActivitySession"
        );

        let filtered = sessions;
        if (status === "active") {
          filtered = sessions.filter((s) => s.status <= 1);
        }

        if (filtered.length === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  status === "active"
                    ? "No active sessions. Use nps_create_session to start one."
                    : "No sessions found.",
              },
            ],
          };
        }

        const formatted = filtered.map(formatSession).join("\n---\n");
        return {
          content: [
            {
              type: "text",
              text: `${filtered.length} session(s):\n\n${formatted}`,
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
   * nps_create_session — Create a new activity session
   */
  server.tool(
    "nps_create_session",
    "Create a new activity session in NPS. This grants temporary, just-in-time privileged access to a resource. You need the resource name and activity name — use nps_list_resources and nps_list_policies to find these.",
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
   * nps_get_connection — Get RDP file or SSH URL for a running session
   */
  server.tool(
    "nps_get_connection",
    "Get the connection details for a running activity session. Returns an RDP file for Windows/AD resources or an SSH URL for Linux resources.",
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
                text: `Session is not running (status: ${session.statusDescription}). Cannot retrieve connection details.`,
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

        if (isRdpPlatform(platformId)) {
          const rdpContent = await npsApi<string>(
            `/api/v1/ActivitySession/Rdp/${sessionId}`
          );
          return {
            content: [
              {
                type: "text",
                text: `RDP Connection for ${session.managedResource?.name}:\n\nRDP File Contents:\n${rdpContent}\n\nSave this as a .rdp file and open it, or use the connection details above with your RDP client.`,
              },
            ],
          };
        } else {
          const sshUrl = await npsApi<string>(
            `/api/v1/ActivitySession/Ssh/${sessionId}`
          );
          return {
            content: [
              {
                type: "text",
                text: `SSH Connection for ${session.managedResource?.name}:\n\n${sshUrl}\n\nUse this URL with your SSH client.`,
              },
            ],
          };
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
        // TODO: Verify the exact endpoint for ending sessions
        // Likely DELETE /api/v1/ActivitySession/{id} or POST /api/v1/ActivitySession/{id}/End
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
