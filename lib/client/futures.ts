import type { FuturesProfile, FuturesSurface } from "@/lib/analytics/futures-profile";
import type { DataStatus } from "@/lib/client/types";

/** Response contract for GET /api/v1/futures/analytics (futures-only analytics). */
export interface FuturesAnalyticsResponse {
  available: boolean;
  reason: string | null;
  symbol: string;
  contractSymbol: string | null;
  displayName: string | null;
  tickSize: number | null;
  priceScale: number | null;
  source: string;
  dataStatus: DataStatus;
  asOf: string | null;
  windowHours: number;
  quote: {
    last: number | null;
    bid: number | null;
    ask: number | null;
    spread: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    prevClose: number | null;
    volume: number | null;
    openInterest: number | null;
    change: number | null;
    changePct: number | null;
  } | null;
  vwap: number | null;
  profile: FuturesProfile | null;
  surface: FuturesSurface | null;
  tradeCount: number;
  firstTradeAt: string | null;
  lastTradeAt: string | null;
  warnings: string[];
}
