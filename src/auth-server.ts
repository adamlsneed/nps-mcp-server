/**
 * Local HTTP callback server for browser-based NPS login.
 *
 * Flow:
 *   1. Server starts on localhost with a random port
 *   2. User visits the landing page, which links to the NPS login page
 *   3. After logging in, user clicks a bookmarklet that POSTs the token back
 *   4. Server receives the token, validates it, and resolves the promise
 *   5. Server auto-shuts down after token received or 5-minute timeout
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { parse as parseUrl } from "node:url";

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface AuthServerResult {
  port: number;
  tokenPromise: Promise<string>;
  close: () => void;
}

/**
 * Generate the landing page HTML with NPS login link and bookmarklet.
 */
function landingPageHtml(npsUrl: string, port: number): string {
  // Bookmarklet: reads sessionStorage.Token and form-POSTs it to our callback
  const bookmarkletCode = `javascript:void(function(){var t=sessionStorage.getItem('Token');if(!t){alert('No NPS token found in sessionStorage. Make sure you are on the NPS dashboard after logging in.');return;}var f=document.createElement('form');f.method='POST';f.action='http://localhost:${port}/callback';var i=document.createElement('input');i.type='hidden';i.name='token';i.value=t;f.appendChild(i);document.body.appendChild(f);f.submit()})()`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NPS Login — Claude MCP</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1e293b; border-radius: 12px; padding: 2.5rem; max-width: 560px; width: 90%; box-shadow: 0 4px 24px rgba(0,0,0,0.4); }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #f8fafc; }
    .subtitle { color: #94a3b8; margin-bottom: 2rem; font-size: 0.9rem; }
    .steps { list-style: none; counter-reset: step; }
    .steps li { counter-increment: step; padding: 0.75rem 0; padding-left: 2.5rem; position: relative; border-bottom: 1px solid #334155; }
    .steps li:last-child { border-bottom: none; }
    .steps li::before { content: counter(step); position: absolute; left: 0; top: 0.75rem; width: 1.75rem; height: 1.75rem; background: #3b82f6; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; font-weight: 600; }
    a.btn { display: inline-block; background: #3b82f6; color: white; padding: 0.6rem 1.2rem; border-radius: 6px; text-decoration: none; font-weight: 500; margin-top: 0.25rem; }
    a.btn:hover { background: #2563eb; }
    a.bookmarklet { display: inline-block; background: #f59e0b; color: #1e293b; padding: 0.5rem 1rem; border-radius: 6px; text-decoration: none; font-weight: 600; cursor: grab; margin-top: 0.25rem; }
    a.bookmarklet:hover { background: #d97706; }
    .hint { color: #94a3b8; font-size: 0.8rem; margin-top: 0.5rem; }
    .alt { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #334155; }
    .alt h3 { font-size: 0.95rem; color: #94a3b8; margin-bottom: 0.5rem; }
    code { background: #0f172a; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.85rem; color: #7dd3fc; }
  </style>
</head>
<body>
  <div class="card">
    <h1>NPS Login for Claude</h1>
    <p class="subtitle">Log in to Netwrix Privilege Secure using any authentication method, then send the token back to Claude.</p>
    <ol class="steps">
      <li>
        <strong>Drag this bookmarklet to your bookmarks bar:</strong><br>
        <a class="bookmarklet" href="${bookmarkletCode}">Send Token to Claude</a>
        <p class="hint">Or right-click → "Bookmark this link"</p>
      </li>
      <li>
        <strong>Open NPS and log in:</strong><br>
        <a class="btn" href="${npsUrl}" target="_blank" rel="noopener">Open NPS Login &rarr;</a>
      </li>
      <li>
        <strong>After you reach the NPS dashboard, click the bookmarklet.</strong><br>
        <p class="hint">The bookmarklet reads your login token and sends it back here securely.</p>
      </li>
    </ol>
    <div class="alt">
      <h3>Alternative: paste token manually</h3>
      <p style="font-size: 0.85rem; color: #94a3b8;">
        In NPS, open DevTools (F12) → Console → type <code>sessionStorage.getItem('Token')</code><br>
        Copy the result and use the <code>nps_set_token</code> tool in Claude.
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generate the success page HTML shown after token is received.
 */
function successPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Login Complete</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1e293b; border-radius: 12px; padding: 2.5rem; max-width: 440px; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.4); }
    .check { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.3rem; margin-bottom: 0.5rem; color: #4ade80; }
    p { color: #94a3b8; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">&#10003;</div>
    <h1>Token received!</h1>
    <p>Claude is now authenticated with NPS. You can close this tab and return to Claude.</p>
  </div>
</body>
</html>`;
}

/**
 * Parse URL-encoded form body from POST request.
 */
function parseFormBody(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      const params: Record<string, string> = {};
      for (const pair of body.split("&")) {
        const [key, ...rest] = pair.split("=");
        if (key) {
          params[decodeURIComponent(key)] = decodeURIComponent(rest.join("="));
        }
      }
      resolve(params);
    });
    req.on("error", reject);
  });
}

/**
 * Start a local HTTP server that serves the login landing page
 * and waits for a token callback from the bookmarklet.
 *
 * @param npsUrl - The NPS server URL (for the login link)
 * @returns port, a promise that resolves with the token, and a close function
 */
export async function startAuthServer(npsUrl: string): Promise<AuthServerResult> {
  let tokenReceived = false;
  let resolveToken: (token: string) => void;
  let rejectToken: (err: Error) => void;

  const tokenPromise = new Promise<string>((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const parsed = parseUrl(req.url || "/", true);

    if (req.method === "GET" && parsed.pathname === "/") {
      // Serve landing page
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const html = landingPageHtml(npsUrl, port);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/callback") {
      try {
        const form = await parseFormBody(req);
        const token = form.token;

        if (!token) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Missing token in form body");
          return;
        }

        tokenReceived = true;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(successPageHtml());
        resolveToken(token);

        // Auto-close after a short delay to let the response finish
        setTimeout(() => closeServer(), 500);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Error processing callback");
      }
      return;
    }

    if (req.method === "GET" && parsed.pathname === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ received: tokenReceived }));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  // Bind to random available port on localhost only and wait until ready
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : 0;
      resolve(p);
    });
    server.on("error", reject);
  });

  const timeout = setTimeout(() => {
    if (!tokenReceived) {
      rejectToken(new Error("Login timed out after 5 minutes. Run nps_login again to retry."));
      closeServer();
    }
  }, TIMEOUT_MS);

  function closeServer() {
    clearTimeout(timeout);
    server.close();
  }

  return {
    port,
    tokenPromise,
    close: closeServer,
  };
}
