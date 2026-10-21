import type { Permission } from "@/lib/auth/rbac";

/**
 * FYIP command registry. Maps a terminal command to an application module.
 * These are FYIP's own commands (not any third party's command syntax).
 *
 * `status` is honest about the state of each module:
 *  - implemented : functional end-to-end with the current data sources
 *  - partial     : functional but depends on a provider/entitlement for full data
 *  - scaffold    : routed + described, no data pipeline yet
 *  - blocked     : requires credentials/subscription/integration not present
 */
export type ModuleStatus = "implemented" | "partial" | "scaffold" | "blocked";

export interface ModuleDef {
  key: string;
  path: string;
  title: string;
  group: ModuleGroup;
  status: ModuleStatus;
  description: string;
  /** Permission required to view; undefined = any authenticated user. */
  permission?: Permission;
  /** What the module needs to reach `implemented`. */
  dependency?: string;
  /** Extra command aliases. */
  aliases?: string[];
}

export type ModuleGroup =
  | "Overview"
  | "Markets"
  | "Macro & News"
  | "Research"
  | "Derivatives"
  | "Order Flow"
  | "Portfolio & Risk"
  | "Trading Systems"
  | "Quantitative"
  | "Administration";

export const MODULES: ModuleDef[] = [
  { key: "HOME", path: "/terminal", title: "Overview", group: "Overview", status: "implemented", description: "Cross-asset dashboard: market strip, macro snapshot, top movers and news." },
  { key: "MKT", path: "/terminal/markets", title: "Markets Overview", group: "Markets", status: "implemented", description: "Sortable multi-asset quote tables with status badges, spreads and session state." },

  { key: "NEWS", path: "/terminal/news", title: "FYP NEWS", group: "Macro & News", status: "implemented", description: "Global financial news engine: documented public feeds, clustered developments, verification labels, honest publication times, source health, saved headlines, SSE updates and potential-impact interpretations.", permission: "news.read" },
  { key: "CAL", path: "/terminal/calendar", title: "Economic Calendar", group: "Macro & News", status: "partial", description: "Global scheduled releases with importance, actual/consensus/previous and source.", permission: "news.read", dependency: "FRED or a licensed macro calendar for real values." },
  { key: "MACRO", path: "/terminal/macro", title: "Macro Dashboard", group: "Macro & News", status: "partial", description: "Policy rates, yield curve, inflation and labour trends, event overlays.", permission: "news.read", dependency: "FRED/ECB/official sources for time series." },

  { key: "EQ", path: "/terminal/equities", title: "Equities & Company Research", group: "Research", status: "partial", description: "Company profiles, statement views and filings index.", permission: "research.read", dependency: "A fundamentals provider for statements; profiles seeded as metadata." },
  { key: "EARN", path: "/terminal/earnings", title: "Earnings Workstation", group: "Research", status: "blocked", description: "Earnings calendar, actual vs consensus, guidance and surprise history.", permission: "research.read", dependency: "Licensed earnings estimates provider." },
  { key: "FILINGS", path: "/terminal/filings", title: "Company Filings", group: "Research", status: "blocked", description: "Document search across filings with document-grounded summaries.", permission: "research.read", dependency: "SEC EDGAR / licensed transcripts and outbound network access." },
  { key: "SCAN", path: "/terminal/screener", title: "Screener", group: "Research", status: "implemented", description: "Server-side filter engine over the live quote set with saved screens.", permission: "research.read" },

  { key: "OPT", path: "/terminal/options", title: "Options Chain", group: "Derivatives", status: "partial", description: "Calls/puts with provider-or-FYIP greeks, IV and open interest.", permission: "analytics.read", dependency: "An options data provider for real chains." },
  { key: "GEX", path: "/terminal/gex", title: "Futures Profile", group: "Derivatives", status: "implemented", description: "Futures-only analytics from real trade prints: session levels, VWAP, volume-at-price profile with POC and 70% value area, and session buy/sell statistics.", permission: "analytics.read", dependency: "NinjaTrader bridge trade prints (trades: true). No options data is used or required." },
  { key: "SURF", path: "/terminal/surface", title: "3D Volume Surface", group: "Derivatives", status: "implemented", description: "Interactive time × price × volume surface built from executed prints, with rotate, zoom, hover/click inspection and buy/sell delta coloring.", permission: "analytics.read", dependency: "NinjaTrader bridge trade prints (trades: true); archive retention defaults to 72h." },
  { key: "VOL", path: "/terminal/volatility", title: "Volatility Analytics", group: "Derivatives", status: "scaffold", description: "IV surface, term structure, skew and realised-vs-implied.", permission: "analytics.read", dependency: "Options provider for surface data." },

  { key: "FUT", path: "/terminal/futures", title: "Futures & Curves", group: "Markets", status: "partial", description: "Contract calendars, rolls and futures term structure.", dependency: "Futures settlement/curve data." },
  { key: "TAPE", path: "/terminal/tape", title: "Time & Sales", group: "Order Flow", status: "partial", description: "Streaming plus archived prints with side/size filters, pause, large-print highlighting, millisecond timestamps and session stats.", dependency: "Trade events from the NinjaTrader Add-On or reference bridge (trades: true). Archive retention defaults to 72h." },
  { key: "DOM", path: "/terminal/dom", title: "Depth of Market", group: "Order Flow", status: "partial", description: "Read-only ladder with 10/20/30/50/100 levels, diagonal imbalance highlighting, cumulative toggle, auto-centering, font scaling and value flash.", dependency: "Depth events from the NinjaTrader Add-On (depth: true) or the reference bridge (--depth). Per-symbol subscription." },

  { key: "PORT", path: "/terminal/portfolio", title: "Portfolio", group: "Portfolio & Risk", status: "implemented", description: "Accounts, positions, realised/unrealised P&L and equity curve.", permission: "portfolio.read" },
  { key: "RISK", path: "/terminal/risk", title: "Risk Management", group: "Portfolio & Risk", status: "implemented", description: "Exposure, correlation, drawdown, VaR (documented method) and limits.", permission: "portfolio.read" },

  { key: "FYPBOT", path: "/terminal/bots", title: "FYP Bot Monitor", group: "Trading Systems", status: "scaffold", description: "Bot registry, heartbeats, execution logs and risk metrics (read-only).", permission: "bots.read", dependency: "MT5/NinjaTrader authenticated bridge; execution disabled by default." },

  { key: "LAB", path: "/terminal/lab", title: "Quantitative Lab", group: "Quantitative", status: "partial", description: "Dataset browser, indicator playground and reproducible analytics runs.", permission: "analytics.read", dependency: "Historical bar datasets." },
  { key: "BACKTEST", path: "/terminal/backtest", title: "Backtesting", group: "Quantitative", status: "scaffold", description: "Strategy config, commission/slippage assumptions and run lineage.", permission: "analytics.read", dependency: "Historical datasets + execution model." },

  { key: "ADMIN", path: "/terminal/admin", title: "Administration", group: "Administration", status: "implemented", description: "Users, roles, provider configuration, feed health and audit log.", permission: "admin.audit" },
];

export const MODULE_BY_KEY = new Map(MODULES.map((m) => [m.key, m]));
export const MODULE_BY_PATH = new Map(MODULES.map((m) => [m.path, m]));

export function moduleGroups(): { group: ModuleGroup; modules: ModuleDef[] }[] {
  const order: ModuleGroup[] = [
    "Overview", "Markets", "Macro & News", "Research", "Derivatives",
    "Order Flow", "Portfolio & Risk", "Trading Systems", "Quantitative", "Administration",
  ];
  return order.map((group) => ({ group, modules: MODULES.filter((m) => m.group === group) }));
}

export const STATUS_LABEL: Record<ModuleStatus, string> = {
  implemented: "IMPLEMENTED",
  partial: "PARTIAL",
  scaffold: "SCAFFOLD",
  blocked: "BLOCKED",
};

export const STATUS_CLASS: Record<ModuleStatus, string> = {
  implemented: "text-up border-up/40 bg-up/10",
  partial: "text-info border-info/40 bg-info/10",
  scaffold: "text-warn border-warn/40 bg-warn/10",
  blocked: "text-down border-down/40 bg-down/10",
};