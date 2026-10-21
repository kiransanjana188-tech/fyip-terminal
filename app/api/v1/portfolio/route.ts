import { fail, handler, ok, requireString } from "@/lib/api/respond";
import { requirePermission, type CurrentUser } from "@/lib/auth/current";
import { execute, newId, queryAll } from "@/lib/db";
import { getInstrument } from "@/lib/market/instruments";
import { quoteHub } from "@/lib/market/hub";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AccountRow {
  id: string;
  label: string;
  broker: string;
  account_ref: string;
  base_currency: string;
  mode: string;
}
interface PositionRow {
  id: string;
  account_id: string;
  instrument_id: string;
  quantity: number;
  avg_price: number;
  opened_at: string;
}
interface TradeRow {
  id: string;
  account_id: string;
  instrument_id: string;
  side: string;
  quantity: number;
  price: number;
  fees: number;
  realized_pnl: number | null;
  executed_at: string;
  source: string;
}

function buildPortfolio(userId: string) {
  const accounts = queryAll<AccountRow>(
    "SELECT id, label, broker, account_ref, base_currency, mode FROM portfolio_accounts WHERE user_id = ?",
    userId,
  );
  const accountIds = accounts.map((a) => a.id);
  if (accountIds.length === 0) {
    return { accounts: [], positions: [], trades: [], summary: { marketValue: 0, unrealizedPnl: 0, realizedPnl: 0, currency: "USD" } };
  }
  const placeholders = accountIds.map(() => "?").join(",");
  const positions = queryAll<PositionRow>(
    `SELECT * FROM positions WHERE account_id IN (${placeholders})`,
    ...accountIds,
  );
  const trades = queryAll<TradeRow>(
    `SELECT * FROM trades WHERE account_id IN (${placeholders}) ORDER BY executed_at DESC LIMIT 500`,
    ...accountIds,
  );

  let marketValue = 0;
  let unrealizedPnl = 0;
  const enriched = positions.map((p) => {
    const inst = getInstrument(p.instrument_id);
    const q = inst ? quoteHub.get(inst.id) : undefined;
    const last = q?.last ?? null;
    const mv = last !== null ? last * p.quantity * (inst?.contract_multiplier ?? 1) : null;
    const upnl = last !== null ? (last - p.avg_price) * p.quantity * (inst?.contract_multiplier ?? 1) : null;
    if (mv !== null) marketValue += mv;
    if (upnl !== null) unrealizedPnl += upnl;
    return {
      ...p,
      symbol: inst?.symbol ?? p.instrument_id,
      assetClass: inst?.asset_class ?? "unknown",
      last,
      marketValue: mv,
      unrealizedPnl: upnl,
      priceStatus: q?.dataStatus ?? "unavailable",
    };
  });

  const realizedPnl = trades.reduce((a, t) => a + (t.realized_pnl ?? 0), 0);
  return {
    accounts,
    positions: enriched,
    trades: trades.map((t) => ({ ...t, symbol: getInstrument(t.instrument_id)?.symbol ?? t.instrument_id })),
    summary: { marketValue, unrealizedPnl, realizedPnl, currency: accounts[0].base_currency },
  };
}

export const GET = handler(async () => {
  const user = requirePermission("portfolio.read");
  return ok(buildPortfolio(user.id));
});

interface PostBody {
  action: "create_account" | "add_position" | "add_trade";
  label?: string;
  broker?: string;
  accountRef?: string;
  baseCurrency?: string;
  accountId?: string;
  symbol?: string;
  quantity?: number;
  price?: number;
  side?: string;
  fees?: number;
  realizedPnl?: number;
}

export const POST = handler(async (req: Request) => {
  const user: CurrentUser = requirePermission("portfolio.read");
  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body) return fail(400, "VALIDATION_ERROR", "JSON body required.");
  const now = new Date().toISOString();

  if (body.action === "create_account") {
    const label = requireString(body.label, "label", 120);
    const broker = requireString(body.broker, "broker", 60);
    const ref = requireString(body.accountRef, "accountRef", 60);
    const id = newId("acct");
    execute(
      `INSERT INTO portfolio_accounts (id, user_id, label, broker, account_ref, base_currency, mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'read_only', ?)`,
      id, user.id, label, broker, ref, body.baseCurrency ?? "USD", now,
    );
    recordAudit({ actorId: user.id, actorEmail: user.email, action: "portfolio.create_account", target: id, status: "success" });
    return ok({ id }, { status: 201 });
  }

  if (body.action === "add_position") {
    const accountId = requireString(body.accountId, "accountId", 64);
    const symbol = requireString(body.symbol, "symbol", 32);
    const inst = getInstrument(symbol);
    if (!inst) return fail(404, "INSTRUMENT_NOT_FOUND", `Unknown instrument: ${symbol}`);
    const owned = queryAll<{ id: string }>("SELECT id FROM portfolio_accounts WHERE id = ? AND user_id = ?", accountId, user.id);
    if (owned.length === 0) return fail(403, "FORBIDDEN", "Account does not belong to you.");
    if (typeof body.quantity !== "number" || typeof body.price !== "number") {
      return fail(400, "VALIDATION_ERROR", "quantity and price are required numbers.");
    }
    const id = newId("pos");
    execute(
      `INSERT INTO positions (id, account_id, instrument_id, quantity, avg_price, opened_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, accountId, inst.id, body.quantity, body.price, now, now,
    );
    recordAudit({ actorId: user.id, action: "portfolio.add_position", target: `${accountId}:${symbol}`, status: "success" });
    return ok({ id }, { status: 201 });
  }

  if (body.action === "add_trade") {
    const accountId = requireString(body.accountId, "accountId", 64);
    const symbol = requireString(body.symbol, "symbol", 32);
    const inst = getInstrument(symbol);
    if (!inst) return fail(404, "INSTRUMENT_NOT_FOUND", `Unknown instrument: ${symbol}`);
    const owned = queryAll<{ id: string }>("SELECT id FROM portfolio_accounts WHERE id = ? AND user_id = ?", accountId, user.id);
    if (owned.length === 0) return fail(403, "FORBIDDEN", "Account does not belong to you.");
    if (typeof body.quantity !== "number" || typeof body.price !== "number") {
      return fail(400, "VALIDATION_ERROR", "quantity and price are required numbers.");
    }
    const id = newId("trd");
    execute(
      `INSERT INTO trades (id, account_id, instrument_id, side, quantity, price, fees, realized_pnl, executed_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
      id, accountId, inst.id, body.side ?? "buy", body.quantity, body.price, body.fees ?? 0, body.realizedPnl ?? null, now,
    );
    recordAudit({ actorId: user.id, action: "portfolio.add_trade", target: `${accountId}:${symbol}`, status: "success" });
    return ok({ id }, { status: 201 });
  }

  return fail(400, "VALIDATION_ERROR", "Unknown action.");
});