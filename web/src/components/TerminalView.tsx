import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import "@xterm/xterm/css/xterm.css";
import { sessionSocketUrl } from "../api";
import type { ContextInfo, SessionOrigin, SessionStatus } from "../types";
import ContextBadge from "./ContextBadge";

type ConnState = "connecting" | "open" | "exited" | "disconnected";

const isTouchDevice = () => window.matchMedia("(pointer: coarse)").matches;

// Escape sequences for keys a phone keyboard doesn't have. ⇧Tab is what the
// claude CLI uses to cycle permission modes.
const MOBILE_KEYS: { label: string; seq: string }[] = [
  { label: "esc", seq: "\x1b" },
  { label: "tab", seq: "\t" },
  { label: "⇧tab", seq: "\x1b[Z" },
  { label: "^C", seq: "\x03" },
  { label: "↑", seq: "\x1b[A" },
  { label: "↓", seq: "\x1b[B" },
  { label: "←", seq: "\x1b[D" },
  { label: "→", seq: "\x1b[C" },
];

export default function TerminalView({
  sessionId,
  origin = "local",
  name,
  status,
  context,
  onBack,
}: {
  sessionId: string;
  origin?: SessionOrigin;
  name: string;
  status: SessionStatus;
  context: ContextInfo | undefined;
  onBack: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [attempt, setAttempt] = useState(0);
  const touch = isTouchDevice();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setConn("connecting");
    const term = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      cursorBlink: true,
      fontSize: touch ? 12 : 13,
      fontFamily: "Menlo, Monaco, 'SF Mono', 'DejaVu Sans Mono', monospace",
      scrollback: 2000,
      macOptionIsMeta: true,
      theme: {
        background: "#00000000",
        foreground: "#d4d4d8",
        cursor: "#a1a1aa",
        selectionBackground: "rgba(148, 163, 184, 0.35)",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new Unicode11Addon());
    term.loadAddon(new WebLinksAddon());
    term.unicode.activeVersion = "11";
    term.open(container);
    termRef.current = term;
    fit.fit();
    term.focus();

    const ws = new WebSocket(sessionSocketUrl(sessionId, origin));
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    term.loadAddon(new ClipboardAddon());

    const sendJson = (obj: unknown) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    };

    ws.onopen = () => {
      setConn("open");
      fit.fit();
      sendJson({ type: "init", cols: term.cols, rows: term.rows });
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        const msg = JSON.parse(ev.data);
        if (msg.type === "exit") {
          setConn("exited");
        } else if (msg.type === "error") {
          term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
        }
        return;
      }
      term.write(new Uint8Array(ev.data));
    };
    ws.onclose = () => {
      setConn((c) => (c === "exited" ? c : "disconnected"));
    };

    // xterm.js sends a bare \r for Enter regardless of modifiers, so the
    // claude TUI can't tell Shift+Enter apart and submits instead of adding a
    // linebreak. Send ESC+CR — the sequence claude's /terminal-setup binds
    // Shift+Enter to — and swallow the key.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && e.key === "Enter" && e.shiftKey) {
        sendJson({ type: "input", data: "\x1b\r" });
        return false;
      }
      return true;
    });

    term.onData((data) => sendJson({ type: "input", data }));
    term.onBinary((data) => sendJson({ type: "input", data }));
    term.onResize(({ cols, rows }) => sendJson({ type: "resize", cols, rows }));

    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => fit.fit());
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      ws.close();
      term.dispose();
      wsRef.current = null;
      termRef.current = null;
    };
  }, [sessionId, origin, attempt, touch]);

  function sendKey(seq: string) {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data: seq }));
    termRef.current?.focus();
  }

  return (
    <div className="glass-panel-solid flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/6 px-3 py-2.5 md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onBack}
            className="mr-1 rounded-md px-1.5 py-0.5 text-neutral-400 transition hover:bg-white/10 md:hidden"
            aria-label="Back to sessions"
          >
            ←
          </button>
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              conn === "open" ? "bg-emerald-400" : conn === "connecting" ? "bg-blue-400 animate-pulse" : "bg-neutral-600"
            }`}
          />
          <span className="truncate font-mono text-[13px] font-medium text-neutral-200">{name}</span>
          <span className="hidden text-xs text-neutral-600 sm:inline">
            {status}
            {origin === "cloud" ? " · cloud" : ""}
          </span>
        </div>
        <ContextBadge context={context} size="md" />
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full px-2 py-1.5" />
        {(conn === "disconnected" || conn === "exited") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-sm">
            <div className="text-sm text-neutral-300">
              {conn === "exited" ? "Session ended" : "Connection lost — the session keeps running in tmux"}
            </div>
            <button
              onClick={() => setAttempt((a) => a + 1)}
              className="rounded-lg bg-neutral-100/90 px-3 py-1.5 text-xs font-medium text-neutral-900 transition hover:bg-white active:scale-[0.97]"
            >
              {conn === "exited" ? "Restart session" : "Reconnect"}
            </button>
          </div>
        )}
      </div>

      {touch && (
        <div className="pb-safe flex gap-1.5 overflow-x-auto border-t border-white/6 px-2 pt-1.5">
          {MOBILE_KEYS.map((k) => (
            <button
              key={k.label}
              onMouseDown={(e) => e.preventDefault()}
              onTouchEnd={(e) => {
                e.preventDefault();
                sendKey(k.seq);
              }}
              onClick={() => sendKey(k.seq)}
              className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-xs text-neutral-300 active:bg-white/15"
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
