import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NewsProviderDefinition, ParsedNewsItem } from "../lib/news/types";

// This slice opts into the real embedded SQLite driver and a temp database so
// migration 10 and the persistence path are exercised without touching data/.
const dbPath = path.join(
  process.env.TEMP ?? process.env.TMPDIR ?? "/tmp",
  `fyip-fyp-news-test-${process.pid}.db`,
);
process.env.FYIP_TEST_ENABLE_DB = "1";
process.env.FYIP_DB_PATH = dbPath;

let dbMod: typeof import("../lib/db");
let storeMod: typeof import("../lib/news/store");
let seedMod: typeof import("../lib/news/seed");

const FED: NewsProviderDefinition = {
  key: "federalreserve",
  name: "Federal Reserve",
  kind: "central-bank",
  homepage: "https://www.federalreserve.gov/",
  endpoint: "https://www.federalreserve.gov/feeds/press_all.xml",
  format: "rss",
  intervalSeconds: 600,
  timeoutMs: 9000,
  attribution: "Federal Reserve Board press releases.",
  license: "US federal government material.",
  regionHint: "united-states",
  categoryHint: "central-banks",
  official: true,
  enabledByDefault: true,
};

const GDELT: NewsProviderDefinition = {
  ...FED,
  key: "gdelt",
  name: "GDELT Project",
  kind: "aggregator",
  homepage: "https://www.gdeltproject.org/",
  endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
  format: "gdelt-json",
  official: false,
  categoryHint: null,
  regionHint: "global",
};

function item(overrides: Partial<ParsedNewsItem> = {}): ParsedNewsItem {
  return {
    providerItemId: "db-item-1",
    title: "Federal Reserve issues FOMC statement on rates",
    url: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20261021db.htm",
    summary: "The FOMC kept the target range unchanged and repeated that inflation remains elevated.",
    publishedAt: "2026-10-21T18:00:00.000Z",
    publishedKnown: true,
    sourceUpdatedAt: null,
    publisher: null,
    country: "United States",
    ...overrides,
  };
}

beforeAll(async () => {
  fs.rmSync(dbPath, { force: true });
  [dbMod, storeMod, seedMod] = await Promise.all([
    import("../lib/db"),
    import("../lib/news/store"),
    import("../lib/news/seed"),
  ]);
});

afterAll(() => {
  // The embedded driver keeps the file handle open for the worker lifetime on
  // Windows; the path is pid-scoped under the OS temp directory.
});

describe("FYP NEWS database slice", () => {
  it("applies migration 10 and creates the news engine tables", () => {
    const version = dbMod.queryOne<{ version: number }>(
      "SELECT MAX(version) AS version FROM schema_migrations",
    );
    expect(Number(version?.version)).toBe(10);
    const tables = dbMod.queryAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'news_%'",
    ).map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining([
      "news_stories", "news_story_impacts", "news_saved", "news_settings", "news_ingest_runs",
    ]));
    const sourceColumns = dbMod.queryAll<{ name: string }>("PRAGMA table_info(news_sources)")
      .map((row) => row.name);
    expect(sourceColumns).toEqual(expect.arrayContaining(["endpoint", "interval_seconds", "next_attempt_at", "official"]));
  });

  it("seeds feeds idempotently and preserves an admin disable choice", () => {
    seedMod.seedFypNewsSources();
    const gdelt = storeMod.listNewsSourceHealth().find((source) => source.key === "gdelt");
    expect(gdelt?.enabled).toBe(true);
    expect(gdelt?.endpoint).toContain("api.gdeltproject.org");
    expect(storeMod.getNewsSettings().retentionDays).toBe(30);

    storeMod.setSourceEnabled("gdelt", false);
    seedMod.seedFypNewsSources();
    const after = storeMod.listNewsSourceHealth().find((source) => source.key === "gdelt");
    expect(after?.enabled).toBe(false);

    const unavailable = storeMod.listNewsSourceHealth().find((source) => source.key === "treasury");
    expect(unavailable?.status).toBe("unavailable");
    expect(unavailable?.endpoint).toBeNull();
  });

  it("inserts, deduplicates, clusters and lists stories", () => {
    const inserted = storeMod.processIncomingStory(item(), FED);
    expect(inserted.action).toBe("inserted");
    const id = inserted.storyId!;

    const duplicate = storeMod.processIncomingStory(item(), FED);
    expect(duplicate.action).toBe("duplicate");
    expect(duplicate.storyId).toBe(id);

    const list = storeMod.listNewsStories({}, null);
    expect(list.total).toBe(1);
    expect(list.stories[0].title).toContain("FOMC");
    expect(list.stories[0].publishedKnown).toBe(true);
    expect(list.stories[0].verification).toBe("official");
    expect(list.stories[0].impacts.some((impact) => impact.symbol === "US10Y")).toBe(true);

    const second = storeMod.processIncomingStory(
      item({
        providerItemId: "gdelt-99",
        url: "https://example.com/fed-statement",
        title: "Federal Reserve issues FOMC statement keeping rates unchanged",
        summary: "The Federal Reserve held its policy rate steady; the FOMC statement noted elevated inflation.",
        publishedAt: "2026-10-21T18:05:00.000Z",
      }),
      GDELT,
    );
    expect(["clustered", "merged"]).toContain(second.action);
    const first = storeMod.getNewsStory(id, null);
    expect(first?.clusterSize).toBeGreaterThanOrEqual(2);
  });

  it("saves and unsaves headlines for a user, with saved-only filtering", () => {
    const story = storeMod.listNewsStories({}, null).stories[0];
    expect(storeMod.setStorySaved("usr_test", story.id, true)).toBe(true);
    const saved = storeMod.listNewsStories({ savedOnly: true }, "usr_test");
    expect(saved.total).toBe(1);
    expect(saved.stories[0].saved).toBe(true);
    expect(storeMod.newsCounts("usr_test").saved).toBe(1);

    storeMod.setStorySaved("usr_test", story.id, false);
    expect(storeMod.listNewsStories({ savedOnly: true }, "usr_test").total).toBe(0);
    expect(storeMod.setStorySaved("usr_test", "missing", true)).toBe(false);
  });

  it("updates only recent stories in the stream poll", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const updates = storeMod.storiesUpdatedSince(future, future, null, 10);
    expect(updates).toHaveLength(0);
    const all = storeMod.storiesUpdatedSince("1970-01-01T00:00:00.000Z", "1970-01-01T00:00:00.000Z", null, 10);
    expect(all.length).toBeGreaterThan(0);
  });

  it("prunes old stories and dependent rows", () => {
    const list = storeMod.listNewsStories({}, null);
    const story = list.stories[0];
    storeMod.setStorySaved("usr_test", story.id, true);
    dbMod.execute(
      "UPDATE news_stories SET updated_at = ? WHERE id = ?",
      "2000-01-01T00:00:00.000Z",
      story.id,
    );
    const result = storeMod.pruneNewsStories(7);
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(storeMod.getNewsStory(story.id, "usr_test")).toBeNull();
    expect(dbMod.queryAll("SELECT * FROM news_saved WHERE story_id = ?", story.id)).toHaveLength(0);
  });
});
