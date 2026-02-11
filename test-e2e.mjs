#!/usr/bin/env node
/**
 * End-to-end test: create session → poll → get connection (saved RDP) → verify → end session.
 * Also tests the improved nps_list_sessions filter.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readFileSync } from "node:fs";

const proc = spawn("node", ["dist/index.js"], { cwd: "/Users/adam/dev/NPS MCP Server", stdio: ["pipe", "pipe", "pipe"] });
let msgId = 0;
const pending = new Map();
const rl = createInterface({ input: proc.stdout });
rl.on("line", (line) => { try { const m = JSON.parse(line); if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {} });
proc.stderr.on("data", () => {});
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, resolve); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("Timeout")); } }, 60000); }); }
function callTool(name, args = {}) { return send("tools/call", { name, arguments: args }); }
function getText(r) { return r.result?.content?.[0]?.text || ""; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e-test", version: "1.0" } });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  // 1. Test improved list_sessions (should show no running sessions)
  console.log("=== Test: nps_list_sessions (default=running) ===");
  let r = await callTool("nps_list_sessions", {});
  console.log(getText(r).substring(0, 200));

  console.log("\n=== Test: nps_list_sessions (running_and_pending) ===");
  r = await callTool("nps_list_sessions", { status: "running_and_pending" });
  console.log(getText(r).substring(0, 200));

  // 2. Create session
  console.log("\n=== Creating session to FS1.adamsneed.com ===\n");
  r = await callTool("nps_create_session", {
    resourceName: "FS1.adamsneed.com",
    activityName: "Activity Token for adamsneed Domain Admin Access",
    note: "E2E test — RDP auto-save",
  });
  const createText = getText(r);
  if (r.result?.isError) {
    console.log("FAILED:", createText);
    proc.kill(); process.exit(1);
  }

  const sidMatch = createText.match(/Session: ([0-9a-f-]+)/);
  const sessionId = sidMatch?.[1];
  console.log(`Session created: ${sessionId}`);

  // 3. List sessions again — should now show the pending session
  console.log("\n=== nps_list_sessions (running_and_pending) — should show our new session ===");
  r = await callTool("nps_list_sessions", { status: "running_and_pending" });
  const listText = getText(r);
  const hasOurSession = listText.includes(sessionId);
  console.log(hasOurSession ? `PASS: Session ${sessionId.substring(0, 8)}... visible in list` : "FAIL: Session not in list");
  console.log(listText.split("\n").slice(0, 5).join("\n"));

  // 4. Poll for running
  console.log("\n=== Polling for session to start ===\n");
  let running = false;
  for (let i = 0; i < 12; i++) {
    await sleep(10000);
    r = await callTool("nps_session_status", { sessionId });
    const sText = getText(r);
    const statusLine = sText.split("\n").find(l => l.includes("Status:")) || "";
    console.log(`[${(i + 1) * 10}s] ${statusLine.trim()}`);

    if (sText.includes("Running")) { running = true; break; }
    if (sText.includes("Failed")) {
      console.log("\nSession FAILED:");
      console.log(sText.substring(0, 500));
      proc.kill(); process.exit(1);
    }
  }

  if (!running) {
    console.log("\nTimeout waiting for session. Ending...");
    await callTool("nps_end_session", { sessionId });
    proc.kill(); process.exit(1);
  }

  // 5. Get connection — should save RDP file
  console.log("\n=== Getting connection (RDP file save) ===\n");
  r = await callTool("nps_get_connection", { sessionId });
  const connText = getText(r);
  console.log(connText);

  // 6. Verify RDP file exists
  const pathMatch = connText.match(/saved to: (.+\.rdp)/);
  if (pathMatch) {
    const rdpPath = pathMatch[1];
    if (existsSync(rdpPath)) {
      const content = readFileSync(rdpPath, "utf-8");
      const hasProxy = content.includes("full address:s:");
      const hasSignature = content.includes("signature:s:");
      const hasPort = content.includes("server port:i:4489");
      console.log(`\nRDP file verification:`);
      console.log(`  File exists: YES`);
      console.log(`  Size: ${content.length} bytes`);
      console.log(`  Has proxy address: ${hasProxy ? "YES" : "NO"}`);
      console.log(`  Has signature: ${hasSignature ? "YES" : "NO"}`);
      console.log(`  Uses port 4489: ${hasPort ? "YES" : "NO"}`);
    } else {
      console.log(`FAIL: RDP file not found at ${rdpPath}`);
    }
  } else {
    console.log("FAIL: Could not parse RDP file path from output");
  }

  // 7. End session
  console.log("\n=== Ending session ===\n");
  r = await callTool("nps_end_session", { sessionId });
  console.log(getText(r));

  console.log("\n=== E2E Test Complete ===");
  proc.kill();
  process.exit(0);
}
run().catch(e => { console.error("Fatal:", e); proc.kill(); process.exit(1); });
