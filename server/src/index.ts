import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { URL } from "node:url";
import cors from "cors";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import type { IPty } from "node-pty";
import { listKnownRepos, listModelOptions } from "./claudeConfig.js";
import { listWorktrees } from "./worktrees.js";
import { listAllSessions, getSessionDetails } from "./sessions.js";
import { createSession, ensureLive, attachSession, killSession } from "./runner.js";
import { getRecord, putRecord, markClosed } from "./store.js";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { getUsageState, onUsageUpdate } from "./usage.js";
import { PORT, HOST, WEB_DIST } from "./config.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/repos", async (_req, res) => {
  res.json(await listKnownRepos());
});

app.get("/api/models", async (_req, res) => {
  res.json(await listModelOptions());
});

app.get("/api/worktrees", async (req, res) => {
  const repo = String(req.query.repo ?? "");
  if (!repo) return res.status(400).json({ error: "repo query param required" });
  res.json(await listWorktrees(repo));
});

app.get("/api/sessions", async (_req, res) => {
  res.json(await listAllSessions());
});

app.post("/api/sessions", async (req, res) => {
  const { name, repoPath, model, worktree, oneMillionContext } = req.body ?? {};
  if (!name || !repoPath || !model) {
    return res.status(400).json({ error: "name, repoPath, model are required" });
  }
  try {
    const { claudeSessionId } = await createSession({ name, repoPath, model, worktree, oneMillionContext });
    res.json({ claudeSessionId });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Stop: kill the tmux session but keep tracking it (shows as cold).
app.delete("/api/sessions/:id", async (req, res) => {
  await killSession(req.params.id);
  res.json({ ok: true });
});

app.get("/api/sessions/:id/details", async (req, res) => {
  try {
    res.json(await getSessionDetails(req.params.id));
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.patch("/api/sessions/:id", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name is required" });
  const id = req.params.id;
  const record = await getRecord(id);
  if (record) {
    await putRecord({ ...record, name });
  } else {
    // session created outside jarvis — start tracking it so the name sticks
    const sdk = (await listSessions()).find((s) => s.sessionId === id);
    if (!sdk) return res.status(404).json({ error: "unknown session" });
    await putRecord({
      claudeSessionId: id,
      name,
      repoPath: sdk.cwd ?? "",
      model: "",
      createdAt: sdk.createdAt ?? Date.now(),
    });
  }
  res.json({ ok: true });
});

// Close: stop it and hide it from the list. /resume-ing it later (which
// touches its transcript) automatically brings it back.
app.post("/api/sessions/:id/close", async (req, res) => {
  await killSession(req.params.id);
  await markClosed(req.params.id);
  res.json({ ok: true });
});

app.get("/api/usage", (_req, res) => {
  res.json(getUsageState());
});

// Production: serve the built web app so a single port covers phone + laptop.
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^\/(?!api\/|ws\/).*/, (_req, res) => res.sendFile(join(WEB_DIST, "index.html")));
}

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", "http://localhost");
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (url.pathname === "/ws/usage") {
      handleUsageSocket(ws);
    } else if (url.pathname.startsWith("/ws/sessions/")) {
      const id = url.pathname.slice("/ws/sessions/".length);
      handleSessionSocket(ws, id);
    } else {
      ws.close();
    }
  });
});

function handleUsageSocket(ws: WebSocket) {
  ws.send(JSON.stringify({ kind: "usage", state: getUsageState() }));
  const unsubscribe = onUsageUpdate((state) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ kind: "usage", state }));
  });
  ws.on("close", unsubscribe);
}

// Protocol: client sends JSON text frames — {type:"init",cols,rows} to attach,
// then {type:"input",data} keystrokes and {type:"resize",cols,rows}. Server
// sends raw terminal bytes as binary frames; JSON text frames only for
// lifecycle ({type:"exit"} / {type:"error"}).
function handleSessionSocket(ws: WebSocket, claudeSessionId: string) {
  let term: IPty | undefined;

  ws.on("message", async (raw, isBinary) => {
    if (isBinary) return;
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    try {
      if (msg.type === "init" && !term) {
        await ensureLive(claudeSessionId);
        const t = attachSession(claudeSessionId, msg.cols || 80, msg.rows || 24);
        term = t;
        t.onData((data) => {
          if (ws.readyState === ws.OPEN) ws.send(Buffer.from(data, "utf8"));
        });
        t.onExit(() => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "exit" }));
            ws.close();
          }
        });
      } else if (msg.type === "input" && term && typeof msg.data === "string") {
        term.write(msg.data);
      } else if (msg.type === "resize" && term) {
        term.resize(Math.max(2, msg.cols | 0), Math.max(2, msg.rows | 0));
      }
    } catch (err) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "error", message: err instanceof Error ? err.message : String(err) }));
      }
    }
  });

  // Detaches this viewer's tmux client; the claude session keeps running.
  ws.on("close", () => term?.kill());
}

server.listen(PORT, HOST, () => {
  console.log(`jarvis server listening on http://${HOST}:${PORT}`);
});
