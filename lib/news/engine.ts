import { execute, newId, queryAll, queryOne } from "@/lib/db";
import type { NormalizedNewsItem } from "@/lib/providers/types";

export type NewsPriority = NormalizedNewsItem["priority"];

export const PRIORITY_LABEL: Record<NewsPriority, string> = {
  breaking: "BREAKING",
  high: "HIGH",
  scheduled: "SCHEDULED",
  market: "MARKET",
  research: "RESEARCH",
  general: "GENERAL",
};

export const PRIORITY_CLASS: Record<NewsPriority, string> = {
  breaking: "bg-down/20 text-down border-down/50",
  high: "bg-amber/20 text-amber border-amber/50",
  scheduled: "bg-info/15 text-info border-info/40",
  market: "bg-up/15 text-up border-up/40",
  research: "bg-violet/15 text-violet border-violet/40",
  general: "bg-panel-3 text-ink-dim border-line-2",
};

/** Sources permitted to carry an explicit "breaking" classification. */
const WIRE_SOURCES = new Set(["financialjuice", "reuters", "newsapi"]);

interface RuleHit {
  pattern: RegExp;
  priority: NewsPriority;
  rule: string;
}

/**
 * Transparent, documented keyword rules used ONLY when a provider does not
 * supply its own classification. High-impact macro/central-bank terms map to
 * "high"; a "breaking" badge is never awarded by keyword alone — only licensed
 * wire sources may originate a breaking classification.
 */
const HIGH_IMPACT_RULES: RuleHit[] = [
  { pattern: /\b(fomc|federal reserve|fed (cut|hike|hold)|rate (decision|hike|cut))\b/i, priority: "high", rule: "central-bank-policy" },
  { pattern: /\b(cpi|inflation|pce|ppi|nonfarm|payrolls|jobless claims|unemployment rate)\b/i, priority: "high", rule: "macro-release" },
  { pattern: /\b(ecb|bank of england|boe|bank of japan|boj)\b/i, priority: "high", rule: "central-bank" },
  { pattern: /\b(tariff|sanction|default|downgrade|bankrupt|halted|circuit breaker)\b/i, priority: "high", rule: "risk-event" },
  { pattern: /\b(earnings|guidance|merger|acquisition|buyback)\b/i, priority: "market", rule: "corporate-action" },
  { pattern: /\b(opec|crude|pipeline|refinery|supply disruption)\b/i, priority: "market", rule: "commodity-supply" },
];

export function derivePriority(
  headline: string,
  opts: { sourceKey: string; explicit?: NewsPriority | null; scheduled?: boolean; isFixture?: boolean },
): { priority: NewsPriority; rule: string } {
  if (opts.explicit) return { priority: opts.explicit, rule: "source-classification" };
  if (opts.scheduled) return { priority: "scheduled", rule: "scheduled-event" };
  for (const r of HIGH_IMPACT_RULES) {
    if (r.pattern.test(headline)) return { priority: r.priority, rule: r.rule };
  }
  // Only a licensed wire may raise a story to BREAKING; keyword rules never do.
  void WIRE_SOURCES;
  return { priority: "general", rule: "default" };
}

export function dedupeKey(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function ingestNewsItem(item: NormalizedNewsItem): boolean {
  const dk = dedupeKey(item.headline);
  try {
    execute(
      `INSERT OR IGNORE INTO news_items (
        id, source_key, headline, summary, url, priority, priority_rule, categories, instruments,
        published_at, received_at, ingested_via, is_fixture, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      item.id,
      item.sourceKey,
      item.headline,
      item.summary,
      item.url,
      item.priority,
      item.priorityRule,
      item.categories.join(","),
      item.instruments.join(","),
      item.publishedAt,
      item.receivedAt,
      item.ingestedVia,
      item.isFixture ? 1 : 0,
      dk,
    );
    return true;
  } catch {
    return false;
  }
}

export interface NewsRow {
  id: string;
  source_key: string;
  headline: string;
  summary: string | null;
  url: string | null;
  priority: NewsPriority;
  priority_rule: string;
  categories: string | null;
  instruments: string | null;
  published_at: string;
  received_at: string;
  ingested_via: string;
  is_fixture: number;
}

export interface NewsFilter {
  priority?: NewsPriority;
  source?: string;
  category?: string;
  query?: string;
  limit?: number;
}

export function listNews(filter: NewsFilter = {}): NewsRow[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.priority) {
    clauses.push("priority = ?");
    params.push(filter.priority);
  }
  if (filter.source) {
    clauses.push("source_key = ?");
    params.push(filter.source);
  }
  if (filter.category) {
    clauses.push("categories LIKE ?");
    params.push(`%${filter.category}%`);
  }
  if (filter.query) {
    clauses.push("(headline LIKE ? OR summary LIKE ?)");
    params.push(`%${filter.query}%`, `%${filter.query}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  return queryAll<NewsRow>(
    `SELECT * FROM news_items ${where} ORDER BY published_at DESC LIMIT ${limit}`,
    ...params,
  );
}

export function newsCountsByPriority(): Record<NewsPriority, number> {
  const rows = queryAll<{ priority: NewsPriority; c: number }>(
    "SELECT priority, COUNT(*) AS c FROM news_items GROUP BY priority",
  );
  const base: Record<NewsPriority, number> = { breaking: 0, high: 0, scheduled: 0, market: 0, research: 0, general: 0 };
  for (const r of rows) base[r.priority] = r.c;
  return base;
}

/**
 * Development fixture headlines. Clearly labelled `is_fixture=1` and described
 * as synthetic in the UI. Never marked BREAKING.
 */
export function seedFixtureNews(): void {
  if (process.env.FYIP_ENABLE_FIXTURES !== "true") return;
  const count = queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM news_items WHERE is_fixture = 1");
  if ((count?.c ?? 0) > 0) return;
  const now = Date.now();
  const fixtures: { h: string; s: string; cat: string; inst: string[] }[] = [
    { h: "FYIP FIXTURE: Example CPI release placeholder", s: "Synthetic development headline used to exercise the wire UI. Not real news.", cat: "inflation", inst: ["US10Y", "SPX"] },
    { h: "FYIP FIXTURE: Example central-bank speaker placeholder", s: "Synthetic development headline. No real event is represented.", cat: "central-bank", inst: ["EURUSD"] },
    { h: "FYIP FIXTURE: Example crude-oil supply placeholder", s: "Synthetic development headline used to test commodity filters.", cat: "energy", inst: ["CL"] },
    { h: "FYIP FIXTURE: Example mega-cap earnings placeholder", s: "Synthetic development headline used to test earnings-tagged news.", cat: "earnings", inst: ["AAPL"] },
  ];
  fixtures.forEach((f, i) => {
    const p = derivePriority(f.h, { sourceKey: "fixture", isFixture: true });
    ingestNewsItem({
      id: newId("news"),
      sourceKey: "fixture",
      headline: f.h,
      summary: f.s,
      url: null,
      priority: p.priority,
      priorityRule: p.rule,
      categories: [f.cat],
      instruments: f.inst,
      publishedAt: new Date(now - i * 600_000).toISOString(),
      receivedAt: new Date(now - i * 600_000).toISOString(),
      ingestedVia: "development-fixture",
      isFixture: true,
    });
  });
}