"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPatch, ApiError } from "@/lib/client/api";
import type { NewsAdminDTO, NewsSourceHealthDTO } from "@/lib/client/types";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/lib/news/taxonomy";
import { cn, dateTime } from "@/lib/utils";
import { Loading } from "@/components/ui/States";
import { SourceStatusDot } from "./NewsBadges";

interface DraftSource {
  enabled: boolean;
  intervalSeconds: number;
}

export function NewsAdmin({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (sources: NewsSourceHealthDTO[], ai: NewsAdminDTO["ai"]) => void;
}) {
  const [data, setData] = useState<NewsAdminDTO | null>(null);
  const [draft, setDraft] = useState<Record<string, DraftSource>>({});
  const [retention, setRetention] = useState(30);
  const [collectionEnabled, setCollectionEnabled] = useState(true);
  const [keywords, setKeywords] = useState<Record<string, string[]>>({});
  const [keywordCategory, setKeywordCategory] = useState<string>(CATEGORY_ORDER[0]);
  const [keywordText, setKeywordText] = useState("");
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    apiGet<NewsAdminDTO>("/news/settings")
      .then((payload) => {
        setData(payload);
        setRetention(payload.settings.retentionDays);
        setCollectionEnabled(payload.settings.collectionEnabled);
        setKeywords({ ...payload.settings.customKeywords });
        setKeywordError(null);
        const next: Record<string, DraftSource> = {};
        for (const source of payload.sources) {
          next[source.key] = { enabled: source.enabled, intervalSeconds: source.intervalSeconds };
        }
        setDraft(next);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load news settings."))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function addKeyword() {
    const keyword = keywordText.trim().toLowerCase().replace(/\s+/g, " ");
    if (keyword.length < 2 || keyword.length > 40) {
      setKeywordError("Keywords must be 2-40 characters.");
      return;
    }
    const current = keywords[keywordCategory] ?? [];
    if (current.includes(keyword)) {
      setKeywordError("That keyword is already in this category.");
      return;
    }
    if (current.length >= 10) {
      setKeywordError("Maximum 10 keywords per category.");
      return;
    }
    setKeywords({ ...keywords, [keywordCategory]: [...current, keyword] });
    setKeywordText("");
    setKeywordError(null);
  }

  function removeKeyword(category: string, keyword: string) {
    const next = (keywords[category] ?? []).filter((item) => item !== keyword);
    const copy = { ...keywords };
    if (next.length) copy[category] = next;
    else delete copy[category];
    setKeywords(copy);
    setKeywordError(null);
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiPatch<NewsAdminDTO>("/news/settings", {
        retentionDays: retention,
        collectionEnabled,
        customKeywords: keywords,
        sources: data.sources.map((source) => ({
          key: source.key,
          enabled: draft[source.key]?.enabled ?? source.enabled,
          intervalSeconds: draft[source.key]?.intervalSeconds ?? source.intervalSeconds,
        })),
      });
      setData(payload);
      setNotice("Settings saved. Source health will update after the next collection.");
      onSaved(payload.sources, payload.ai);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save news settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col border border-line-2 bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-3 py-2">
          <span className="font-mono text-2xs uppercase tracking-widest text-amber">FYP NEWS Administration</span>
          <button onClick={onClose} className="ml-auto font-mono text-3xs uppercase tracking-wider text-ink-faint hover:text-down">
            CLOSE
          </button>
        </div>

        {loading ? (
          <Loading label="Loading source registry" />
        ) : !data ? (
          <div className="p-4 text-xs text-down">{error ?? "Settings unavailable."}</div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <div className="grid gap-2 border border-line bg-panel-2 p-2 sm:grid-cols-3">
                <label className="flex items-center gap-2 text-xs text-ink-dim">
                  <input
                    type="checkbox"
                    checked={collectionEnabled}
                    onChange={(event) => setCollectionEnabled(event.target.checked)}
                    className="accent-amber"
                  />
                  Enable collection
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-dim">
                  Retention days
                  <input
                    type="number"
                    min={7}
                    max={365}
                    value={retention}
                    onChange={(event) => setRetention(Number(event.target.value))}
                    className="w-20 border border-line-2 bg-panel px-1.5 py-0.5 font-mono text-xs text-ink"
                  />
                </label>
                <div className="font-mono text-3xs uppercase tracking-wider text-ink-faint">
                  AI: {data.ai.enabled ? data.ai.model : "not configured"}
                </div>
              </div>

              <p className="text-3xs leading-relaxed text-ink-faint">{data.policy.note}</p>

              <div className="border border-line bg-panel-2 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-3xs uppercase tracking-widest text-ink-faint">Custom classification keywords</span>
                  <span className="font-mono text-3xs text-ink-faint">max 10 per category / applied to new stories</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <select
                    value={keywordCategory}
                    onChange={(event) => setKeywordCategory(event.target.value)}
                    className="border border-line-2 bg-panel px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wider text-ink-dim"
                    aria-label="Keyword category"
                  >
                    {CATEGORY_ORDER.map((key) => (
                      <option key={key} value={key}>{CATEGORY_LABEL[key]}</option>
                    ))}
                  </select>
                  <input
                    value={keywordText}
                    onChange={(event) => setKeywordText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addKeyword();
                      }
                    }}
                    placeholder="e.g. repo facility, export ban"
                    maxLength={40}
                    className="min-w-[160px] flex-1 border border-line-2 bg-panel px-1.5 py-0.5 font-mono text-3xs text-ink placeholder:text-ink-faint focus:border-amber"
                    aria-label="New keyword"
                  />
                  <button
                    type="button"
                    onClick={addKeyword}
                    className="border border-line-2 bg-panel px-2 py-0.5 font-mono text-3xs uppercase tracking-wider text-ink-dim hover:border-amber hover:text-amber"
                  >
                    Add
                  </button>
                </div>
                {keywordError && <p className="mt-1 text-3xs text-down">{keywordError}</p>}
                <div className="mt-1.5 space-y-1">
                  {CATEGORY_ORDER.filter((key) => (keywords[key]?.length ?? 0) > 0).map((key) => (
                    <div key={key} className="flex flex-wrap items-center gap-1">
                      <span className="font-mono text-3xs uppercase tracking-wider text-ink-faint">{CATEGORY_LABEL[key]}</span>
                      {(keywords[key] ?? []).map((keyword) => (
                        <button
                          key={keyword}
                          type="button"
                          onClick={() => removeKeyword(key, keyword)}
                          className="border border-line-2 bg-panel px-1.5 py-[1px] font-mono text-3xs text-ink-dim hover:border-down hover:text-down"
                          title={`Remove "${keyword}"`}
                        >
                          {keyword} x
                        </button>
                      ))}
                    </div>
                  ))}
                  {Object.keys(keywords).length === 0 && (
                    <p className="text-3xs text-ink-faint">No custom keywords. Rule-based classification still runs.</p>
                  )}
                </div>
              </div>

              <div className="border border-line">
                <div className="grid grid-cols-[auto_minmax(0,1fr)_5rem_7rem_auto] items-center gap-2 border-b border-line bg-panel-2 px-2 py-1 font-mono text-3xs uppercase tracking-widest text-ink-faint">
                  <span>ON</span>
                  <span>Registered source</span>
                  <span>Interval</span>
                  <span>Last success</span>
                  <span>Status</span>
                </div>
                {data.sources.map((source) => {
                  const value = draft[source.key] ?? { enabled: source.enabled, intervalSeconds: source.intervalSeconds };
                  const unavailable = !source.endpoint;
                  return (
                    <div key={source.key} className="border-b border-line/70 px-2 py-1.5 last:border-b-0">
                      <div className="grid grid-cols-[auto_minmax(0,1fr)_5rem_7rem_auto] items-center gap-2">
                        <input
                          type="checkbox"
                          checked={value.enabled}
                          disabled={unavailable}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              [source.key]: { ...value, enabled: event.target.checked },
                            }))
                          }
                          className="accent-amber disabled:opacity-30"
                          title={unavailable ? source.unavailableReason ?? "No verified endpoint" : undefined}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs text-ink">{source.name}</span>
                            <span className="font-mono text-3xs uppercase text-ink-faint">{source.key}</span>
                            {source.official && <span className="font-mono text-3xs text-up">OFFICIAL</span>}
                          </div>
                          <div className="truncate font-mono text-3xs text-ink-faint" title={source.endpoint ?? undefined}>
                            {source.endpoint ?? "no machine-readable endpoint - HTML is not scraped"}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={120}
                            max={21600}
                            step={60}
                            value={value.intervalSeconds}
                            onChange={(event) =>
                              setDraft((prev) => ({
                                ...prev,
                                [source.key]: { ...value, intervalSeconds: Number(event.target.value) },
                              }))
                            }
                            className="w-16 border border-line-2 bg-panel px-1 py-0.5 font-mono text-3xs text-ink"
                          />
                          <span className="font-mono text-3xs text-ink-faint">s</span>
                        </div>
                        <div className="font-mono text-3xs text-ink-faint">
                          {source.lastSuccessAt ? dateTime(source.lastSuccessAt) : "never"}
                        </div>
                        <div className="flex items-center gap-1">
                          <SourceStatusDot status={source.status} />
                          <span className={cn("font-mono text-3xs uppercase", source.status === "error" ? "text-down" : "text-ink-faint")}>
                            {source.status}
                          </span>
                        </div>
                      </div>
                      {(source.lastError || source.unavailableReason) && (
                        <p className="mt-0.5 pl-6 text-3xs text-ink-faint">{source.lastError ?? source.unavailableReason}</p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="border border-line bg-panel-2 p-2 text-3xs leading-relaxed text-ink-faint">
                <p>{data.ai.reason ?? `Optional AI summarization is configured with ${data.ai.model}.`}</p>
                <p className="mt-1">
                  Endpoints are fixed by the code registry and allowlist. This prevents SSRF and keeps provider licensing auditable; administrators cannot point FYIP at
                  arbitrary URLs. Unavailable providers are shown instead of scraped.
                </p>
                <p className="mt-1">
                  On Netlify, collection is request/stream-triggered because this deployment has no always-on scheduler. Intervals are minimum gaps, not guaranteed execution times.
                </p>
              </div>

              {error && <p className="border border-down/40 bg-down/5 px-2 py-1 text-xs text-down">{error}</p>}
              {notice && <p className="border border-up/40 bg-up/5 px-2 py-1 text-xs text-up">{notice}</p>}
            </div>

            <div className="flex items-center gap-2 border-t border-line bg-panel-2 px-3 py-2">
              <button
                onClick={save}
                disabled={saving}
                className="border border-amber/50 bg-amber/10 px-3 py-1 font-mono text-3xs uppercase tracking-wider text-amber hover:bg-amber/20 disabled:opacity-50"
              >
                {saving ? "Saving" : "Save changes"}
              </button>
              <button
                onClick={onClose}
                className="border border-line-2 bg-panel px-3 py-1 font-mono text-3xs uppercase tracking-wider text-ink-faint hover:text-ink"
              >
                Close
              </button>
              <span className="ml-auto font-mono text-3xs uppercase tracking-wider text-ink-faint">
                retention {retention}d / {collectionEnabled ? "collection on" : "collection off"}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
