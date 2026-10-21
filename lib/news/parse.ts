import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { ParsedFeed, ParsedNewsItem } from "./types";
import { canonicalizeUrl } from "./dedupe";

/**
 * Server-side feed parsers. These only transform what the provider actually
 * published. Missing dates stay missing; GDELT "seendate" is treated as an
 * observation time, not a publication time.
 */

type XmlNode = string | number | boolean | null | undefined | XmlObject | XmlNode[];
interface XmlObject {
  [key: string]: XmlNode;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: false,
  processEntities: true,
  allowBooleanAttributes: true,
});

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function nodeText(value: XmlNode): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(nodeText).join(" ");
  const object = value as XmlObject;
  const candidates = ["#text", "__cdata", "_", "value"];
  for (const key of candidates) {
    if (object[key] !== undefined) return nodeText(object[key]);
  }
  return "";
}

function firstText(object: XmlObject, keys: string[]): string {
  for (const key of keys) {
    if (object[key] === undefined) continue;
    const value = nodeText(object[key]);
    if (value.trim()) return value.trim();
  }
  return "";
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-",
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', hellip: "...", bull: " ", middot: " ",
  eacute: "e", egrave: "e", agrave: "a", ccedil: "c", uuml: "u", ouml: "o", auml: "a",
  copy: "(c)", reg: "(r)", trade: "(tm)", euro: "EUR", pound: "GBP", yen: "JPY",
};

export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function cleanText(input: string | null | undefined, maxLength = 700): string | null {
  if (!input) return null;
  let text = input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  text = decodeHtmlEntities(text);
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export interface ParsedDate {
  iso: string | null;
  known: boolean;
}

/**
 * Parse common feed date formats without guessing. Returns known=false when
 * the value is absent, implausible, or not a publication timestamp.
 */
export function parseFeedDate(raw: string | null | undefined, now = Date.now()): ParsedDate {
  if (!raw) return { iso: null, known: false };
  const value = raw.trim();
  if (!value) return { iso: null, known: false };

  // GDELT compact timestamp (observed time, caller handles semantics).
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  let ms: number;
  if (compact) {
    ms = Date.UTC(
      Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]),
      Number(compact[4]), Number(compact[5]), Number(compact[6]),
    );
  } else {
    ms = Date.parse(value);
    if (!Number.isFinite(ms)) {
      // Fallback for "20 Oct 2026 12:00:00" style strings missing a timezone:
      // only accept if Date.parse of the normalized GMT form is valid.
      const monthMatch = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
      if (monthMatch) {
        const month = MONTHS[monthMatch[2].toLowerCase()];
        if (month !== undefined) {
          ms = Date.UTC(
            Number(monthMatch[3]), month, Number(monthMatch[1]),
            Number(monthMatch[4]), Number(monthMatch[5]), Number(monthMatch[6] ?? 0),
          );
        }
      }
    }
  }

  if (!Number.isFinite(ms)) return { iso: null, known: false };
  if (ms < Date.UTC(1990, 0, 1)) return { iso: null, known: false };
  // Allow small clock skew, but never present a far-future date as published.
  if (ms > now + 6 * 3_600_000) return { iso: null, known: false };
  return { iso: new Date(ms).toISOString(), known: true };
}

function resolveUrl(raw: string, base?: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return canonicalizeUrl(trimmed, base);
}

function extractLink(node: XmlNode, base?: string): string | null {
  if (!node) return null;
  if (typeof node === "string") return resolveUrl(node, base);
  if (Array.isArray(node)) {
    for (const entry of node) {
      const href = extractLink(entry, base);
      if (href) return href;
    }
    return null;
  }
  const object = node as XmlObject;
  const rel = typeof object["@_rel"] === "string" ? object["@_rel"] : "";
  const href = object["@_href"] ?? object["@_url"];
  if (href !== undefined && rel !== "self" && rel !== "edit") return resolveUrl(nodeText(href), base);
  const text = nodeText(object);
  if (text && text !== "[object Object]") return resolveUrl(text, base);
  return null;
}

function hashId(...parts: (string | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((p) => p ?? "").join("|")).digest("hex").slice(0, 24);
}

function buildItem(input: {
  providerItemId?: string | null;
  title: string;
  url: string | null;
  summary: string | null;
  publishedRaw?: string | null;
  updatedRaw?: string | null;
  publisher?: string | null;
  country?: string | null;
}, now: number): ParsedNewsItem | null {
  const title = cleanText(input.title, 320);
  if (!title || title.length < 8) return null;
  const published = parseFeedDate(input.publishedRaw, now);
  const updated = parseFeedDate(input.updatedRaw, now);
  return {
    providerItemId: input.providerItemId?.trim() || (input.url ? hashId(input.url) : hashId(title, input.publishedRaw)),
    title,
    url: input.url,
    summary: cleanText(input.summary),
    publishedAt: published.iso,
    publishedKnown: published.known,
    sourceUpdatedAt: updated.iso,
    publisher: input.publisher?.trim() || null,
    country: input.country?.trim() || null,
  };
}

export function parseSyndication(xml: string, baseUrl: string, now = Date.now()): ParsedFeed {
  const doc = parser.parse(xml) as XmlObject;
  const items: ParsedNewsItem[] = [];
  let skipped = 0;
  let feedTitle: string | null = null;
  let feedUpdatedAt: string | null = null;

  const rss = doc.rss as XmlObject | undefined;
  // RSS 1.0 (RDF) is still used by several central banks: channel metadata
  // and items are siblings under the rdf:RDF root.
  const rdf = doc["rdf:RDF"] as XmlObject | undefined;
  const channel = (rss?.channel ?? rdf?.channel ?? doc.channel) as XmlObject | undefined;
  const feed = doc.feed as XmlObject | undefined;
  const channelItems = channel?.item ?? rdf?.item;

  if (channel) {
    feedTitle = firstText(channel, ["title"]) || null;
    const updated = parseFeedDate(firstText(channel, ["lastBuildDate", "pubDate", "dc:date"]), now);
    feedUpdatedAt = updated.iso;
    for (const entry of asArray(channelItems as XmlNode)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const item = entry as XmlObject;
      const title = firstText(item, ["title"]);
      const link = extractLink(item.link as XmlNode, baseUrl);
      const guid = firstText(item, ["guid", "id"]);
      const built = buildItem(
        {
          providerItemId: guid || link,
          title,
          url: link,
          summary: firstText(item, ["description", "summary", "content:encoded", "content"]),
          publishedRaw: firstText(item, ["pubDate", "published", "dc:date", "date"]),
          updatedRaw: firstText(item, ["updated", "lastBuildDate"]),
          publisher: firstText(item, ["source", "dc:creator", "author"]),
        },
        now,
      );
      if (built) items.push(built);
      else skipped += 1;
    }
  } else if (feed) {
    feedTitle = firstText(feed, ["title"]) || null;
    const updated = parseFeedDate(firstText(feed, ["updated"]), now);
    feedUpdatedAt = updated.iso;
    for (const entry of asArray(feed.entry as XmlNode)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const item = entry as XmlObject;
      const title = firstText(item, ["title"]);
      const link = extractLink(item.link as XmlNode, baseUrl);
      const built = buildItem(
        {
          providerItemId: firstText(item, ["id"]) || link,
          title,
          url: link,
          summary: firstText(item, ["summary", "content"]),
          publishedRaw: firstText(item, ["published", "issued", "created"]),
          updatedRaw: firstText(item, ["updated", "modified"]),
          publisher: firstText(item, ["author", "source"]),
        },
        now,
      );
      if (built) items.push(built);
      else skipped += 1;
    }
  } else {
    throw new Error("Unrecognized feed format (expected RSS or Atom)");
  }

  return { items, feedTitle, feedUpdatedAt, skipped };
}

/** GDELT DOC 2.0 article list (JSON). */
export function parseGdelt(text: string, now = Date.now()): ParsedFeed {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("GDELT returned invalid JSON (possibly rate-limited)");
  }
  const object = data as { articles?: unknown; error?: string };
  if (object.error) throw new Error(`GDELT error: ${object.error.slice(0, 160)}`);
  const articles = asArray(object.articles as Record<string, unknown>[] | undefined);
  const items: ParsedNewsItem[] = [];
  let skipped = 0;

  for (const article of articles) {
    if (!article || typeof article !== "object") continue;
    const url = typeof article.url === "string" ? article.url : "";
    if (!url) {
      skipped += 1;
      continue;
    }
    // seendate is when GDELT saw the article. It is NOT a publication time,
    // so it is stored as sourceUpdatedAt and publishedAt stays unknown.
    const seen = typeof article.seendate === "string" ? parseFeedDate(article.seendate, now) : { iso: null, known: false };
    const built = buildItem(
      {
        providerItemId: url,
        title: typeof article.title === "string" ? article.title : "",
        url,
        summary: null,
        publishedRaw: null,
        updatedRaw: seen.iso,
        publisher: typeof article.domain === "string" ? article.domain : null,
        country: typeof article.sourcecountry === "string" ? article.sourcecountry : null,
      },
      now,
    );
    if (built) items.push(built);
    else skipped += 1;
  }

  return { items, feedTitle: "GDELT DOC 2.0", feedUpdatedAt: null, skipped };
}

export function isAllowedArticleUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

export function feedItemsFingerprint(items: ParsedNewsItem[]): string {
  return createHash("sha256")
    .update(items.map((item) => item.providerItemId).sort().join("|"))
    .digest("hex")
    .slice(0, 32);
}
