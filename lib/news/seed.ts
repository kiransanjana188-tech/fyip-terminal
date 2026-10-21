import { execute } from "@/lib/db";
import { NEWS_PROVIDERS } from "./providers";
import { DEFAULT_NEWS_SETTINGS } from "./store";

/**
 * Idempotent registry seeding.
 *
 * An admin's enable/disable choice and polling interval survive restarts. A
 * previously unsupported source (endpoint was NULL) is enabled once when the
 * adapter first ships.
 */
export function seedFypNewsSources(): void {
  for (const provider of NEWS_PROVIDERS) {
    const enabledByDefault = provider.endpoint && provider.enabledByDefault ? 1 : 0;
    execute(
      `INSERT INTO news_sources (
         id, key, name, kind, homepage, licensed, enabled, notes, endpoint, format,
         interval_seconds, attribution, license, region_hint, category_hint, official, unavailable_reason
       ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind,
         homepage = excluded.homepage,
         notes = excluded.notes,
         endpoint = excluded.endpoint,
         format = excluded.format,
         attribution = excluded.attribution,
         license = excluded.license,
         region_hint = excluded.region_hint,
         category_hint = excluded.category_hint,
         official = excluded.official,
         unavailable_reason = excluded.unavailable_reason,
         interval_seconds = CASE WHEN news_sources.endpoint IS NULL THEN excluded.interval_seconds ELSE news_sources.interval_seconds END,
         enabled = CASE WHEN news_sources.endpoint IS NULL THEN excluded.enabled ELSE news_sources.enabled END`,
      `src_${provider.key}`,
      provider.key,
      provider.name,
      provider.kind,
      provider.homepage,
      enabledByDefault,
      provider.unavailableReason ?? provider.attribution,
      provider.endpoint,
      provider.format,
      provider.intervalSeconds,
      provider.attribution,
      provider.license,
      provider.regionHint,
      provider.categoryHint,
      provider.official ? 1 : 0,
      provider.unavailableReason ?? null,
    );
  }

  const now = new Date().toISOString();
  const defaults: [string, string][] = [
    ["retention_days", String(DEFAULT_NEWS_SETTINGS.retentionDays)],
    ["collection_enabled", DEFAULT_NEWS_SETTINGS.collectionEnabled ? "1" : "0"],
    ["custom_keywords", JSON.stringify(DEFAULT_NEWS_SETTINGS.customKeywords)],
  ];
  for (const [key, value] of defaults) {
    execute(
      "INSERT INTO news_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING",
      key,
      value,
      now,
    );
  }
}
