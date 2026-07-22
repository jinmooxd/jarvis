// Optional link to a second jarvis instance ("the cloud", e.g. the droplet).
// When configured, this server proxies /api/cloud/* and /ws/cloud/sessions/*
// to it, so one UI can drive sessions on both machines. The remote side needs
// no configuration — it's just a normal jarvis reached over the tailnet.
//
// Configure with the CLOUD_URL env var, or persistently in
// server/data/config.json:  { "cloudUrl": "https://jarvis-box.<tailnet>.ts.net" }
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocket, type RawData } from "ws";
import type { Request, Response } from "express";
import { DATA_DIR } from "./config.js";

function readConfiguredUrl(): string {
  const raw =
    process.env.CLOUD_URL ??
    (() => {
      try {
        const cfg = JSON.parse(readFileSync(join(DATA_DIR, "config.json"), "utf8"));
        return typeof cfg.cloudUrl === "string" ? cfg.cloudUrl : "";
      } catch {
        return "";
      }
    })();
  return raw.trim().replace(/\/+$/, "");
}

export const CLOUD_URL = readConfiguredUrl();

export type CloudStatus = {
  configured: boolean;
  url?: string;
  connected: boolean;
  error?: string;
  checkedAt?: number;
};

let connected = false;
let lastError: string | undefined;
let checkedAt = 0;

export function getCloudStatus(): CloudStatus {
  if (!CLOUD_URL) return { configured: false, connected: false };
  return { configured: true, url: CLOUD_URL, connected, error: lastError, checkedAt };
}

// Any HTTP response counts as connected — reaching the server at all is what
// matters (an older build over there answers 404 to /api/health).
export async function checkCloud(): Promise<CloudStatus> {
  if (!CLOUD_URL) return getCloudStatus();
  try {
    await fetch(`${CLOUD_URL}/api/health`, { signal: AbortSignal.timeout(4000) });
    connected = true;
    lastError = undefined;
  } catch (err) {
    connected = false;
    lastError = err instanceof Error ? err.message : String(err);
  }
  checkedAt = Date.now();
  return getCloudStatus();
}

function markCloudDown(err: unknown) {
  connected = false;
  lastError = err instanceof Error ? err.message : String(err);
  checkedAt = Date.now();
}

if (CLOUD_URL) {
  void checkCloud();
  setInterval(() => void checkCloud(), 15_000).unref();
}

// REST proxy: /api/cloud/<rest>?<query>  →  <CLOUD_URL>/api/<rest>?<query>
export async function proxyCloudRequest(req: Request, res: Response) {
  if (!CLOUD_URL) return res.status(503).json({ error: "cloud not configured" });
  const rest = req.originalUrl.slice("/api/cloud".length);
  try {
    const upstream = await fetch(`${CLOUD_URL}/api${rest}`, {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(30_000),
    });
    connected = true;
    checkedAt = Date.now();
    const text = await upstream.text();
    res
      .status(upstream.status)
      .type(upstream.headers.get("content-type") ?? "application/json")
      .send(text);
  } catch (err) {
    markCloudDown(err);
    res.status(502).json({ error: `cloud unreachable: ${err instanceof Error ? err.message : String(err)}` });
  }
}

// WS bridge: browser ⇄ this server ⇄ cloud jarvis. Frames pass through
// untouched in both directions (text JSON control frames, binary terminal
// bytes). Closing either side closes the other, which is also what detaches
// the tmux viewer on the cloud side.
export function handleCloudSessionSocket(client: WebSocket, claudeSessionId: string) {
  if (!CLOUD_URL) {
    client.send(JSON.stringify({ type: "error", message: "cloud not configured" }));
    client.close();
    return;
  }
  const upstream = new WebSocket(`${CLOUD_URL.replace(/^http/, "ws")}/ws/sessions/${claudeSessionId}`);
  // The browser's init frame usually arrives before the upstream socket opens.
  const pending: { data: RawData; binary: boolean }[] = [];

  upstream.on("open", () => {
    connected = true;
    checkedAt = Date.now();
    for (const m of pending) upstream.send(m.data, { binary: m.binary });
    pending.length = 0;
  });
  upstream.on("message", (data, isBinary) => {
    if (client.readyState === client.OPEN) client.send(data, { binary: isBinary });
  });
  upstream.on("close", () => client.close());
  upstream.on("error", (err) => {
    markCloudDown(err);
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify({ type: "error", message: `cloud unreachable: ${err.message}` }));
      client.close();
    }
  });

  client.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    else if (upstream.readyState === WebSocket.CONNECTING) pending.push({ data, binary: isBinary });
  });
  client.on("close", () => upstream.terminate());
}
