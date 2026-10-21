"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { CurrentUser } from "@/lib/client/types";

interface TerminalContextValue {
  user: CurrentUser | null;
  linkedSymbol: string;
  setLinkedSymbol: (s: string) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

export function TerminalProvider({ user, children }: { user: CurrentUser | null; children: React.ReactNode }) {
  const [linkedSymbol, setLinkedSymbol] = useState("ES");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const value = useMemo(
    () => ({ user, linkedSymbol, setLinkedSymbol, paletteOpen, setPaletteOpen }),
    [user, linkedSymbol, paletteOpen],
  );
  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>;
}

export function useTerminal(): TerminalContextValue {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error("useTerminal must be used inside TerminalProvider");
  return ctx;
}

/** Capability check mirroring server RBAC. */
export function can(user: CurrentUser | null, permission: string): boolean {
  return !!user?.permissions.includes(permission);
}