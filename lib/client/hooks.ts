"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, ApiError } from "./api";
import type { CurrentUser, DepthLadderDTO, StreamQuote, TradePrintDTO } from "./types";

export interface UseApiResult<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

/** Minimal data-fetching hook with optional polling. */
export function useApi<T>(
  path: string | null,
  opts: { params?: Record<string, string | number | boolean | undefined | null>; pollMs?: number } = {},
): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const [tick, setTick] = useState(0);
  const paramsKey = JSON.stringify(opts.params ?? {});

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const result = await apiGet<T>(path, JSON.parse(paramsKey));
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "NETWORK", "Network error"));
    } finally {
      setLoading(false);
    }
  }, [path, paramsKey]);

  useEffect(() => {
    setLoading(!!path);
    void load();
  }, [load, tick, path]);

  useEffect(() => {
    if (!opts.pollMs || !path) return;
    const id = setInterval(() => void load(), opts.pollMs);
    return () => clearInterval(id);
  }, [load, opts.pollMs, path]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
}

export function useCurrentUser(): AuthState {
  const { data, loading, error, reload } = useApi<{ authenticated: boolean; user: CurrentUser | null }>("/auth/me");
  return useMemo(
    () => ({ user: data?.user ?? null, loading, error, reload }),
    [data, loading, error, reload],
  );
}

export interface QuoteStreamState {
  connected: boolean;
  quotes: Record<string, StreamQuote>;
  lastEventAt: string | null;
  error: string | null;
}

/**
 * Subscribe to the SSE quote gateway for a set of symbols. Reconnects
 * automatically (EventSource retries). The server only pushes the symbols
 * requested, never the full universe.
 */
export function useQuoteStream(symbols: string[] | null): QuoteStreamState {
  const [connected, setConnected] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, StreamQuote>>({});
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const symbolsKey = symbols ? symbols.slice().sort().join(",") : "";

  useEffect(() => {
    const query = symbolsKey ? `?symbols=${encodeURIComponent(symbolsKey)}` : "";
    const es = new EventSource(`/api/v1/stream/quotes${query}`);
    const onSnapshot = (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data) as { quotes: Array<StreamQuote & { dataStatus: StreamQuote["status"] }> };
        const next: Record<string, StreamQuote> = {};
        for (const q of payload.quotes) {
          next[q.symbol] = { ...q, status: q.dataStatus };
        }
        setQuotes(next);
        setLastEventAt(new Date().toISOString());
      } catch { /* ignore */ }
    };
    const onQuote = (ev: MessageEvent) => {
      try {
        const q = JSON.parse(ev.data) as StreamQuote;
        setQuotes((prev) => ({ ...prev, [q.symbol]: q }));
        setLastEventAt(q.receivedTimestamp ?? new Date().toISOString());
      } catch { /* ignore */ }
    };
    es.addEventListener("snapshot", onSnapshot as EventListener);
    es.addEventListener("quote", onQuote as EventListener);
    es.addEventListener("open", () => {
      setConnected(true);
      setError(null);
    });
    es.addEventListener("error", () => {
      setConnected(false);
      setError("stream disconnected — retrying");
    });
    return () => {
      es.removeEventListener("snapshot", onSnapshot as EventListener);
      es.removeEventListener("quote", onQuote as EventListener);
      es.close();
    };
  }, [symbolsKey]);

  return { connected, quotes, lastEventAt, error };
}

/** Interval-driven re-render trigger for "x ago" labels. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    ref.current = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      if (ref.current) clearInterval(ref.current);
    };
  }, [intervalMs]);
  return now;
}
export interface MarketStreamState {
  connected: boolean;
  quotes: Record<string, StreamQuote>;
  depth: Record<string, DepthLadderDTO>;
  trades: TradePrintDTO[];
  lastEventAt: string | null;
  error: string | null;
}

/**
 * Unified SSE subscription for a fixed set of symbols (contract symbols, e.g.
 * "ESZ6"). `types` selects channels: quote, depth, trade. Depth updates
 * replace the latest ladder per symbol; trades are kept newest-first with a
 * bounded accumulation window so the tape stays readable.
 */
export function useMarketStream(
  symbols: string[] | null,
  types: ("quote" | "depth" | "trade")[],
  maxTrades = 200,
): MarketStreamState {
  const [connected, setConnected] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, StreamQuote>>({});
  const [depth, setDepth] = useState<Record<string, DepthLadderDTO>>({});
  const [trades, setTrades] = useState<TradePrintDTO[]>([]);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const symbolsKey = symbols ? symbols.slice().sort().join(",") : "";
  const typesKey = types.join(",") || "quote";

  useEffect(() => {
    setQuotes({});
    setDepth({});
    setTrades([]);
    const query = new URLSearchParams();
    if (symbolsKey) query.set("symbols", symbolsKey);
    query.set("types", typesKey);
    const es = new EventSource(`/api/v1/stream/quotes?${query.toString()}`);

    es.addEventListener("snapshot", (ev) => {
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as { quotes: (StreamQuote & { dataStatus?: StreamQuote["status"] })[] };
        const next: Record<string, StreamQuote> = {};
        for (const q of payload.quotes) next[q.symbol] = { ...q, status: q.status ?? q.dataStatus };
        setQuotes(next);
        setLastEventAt(new Date().toISOString());
      } catch { /* ignore malformed */ }
    });
    es.addEventListener("quote", (ev) => {
      try {
        const q = JSON.parse((ev as MessageEvent).data) as StreamQuote;
        setQuotes((prev) => ({ ...prev, [q.symbol]: { ...q, status: q.status ?? q.dataStatus } }));
        setLastEventAt(q.receivedTimestamp ?? new Date().toISOString());
      } catch { /* ignore */ }
    });
    es.addEventListener("depth", (ev) => {
      try {
        const d = JSON.parse((ev as MessageEvent).data) as DepthLadderDTO;
        setDepth((prev) => ({ ...prev, [d.symbol]: { ...d, status: d.status ?? d.dataStatus } }));
        setLastEventAt(d.receivedTimestamp ?? new Date().toISOString());
      } catch { /* ignore */ }
    });
    es.addEventListener("trade", (ev) => {
      try {
        const t = JSON.parse((ev as MessageEvent).data) as TradePrintDTO;
        setTrades((prev) => [t, ...prev].slice(0, maxTrades));
        setLastEventAt(t.receivedTimestamp);
      } catch { /* ignore */ }
    });
    es.addEventListener("open", () => { setConnected(true); setError(null); });
    es.addEventListener("error", () => { setConnected(false); setError("stream disconnected — retrying"); });
    return () => es.close();
  }, [symbolsKey, typesKey, maxTrades]);

  return { connected, quotes, depth, trades, lastEventAt, error };
}
