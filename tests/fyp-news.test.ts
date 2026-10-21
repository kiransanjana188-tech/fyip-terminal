import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  compareReports,
  jaccardSimilarity,
  normalizeTitle,
} from "../lib/news/dedupe";
import { classify, deriveImpacts, keywordHit } from "../lib/news/taxonomy";
import { cleanText, parseFeedDate, parseGdelt, parseSyndication } from "../lib/news/parse";
import {
  buildNormalizedStory,
  mergeDuplicateStory,
  retryDelayMs,
  sanitizeCustomKeywords,
  verificationFor,
} from "../lib/news/pipeline";
import { mergeNewsStories } from "../lib/news/stream-state";
import type { NewsProviderDefinition, ParsedNewsItem, StorySourceRef } from "../lib/news/types";
import type { NewsStoryDTO } from "../lib/client/types";

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
    providerItemId: "item-1",
    title: "Fed holds rates steady as inflation cools further",
    url: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20261021a.htm",
    summary: "The Federal Open Market Committee kept the target range unchanged and said inflation remains elevated but has eased.",
    publishedAt: "2026-10-21T18:00:00.000Z",
    publishedKnown: true,
    sourceUpdatedAt: null,
    publisher: null,
    country: "United States",
    ...overrides,
  };
}

describe("FYP NEWS dedupe", () => {
  it("canonicalizes URLs and strips tracking parameters", () => {
    const a = canonicalizeUrl("https://WWW.Example.com/a/b/?utm_source=x&b=2&a=1#section");
    const b = canonicalizeUrl("https://www.example.com/a/b?a=1&b=2");
    expect(a).toBe("https://www.example.com/a/b?a=1&b=2");
    expect(a).toBe(b);
  });

  it("rejects non-http URLs", () => {
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
  });

  it("normalizes titles and compares token overlap", () => {
    expect(normalizeTitle("BREAKING: Fed Holds Rates!")).toBe("breaking fed holds rates");
    expect(jaccardSimilarity("Fed holds rates steady", "Fed holds rates steady")).toBe(1);
    expect(jaccardSimilarity("Fed holds rates steady", "Oil rises on supply cuts")).toBeLessThan(0.2);
  });

  it("treats the same canonical URL as a duplicate even across providers", () => {
    const result = compareReports(
      { title: "Different headline", canonicalUrl: "https://x.test/a", contentHash: "h1", publishedAt: null, receivedAt: "2026-10-21T18:00:00Z" },
      { title: "Something else", canonicalUrl: "https://x.test/a", contentHash: "h2", publishedAt: null, receivedAt: "2026-10-21T17:00:00Z" },
    );
    expect(result.kind).toBe("duplicate");
    expect(result.reason).toBe("url");
  });

  it("clusters related headlines but does not merge distinct ones", () => {
    const related = compareReports(
      { title: "Fed holds rates steady after latest inflation data", canonicalUrl: null, contentHash: "a", publishedAt: "2026-10-21T18:00:00Z", receivedAt: "2026-10-21T18:00:00Z" },
      { title: "Fed holds rates steady as inflation data cools", canonicalUrl: null, contentHash: "b", publishedAt: "2026-10-21T17:00:00Z", receivedAt: "2026-10-21T17:00:00Z" },
    );
    expect(["duplicate", "related"]).toContain(related.kind);

    const fresh = compareReports(
      { title: "Oil rises on supply cuts", canonicalUrl: null, contentHash: "c", publishedAt: "2026-10-21T18:00:00Z", receivedAt: "2026-10-21T18:00:00Z" },
      { title: "Fed holds rates steady", canonicalUrl: null, contentHash: "d", publishedAt: "2026-10-21T18:00:00Z", receivedAt: "2026-10-21T18:00:00Z" },
    );
    expect(fresh.kind).toBe("new");
  });
});

describe("FYP NEWS taxonomy", () => {
  it("classifies official central-bank headlines", () => {
    const result = classify({
      title: "Federal Reserve issues FOMC statement",
      summary: "The Committee kept the target range for the federal funds rate unchanged.",
      officialSource: true,
    });
    expect(result.category).toBe("central-banks");
    expect(result.region).toBe("united-states");
    expect(result.impacts.some((impact) => impact.symbol === "US10Y")).toBe(true);
    expect(result.priority).not.toBe("general");
  });

  it("flags severe geopolitical headlines and derives watched channels", () => {
    const result = classify({
      title: "Israel launches military strike on Iran",
      summary: "The escalation threatens shipping through the Strait of Hormuz.",
      officialSource: false,
    });
    expect(result.category).toBe("geopolitics");
    expect(result.region).toBe("middle-east");
    expect(result.isBreaking).toBe(true);
    expect(result.impacts.map((impact) => impact.symbol)).toEqual(expect.arrayContaining(["CL", "GC", "ES"]));
  });

  it("does not mix whole words (ai in said)", () => {
    expect(keywordHit("the official said rates would stay", "ai")).toBe(false);
    expect(keywordHit("new AI chip announced", "ai")).toBe(true);
  });

  it("labels every impact as an interpretation", () => {
    const impacts = deriveImpacts("Gold rises as dollar slips", "gold", "global");
    expect(impacts.length).toBeGreaterThan(0);
    for (const impact of impacts) {
      expect(impact.isInterpretation).toBe(true);
      expect(impact.mechanism.length).toBeGreaterThan(20);
    }
  });

  it("sanitizes admin keywords by category and length", () => {
    const clean = sanitizeCustomKeywords({
      "central-banks": ["  Super  Keyword ", "", 7],
      nope: ["bad"],
      macro: ["x".repeat(100)],
    });
    expect(clean["central-banks"]).toEqual(["super keyword"]);
    expect(clean.macro).toBeUndefined();
    expect(clean).not.toHaveProperty("nope");
  });
});

describe("FYP NEWS feed parsing", () => {
  it("parses RSS without inventing a missing publication time", () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>Test</title>
        <item>
          <title><![CDATA[Fed holds rates steady]]></title>
          <link>https://www.federalreserve.gov/press.htm?utm_campaign=x</link>
          <description>&lt;p&gt;Policy statement &amp;amp; guidance.&lt;/p&gt;</description>
          <guid>abc-1</guid>
          <pubDate>Tue, 21 Oct 2026 18:00:00 GMT</pubDate>
        </item>
        <item><title>No date headline</title><link>https://example.com/no-date</link><description>Body</description></item>
      </channel></rss>`;
    const parsed = parseSyndication(xml, "https://www.federalreserve.gov/", Date.parse("2026-10-21T20:00:00Z"));
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].url).toBe("https://www.federalreserve.gov/press.htm");
    expect(parsed.items[0].publishedAt).toBe("2026-10-21T18:00:00.000Z");
    expect(parsed.items[0].summary).toBe("Policy statement & guidance.");
    expect(parsed.items[1].publishedKnown).toBe(false);
    expect(parsed.items[1].publishedAt).toBeNull();
  });

  it("parses RSS 1.0 RDF feeds with channel and item siblings", () => {
    const xml = `<?xml version="1.0"?>
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel rdf:about="https://www.bankofcanada.ca/feed/"><title>Press Releases - Bank of Canada</title></channel>
        <item rdf:about="https://www.bankofcanada.ca/2026/10/press-release/">
          <title>Bank of Canada maintains policy rate</title>
          <link>https://www.bankofcanada.ca/2026/10/press-release/</link>
          <description>Policy rate remains unchanged.</description>
          <dc:date>2026-10-21T14:00:00Z</dc:date>
        </item>
      </rdf:RDF>`;
    const parsed = parseSyndication(xml, "https://www.bankofcanada.ca/", Date.parse("2026-10-21T20:00:00Z"));
    expect(parsed.feedTitle).toBe("Press Releases - Bank of Canada");
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].url).toBe("https://www.bankofcanada.ca/2026/10/press-release");
    expect(parsed.items[0].publishedAt).toBe("2026-10-21T14:00:00.000Z");
  });

  it("parses Atom links and summaries", () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom"><title>Filings</title>
        <entry>
          <id>urn:test:1</id>
          <title>Company reports material event</title>
          <link rel="alternate" href="https://www.sec.gov/Archives/x.htm"/>
          <summary>Item 2.02 results of operations.</summary>
          <published>2026-10-21T12:30:00Z</published>
          <updated>2026-10-21T12:31:00Z</updated>
        </entry>
      </feed>`;
    const parsed = parseSyndication(xml, "https://www.sec.gov/");
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].url).toBe("https://www.sec.gov/Archives/x.htm");
    expect(parsed.items[0].sourceUpdatedAt).toBe("2026-10-21T12:31:00.000Z");
  });

  it("treats GDELT seendate as observation time, not publication time", () => {
    const json = JSON.stringify({
      articles: [
        {
          url: "https://example.com/story",
          title: "Markets rally on trade truce reports",
          seendate: "20261021T071500Z",
          domain: "example.com",
          sourcecountry: "United States",
        },
      ],
    });
    const parsed = parseGdelt(json);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].publishedAt).toBeNull();
    expect(parsed.items[0].publishedKnown).toBe(false);
    expect(parsed.items[0].sourceUpdatedAt).toBe("2026-10-21T07:15:00.000Z");
  });

  it("rejects implausible or future dates instead of guessing", () => {
    expect(parseFeedDate("not a date")).toEqual({ iso: null, known: false });
    expect(parseFeedDate("Tue, 21 Oct 2099 18:00:00 GMT").known).toBe(false);
    expect(parseFeedDate("1980-01-01T00:00:00Z").known).toBe(false);
  });

  it("cleans HTML safely", () => {
    expect(cleanText("<p>Hello &amp; <b>world</b></p><script>alert(1)</script>")).toBe("Hello & world");
  });
});

describe("FYP NEWS pipeline", () => {
  it("builds a normalized story with honest timestamps and source metadata", () => {
    const story = buildNormalizedStory({ item: item(), provider: FED, now: new Date("2026-10-21T20:00:00Z") });
    expect(story.publishedKnown).toBe(true);
    expect(story.receivedAt).toBe("2026-10-21T20:00:00.000Z");
    expect(story.verification).toBe("official");
    expect(story.sourceCount).toBe(1);
    expect(story.sources[0].official).toBe(true);
    expect(story.clusterId).toBe(story.id);
    expect(story.isFixture).toBe(false);
  });

  it("never upgrades uncertain language to official confirmation", () => {
    const story = buildNormalizedStory({
      item: item({ title: "Reportedly Fed considering emergency rate action", summary: "Sources say a move is possible." }),
      provider: FED,
    });
    expect(story.verification).toBe("unverified");
  });

  it("counts independent providers, not repeated reports from one provider", () => {
    const official: StorySourceRef[] = [{ providerKey: "federalreserve", sourceName: "Fed", url: null, publishedAt: null, receivedAt: "2026-10-21T20:00:00Z", official: true }];
    const one: StorySourceRef[] = [{ ...official[0], providerKey: "gdelt", official: false }];
    const two = [...one, { ...official[0], providerKey: "ecb", official: false }];
    const three = [...two, { ...official[0], providerKey: "boe", official: false }];
    expect(verificationFor(one, "Fed statement")).toBe("single-source");
    expect(verificationFor(two, "Fed statement")).toBe("multi-source");
    expect(verificationFor(three, "Fed statement")).toBe("corroborated");
    expect(verificationFor(two, "Reportedly considers a move")).toBe("unverified");
  });

  it("merges duplicate reports without changing the original headline", () => {
    const now = new Date("2026-10-21T20:05:00Z");
    const existing = buildNormalizedStory({ item: item(), provider: FED, now: new Date("2026-10-21T20:00:00Z") });
    const incoming = item({
      providerItemId: "gdelt-1",
      url: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20261021a.htm?utm_source=gdelt",
      title: existing.title,
      summary: existing.summary,
    });
    const merge = mergeDuplicateStory(existing, incoming, GDELT, now);
    expect(merge.changed).toBe(true);
    expect(merge.patch.sourceCount).toBe(2);
    expect(merge.patch.sources.map((source) => source.providerKey)).toEqual(["federalreserve", "gdelt"]);
    expect(merge.patch.verification).toBe("official");
    expect(merge.patch.summary).toBe(existing.summary);
  });

  it("backs off with a cap and respects Retry-After", () => {
    expect(retryDelayMs(0, 600_000)).toBe(600_000);
    expect(retryDelayMs(2, 600_000, null, 3_000_000)).toBe(2_400_000);
    expect(retryDelayMs(20, 600_000)).toBe(1_800_000);
    expect(retryDelayMs(0, 600_000, 900)).toBe(900_000);
  });
});

describe("FYP NEWS stream state", () => {
  function dto(id: string, receivedAt: string, urgency = 50): NewsStoryDTO {
    return {
      id,
      providerKey: "fed",
      providerItemId: id,
      sourceName: "Fed",
      sourceHomepage: null,
      url: null,
      canonicalUrl: null,
      title: id,
      summary: null,
      publishedAt: null,
      publishedKnown: false,
      sourceUpdatedAt: null,
      receivedAt,
      ingestedAt: receivedAt,
      updatedAt: receivedAt,
      country: null,
      region: "global",
      category: "general",
      subcategory: null,
      entities: [],
      keywords: [],
      assetClasses: [],
      symbols: [],
      urgency,
      relevance: 50,
      priority: "general",
      verification: "single-source",
      sourceCount: 1,
      sources: [],
      clusterId: id,
      status: "new",
      isBreaking: false,
      contentHash: id,
      dedupeKey: id,
      attribution: "",
      license: "",
      isFixture: false,
      impacts: [],
      saved: false,
      clusterSize: 1,
    };
  }

  it("deduplicates updates by id and keeps newest received first", () => {
    const current = [dto("a", "2026-10-21T18:00:00Z"), dto("b", "2026-10-21T19:00:00Z")];
    const updated = mergeNewsStories(current, [{ ...dto("a", "2026-10-21T18:00:00Z"), title: "A updated" }]);
    expect(updated.map((story) => story.id)).toEqual(["b", "a"]);
    expect(updated.find((story) => story.id === "a")?.title).toBe("A updated");
  });

  it("caps the retained feed", () => {
    const current = Array.from({ length: 5 }, (_, index) => dto(`s${index}`, `2026-10-21T1${index}:00:00Z`));
    expect(mergeNewsStories(current, [], 3)).toHaveLength(3);
    expect(mergeNewsStories(current, [dto("new", "2026-10-21T20:00:00Z")], 3)).toHaveLength(3);
  });
});
