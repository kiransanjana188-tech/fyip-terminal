"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn, shortTime } from "@/lib/utils";

const CONTAINER_ID = "financialjuice-news-widget-container";
const SCRIPT_ID = "fyip-financialjuice-widgets-script";
const SCRIPT_SRC = "https://feed.financialjuice.com/widgets/widgets.js";
const PROVIDER_URL = "https://www.financialjuice.com/";
const LOAD_TIMEOUT_MS = 20_000;

type WidgetStatus = "loading" | "unknown" | "available" | "unavailable";

interface WidgetOptions {
  container: string;
  height: string;
  width: string;
  mode: string;
  backColor: string;
  fontColor: string;
  widgetType: string;
}

declare global {
  interface Window {
    FJWidgets?: {
      createWidget: (options: WidgetOptions) => void;
    };
  }
}

const STATUS_META: Record<
  WidgetStatus,
  { label: string; tone: string; dot: string; title: string }
> = {
  loading: {
    label: "LOADING",
    tone: "border-info/40 bg-info/10 text-info",
    dot: "bg-info animate-blink",
    title: "The official FinancialJuice widget helper and iframe are loading.",
  },
  unknown: {
    label: "INITIALISING",
    tone: "border-warn/40 bg-warn/10 text-warn",
    dot: "bg-warn",
    title: "The embed helper is ready, but the provider iframe has not confirmed load yet.",
  },
  available: {
    label: "AVAILABLE / EMBED",
    tone: "border-up/40 bg-up/10 text-up",
    dot: "bg-up",
    title: "The official iframe document loaded. This is not proof that the provider feed is live; FinancialJuice controls headline freshness and availability.",
  },
  unavailable: {
    label: "UNAVAILABLE",
    tone: "border-down/40 bg-down/10 text-down",
    dot: "bg-down",
    title: "The official embed did not load. The provider may be blocked by the network, browser privacy settings, or its own restrictions.",
  },
};

export function FinancialJuiceWidget() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<WidgetStatus>("loading");
  const [detail, setDetail] = useState("Loading the official FinancialJuice headline embed.");
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let timeoutId: number | null = null;
    let observer: MutationObserver | null = null;
    let script: HTMLScriptElement | null = null;
    let iframe: HTMLIFrameElement | null = null;

    setStatus("loading");
    setDetail("Loading the official FinancialJuice headline embed.");
    setLoadedAt(null);
    container.replaceChildren();

    const fail = (message: string) => {
      if (cancelled) return;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      setStatus("unavailable");
      setDetail(message);
    };

    const handleIframeLoad = () => {
      if (cancelled) return;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      setStatus("available");
      setDetail(
        "The official embed loaded. Headline freshness and availability are controlled by FinancialJuice; FYIP cannot inspect cross-origin content.",
      );
      setLoadedAt(new Date().toISOString());
    };

    const bindIframe = () => {
      const next = container.querySelector("iframe");
      if (!next || next === iframe) return;
      iframe = next;
      next.title = "FinancialJuice headlines";
      next.setAttribute("loading", "eager");
      next.style.width = "100%";
      next.style.height = "100%";
      next.style.border = "0";
      next.style.display = "block";
      next.addEventListener("load", handleIframeLoad);
    };

    const createWidget = () => {
      if (cancelled) return;
      const api = window.FJWidgets;
      if (!api?.createWidget) {
        fail("The FinancialJuice widget helper loaded but did not expose its widget API.");
        return;
      }

      setStatus("unknown");
      setDetail("The embed helper is ready; waiting for the provider iframe to finish loading.");

      try {
        api.createWidget({
          container: CONTAINER_ID,
          height: "100%",
          width: "100%",
          mode: "Dark",
          backColor: "1e222d",
          fontColor: "b2b5be",
          widgetType: "NEWS",
        });
      } catch {
        fail("The official FinancialJuice widget could not be created.");
        return;
      }

      bindIframe();
    };

    observer = new MutationObserver(bindIframe);
    observer.observe(container, { childList: true, subtree: true });

    timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      fail(
        iframe
          ? "The FinancialJuice iframe did not finish loading in time. It may be blocked by the network, privacy settings, or the provider."
          : "The FinancialJuice widget did not initialise in time. It may be blocked by the network, privacy settings, or the provider.",
      );
    }, LOAD_TIMEOUT_MS);

    if (window.FJWidgets) {
      createWidget();
    } else {
      const previous = document.getElementById(SCRIPT_ID);
      previous?.remove();

      const handleScriptError = () => {
        fail("The official FinancialJuice widget script could not be loaded.");
      };

      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = `${SCRIPT_SRC}?r=${Date.now()}`;
      script.async = true;
      script.addEventListener("load", createWidget);
      script.addEventListener("error", handleScriptError);
      document.head.appendChild(script);

      const currentScript = script;
      return () => {
        cancelled = true;
        observer?.disconnect();
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        iframe?.removeEventListener("load", handleIframeLoad);
        currentScript.removeEventListener("load", createWidget);
        currentScript.removeEventListener("error", handleScriptError);
        currentScript.remove();
        container.replaceChildren();
      };
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      iframe?.removeEventListener("load", handleIframeLoad);
      container.replaceChildren();
    };
  }, [attempt]);

  const meta = STATUS_META[status];

  return (
    <div className="flex h-[38rem] flex-col border border-line bg-panel xl:h-full xl:min-h-0">
      <header className="shrink-0 border-b border-line bg-panel-2">
        <div className="flex flex-wrap items-start gap-2 px-2.5 py-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-amber">FYP NEWS</h1>
              <span className="border border-line-2 bg-panel px-1.5 py-[1px] font-mono text-3xs uppercase tracking-widest text-ink-faint">
                FinancialJuice / Official Embed
              </span>
            </div>
            <p className="mt-0.5 hidden text-3xs text-ink-faint sm:block">
              Provider headlines in the FYIP workspace. Surrounding terminal UI is FYIP; headline content belongs to FinancialJuice.
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "flex items-center gap-1 border px-1.5 py-[2px] font-mono text-3xs uppercase tracking-wider",
                meta.tone,
              )}
              title={meta.title}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
              {meta.label}
            </span>
            {loadedAt && (
              <span className="hidden font-mono text-3xs uppercase tracking-wider text-ink-faint sm:inline">
                iframe loaded {shortTime(loadedAt)}
              </span>
            )}
            <button
              onClick={retry}
              className="border border-line-2 bg-panel px-2 py-1 font-mono text-3xs uppercase tracking-wider text-ink-dim hover:border-amber hover:text-amber"
              title="Reload the official FinancialJuice embed"
            >
              RELOAD
            </button>
            <a
              href={PROVIDER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="border border-line-2 bg-panel px-2 py-1 font-mono text-3xs uppercase tracking-wider text-ink-dim hover:border-amber hover:text-amber"
            >
              financialjuice.com ↗
            </a>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-2.5 py-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">
          <span>SOURCE <b className="text-ink">FINANCIALJUICE</b></span>
          <span>MODE <b className="text-ink">DARK</b></span>
          <span className="hidden sm:inline">ATTRIBUTION <b className="text-ink">PROVIDER RETAINED</b></span>
          <span className="ml-auto hidden normal-case tracking-normal md:inline">
            {status === "available" ? detail : "Status covers the embed document only, not individual headlines."}
          </span>
        </div>
      </header>

      <section
        className="relative min-h-0 flex-1 overflow-hidden bg-[#1e222d]"
        aria-label="FinancialJuice headlines"
        aria-busy={status === "loading" || status === "unknown"}
      >
        <div
          ref={containerRef}
          id={CONTAINER_ID}
          className="h-full w-full"
        />

        {status === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-panel/95 px-4 text-center">
            <span className="h-2 w-2 animate-blink rounded-full bg-amber" aria-hidden />
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-dim">Loading FinancialJuice headlines</span>
            <p className="max-w-lg text-3xs leading-relaxed text-ink-faint">{detail}</p>
          </div>
        )}

        {status === "unavailable" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-panel px-4 text-center">
            <span className="border border-down/40 bg-down/10 px-1.5 py-[2px] font-mono text-3xs uppercase tracking-widest text-down">
              Official embed unavailable
            </span>
            <p className="max-w-xl text-xs leading-relaxed text-ink-dim">{detail}</p>
            <p className="max-w-xl text-3xs leading-relaxed text-ink-faint">
              FYIP will not substitute fabricated headlines. Use the provider link or reload the official embed.
            </p>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
              <button
                onClick={retry}
                className="border border-line-2 bg-panel-2 px-2 py-1 font-mono text-3xs uppercase tracking-widest text-ink-dim hover:border-amber hover:text-amber"
              >
                RELOAD EMBED
              </button>
              <a
                href={PROVIDER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-line-2 bg-panel-2 px-2 py-1 font-mono text-3xs uppercase tracking-widest text-ink-dim hover:border-amber hover:text-amber"
              >
                OPEN FINANCIALJUICE ↗
              </a>
            </div>
          </div>
        )}
      </section>

      <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-panel-2 px-2.5 py-1 text-3xs text-ink-faint">
        <span className="font-mono uppercase tracking-wider text-amber">Source</span>
        <span className="max-w-4xl leading-relaxed">
          Headlines and linked content are supplied by FinancialJuice. FinancialJuice attribution remains inside the official embed.
        </span>
        <span className="ml-auto font-mono uppercase tracking-wider">Official embed / no FYIP scraping</span>
      </footer>
    </div>
  );
}
