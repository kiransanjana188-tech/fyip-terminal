import { queryAll, queryOne } from "@/lib/db";

export interface EconomicEventRow {
  id: string;
  country: string;
  indicator: string;
  importance: string;
  scheduled_at: string;
  timezone: string;
  unit: string | null;
  source: string;
  source_url: string | null;
  status: string;
  is_fixture: number;
}

export interface EconomicObservationRow {
  id: number;
  country: string;
  indicator: string;
  period: string | null;
  actual: number | null;
  consensus: number | null;
  previous: number | null;
  revised_previous: number | null;
  unit: string | null;
  source: string;
  source_url: string | null;
  is_fixture: number;
  published_at: string;
}

export function listEconomicEvents(opts: { from?: string; to?: string; country?: string; limit?: number } = {}): EconomicEventRow[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (opts.from) {
    clauses.push("scheduled_at >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    clauses.push("scheduled_at <= ?");
    params.push(opts.to);
  }
  if (opts.country) {
    clauses.push("country = ?");
    params.push(opts.country);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  return queryAll<EconomicEventRow>(
    `SELECT * FROM economic_events ${where} ORDER BY scheduled_at ASC LIMIT ${limit}`,
    ...params,
  );
}

export function listObservations(country: string, indicator: string, limit = 200): EconomicObservationRow[] {
  return queryAll<EconomicObservationRow>(
    `SELECT * FROM economic_observations WHERE country = ? AND indicator = ?
     ORDER BY published_at DESC LIMIT ?`,
    country,
    indicator,
    limit,
  );
}

export function economicIndicators(): { country: string; indicator: string; c: number }[] {
  return queryAll<{ country: string; indicator: string; c: number }>(
    `SELECT country, indicator, COUNT(*) AS c FROM economic_observations
     GROUP BY country, indicator ORDER BY country, indicator`,
  );
}

/** Convenience: has any real (non-fixture) macro data been ingested? */
export function hasRealMacroData(): boolean {
  const row = queryOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM economic_observations WHERE is_fixture = 0",
  );
  return (row?.c ?? 0) > 0;
}