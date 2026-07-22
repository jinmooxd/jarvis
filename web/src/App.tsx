import { useCallback, useEffect, useState } from "react";
import { api, apiFor, cloudApi } from "./api";
import CreateSessionModal from "./components/CreateSessionModal";
import SessionList from "./components/SessionList";
import TerminalView from "./components/TerminalView";
import TopBar from "./components/TopBar";
import { flattenSessions } from "./sessionGroups";
import type { CloudStatus, SessionSummary } from "./types";

export default function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [cloud, setCloud] = useState<CloudStatus>({ configured: false, connected: false });
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    const status = await cloudApi.status().catch((): CloudStatus => ({ configured: false, connected: false }));
    setCloud(status);
    const [local, remote] = await Promise.all([
      api
        .listSessions()
        .then((ss) => ss.map((s) => ({ ...s, origin: "local" as const })))
        .catch(() => undefined),
      status.connected
        ? apiFor("cloud")
            .listSessions()
            .then((ss) => ss.map((s) => ({ ...s, origin: "cloud" as const })))
            .catch(() => [])
        : Promise.resolve([]),
    ]);
    // If the local list failed the page itself is in trouble — keep what we had.
    if (local) setSessions([...local, ...remote]);
  }, []);

  const reconnectCloud = useCallback(async () => {
    const status = await cloudApi.reconnect().catch(() => undefined);
    if (status) setCloud(status);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  // iOS never resizes the layout viewport for the on-screen keyboard — only
  // visualViewport shrinks. Mirror its height into --app-height so the
  // terminal (and its key bar) stays visible above the keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      document.documentElement.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
      window.scrollTo(0, 0);
    };
    vv.addEventListener("resize", apply);
    apply();
    return () => {
      vv.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);

  // Cmd+Up / Cmd+Down cycle sessions in the list's visual order, crossing
  // repo-group boundaries and wrapping at the ends. Capture phase so the
  // shortcut wins even while the terminal has focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.metaKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      const target = e.target as HTMLElement | null;
      const inTerminal = !!target?.closest?.(".xterm");
      if (!inTerminal && (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA")) return;
      const order = flattenSessions(sessions);
      if (order.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const idx = order.findIndex((s) => s.claudeSessionId === selectedId);
      const next = idx === -1 ? (delta === 1 ? 0 : order.length - 1) : (idx + delta + order.length) % order.length;
      setSelectedId(order[next].claudeSessionId);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sessions, selectedId]);

  const selected = sessions.find((s) => s.claudeSessionId === selectedId);

  // On phones there isn't room for both panels: show the list, or the
  // terminal with a back button once a session is selected.
  return (
    <div className="flex flex-col overflow-hidden" style={{ height: "var(--app-height)" }}>
      <TopBar />
      <div className="flex flex-1 gap-3 overflow-hidden p-2 md:p-3">
        <div
          className={`glass-panel w-full shrink-0 overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/40 md:block md:w-80 ${
            selected ? "hidden" : "block"
          }`}
        >
          <SessionList
            sessions={sessions}
            cloud={cloud}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCreate={() => setShowCreate(true)}
            onRefresh={refresh}
            onReconnect={reconnectCloud}
          />
        </div>
        <div
          className={`glass-panel flex-1 overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/40 md:block ${
            selected ? "block" : "hidden"
          }`}
        >
          {selected ? (
            <TerminalView
              key={`${selected.origin ?? "local"}:${selected.claudeSessionId}`}
              sessionId={selected.claudeSessionId}
              origin={selected.origin ?? "local"}
              name={selected.name}
              status={selected.status}
              context={selected.context}
              onBack={() => setSelectedId(undefined)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-500">
              <div className="text-3xl opacity-40">◇</div>
              <div className="text-sm">Select a session, or create a new one</div>
            </div>
          )}
        </div>
      </div>
      {showCreate && (
        <CreateSessionModal
          cloud={cloud}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            refresh();
            setSelectedId(id);
          }}
        />
      )}
    </div>
  );
}
