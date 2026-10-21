import { queryAll, queryOne } from "@/lib/db";
import { quoteHub } from "@/lib/market/hub";
import { bridgeThresholds, deriveDataStatus, type DataStatus } from "@/lib/market/status";
import { getInstrument, listInstruments, type InstrumentRow } from "@/lib/market/instruments";

export interface QuoteView {
  instrumentId: string;
  symbol: string;
  displayName: string;
  assetClass: string;
  currency: string;
  exchange: string | null;
  priceScale: number;
  tickSize: number;
  provider: string | null;
  bid: number | null;
  ask: number | null;
  last: number | null;
  spread: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
  openInterest: number | null;
  change: number | null;
  changePct: number | null;
  dataStatus: DataStatus;
  entitlement: string | null;
  eventTimestamp: string | null;
  receivedTimestamp: string | null;
  sessionState: "open" | "closed" | "unknown";
  /** For continuous futures: the front contract actually feeding this view. */
  resolvedContract: string | null;
}

interface SnapshotRow {
  instrument_id: string;
  provider: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prev_close: number | null;
  volume: number | null;
  open_interest: number | null;
  data_status: string;
  entitlement: string | null;
  event_timestamp: string | null;
  received_timestamp: string;
}

/** Session state is informational; full calendars are a Phase-2 item. */
function sessionState(): "open" | "closed" | "unknown" {
  return "unknown";
}

interface FrontContract {
  id: string;
  symbol: string;
}

const contractCache = new Map<string, { value: FrontContract | null; until: number }>();
const CONTRACT_TTL_MS = 60_000;

/**
 * A continuous future (`ES1!`) is a view, not a tradable contract: quote
 * surfaces resolve it to the next-expiring contract month for its root so the
 * price, DoD and OI all come from real contract rows (bridge or provider).
 */
export function frontContractFor(inst: InstrumentRow): FrontContract | null {
  if (inst.is_continuous !== 1 || !inst.underlying_id) return null;
  const now = Date.now();
  const cached = contractCache.get(inst.id);
  if (cached && cached.until > now) return cached.value;
  const row = queryOne<{ id: string; symbol: string }>(
    `SELECT id, symbol FROM instruments
      WHERE asset_class = 'future'
        AND underlying_kind = 'contract'
        AND underlying_id = ?
        AND expiration IS NOT NULL AND expiration >= ?
      ORDER BY expiration ASC
      LIMIT 1`,
    inst.underlying_id,
    new Date().toISOString(),
  );
  const value = row ? { id: row.id, symbol: row.symbol } : null;
  contractCache.set(inst.id, { value, until: now + CONTRACT_TTL_MS });
  return value;
}

export function buildQuoteView(inst: InstrumentRow): QuoteView {
  const front = frontContractFor(inst);
  const source = front ? getInstrument(front.id) ?? inst : inst;
  const live = quoteHub.get(source.id);
  const thresholds = bridgeThresholds();

  let provider = live?.provider ?? null;
  let bid = live?.bid ?? null;
  let ask = live?.ask ?? null;
  let last = live?.last ?? null;
  let open = live?.open ?? null;
  let high = live?.high ?? null;
  let low = live?.low ?? null;
  let prevClose = live?.prevClose ?? null;
  let volume = live?.volume ?? null;
  let openInterest = live?.openInterest ?? null;
  let entitlement = live?.entitlement ?? null;
  let eventTimestamp = live?.eventTimestamp ?? null;
  let receivedTimestamp = live?.receivedTimestamp ?? null;
  let declared: DataStatus = live?.dataStatus ?? "unavailable";

  if (!live) {
    const snap = queryAll<SnapshotRow>(
      "SELECT * FROM quote_snapshots WHERE instrument_id = ? ORDER BY received_timestamp DESC LIMIT 1",
      source.id,
    )[0];
    if (snap) {
      provider = snap.provider;
      bid = snap.bid;
      ask = snap.ask;
      last = snap.last;
      open = snap.open;
      high = snap.high;
      low = snap.low;
      prevClose = snap.prev_close;
      volume = snap.volume;
      openInterest = snap.open_interest;
      entitlement = snap.entitlement;
      eventTimestamp = snap.event_timestamp;
      receivedTimestamp = snap.received_timestamp;
      declared = snap.data_status as DataStatus;
    }
  }

  const feed = provider ? quoteHub.feedState(provider) : { connected: false };
  // On serverless instances the bridge request may have landed on a different
  // instance, so the in-memory feed flag is not authoritative. A persisted
  // snapshot that is still inside the disconnect window counts as connected.
  let connected = provider ? feed.connected : false;
  if (!connected && receivedTimestamp) {
    const ageSeconds = (Date.now() - new Date(receivedTimestamp).getTime()) / 1000;
    connected = Number.isFinite(ageSeconds) && ageSeconds <= thresholds.disconnectSeconds;
  }
  const dataStatus = deriveDataStatus({
    declared,
    eventTimestamp,
    receivedTimestamp,
    connected,
    ...thresholds,
  });

  const change = last !== null && prevClose !== null && last !== undefined && prevClose !== undefined ? last - prevClose : null;
  const changePct = change !== null && prevClose ? (change / prevClose) * 100 : null;

  return {
    instrumentId: inst.id,
    symbol: inst.symbol,
    displayName: inst.display_name,
    assetClass: inst.asset_class,
    currency: inst.currency,
    exchange: inst.exchange_id,
    priceScale: inst.price_scale,
    tickSize: inst.tick_size,
    provider,
    bid,
    ask,
    last,
    spread: bid !== null && ask !== null ? ask - bid : null,
    open,
    high,
    low,
    prevClose,
    volume,
    openInterest,
    change,
    changePct,
    dataStatus,
    entitlement,
    eventTimestamp,
    receivedTimestamp,
    sessionState: sessionState(),
    resolvedContract: front?.symbol ?? null,
  };
}

export function buildQuoteViewList(instruments?: InstrumentRow[]): QuoteView[] {
  const list = instruments ?? listInstruments();
  return list.map(buildQuoteView);
}