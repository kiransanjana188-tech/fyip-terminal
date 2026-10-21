"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/lib/client/hooks";
import { TerminalProvider, useTerminal } from "./context";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "./CommandPalette";
import { Loading } from "@/components/ui/States";

const SIDEBAR_KEY = "fyip.sidebar-open";

function ShellBody({ children }: { children: React.ReactNode }) {
  const { paletteOpen, setPaletteOpen } = useTerminal();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_KEY);
      if (raw !== null) {
        setSidebarOpen(raw === "true");
      } else if (window.matchMedia("(max-width: 767px)").matches) {
        setSidebarOpen(false);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        // Save-workspace is wired in the workspace module (Ctrl/Cmd+S).
        window.dispatchEvent(new CustomEvent("fyip:save-workspace"));
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  function toggleSidebar() {
    setSidebarOpen((o) => {
      try { localStorage.setItem(SIDEBAR_KEY, String(!o)); } catch { /* ignore */ }
      return !o;
    });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-base">
      <TopBar onOpenPalette={() => setPaletteOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar open={sidebarOpen} />
        <div className="flex min-w-0 flex-1 flex-col">
          <button
            onClick={toggleSidebar}
            className="h-5 shrink-0 border-b border-line bg-panel px-2 text-left font-mono text-3xs uppercase tracking-widest text-ink-faint hover:text-amber"
            title="Toggle workspace rail"
          >
            {sidebarOpen ? "‹ collapse rail" : "› expand rail"}
          </button>
          <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
      <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-panel-2 px-3 font-mono text-3xs uppercase tracking-wider text-ink-faint">
        <span className="text-amber">FYIP TERMINAL v0.1</span>
        <span>Data shown with explicit source &amp; freshness status · no simulated data is presented as live</span>
        <span className="ml-auto">Ctrl/Cmd+K palette · Ctrl/Cmd+S save workspace</span>
      </footer>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export function TerminalShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading } = useCurrentUser();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-base">
        <Loading label="Authenticating" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-base">
        <Loading label="Redirecting to sign-in" />
      </div>
    );
  }

  return (
    <TerminalProvider user={user}>
      <ShellBody>{children}</ShellBody>
    </TerminalProvider>
  );
}