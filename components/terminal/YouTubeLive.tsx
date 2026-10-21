"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const VIDEO_ID = "QB5BNdBFujE";
const EMBED_SRC = `https://www.youtube.com/embed/${VIDEO_ID}?autoplay=1&playsinline=1&rel=0&enablejsapi=1`;
const WATCH_URL = `https://www.youtube.com/live/${VIDEO_ID}?si=eE4Io25noL32l4Hg`;

const YOUTUBE_ERRORS: Record<number, string> = {
  2: "YouTube rejected the video request (invalid video ID).",
  5: "The player could not start in this browser.",
  100: "The stream is unavailable or has been removed.",
  101: "The stream owner has disabled embedding. Watch it on YouTube.",
  150: "The stream owner has disabled embedding. Watch it on YouTube.",
};

export function YouTubeLive({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  const hardErrorRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!loadedRef.current && !hardErrorRef.current) setSlow(true);
    }, 12000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== "https://www.youtube.com") return;
      let data: unknown = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (!data || typeof data !== "object") return;
      const payload = data as { event?: string; info?: number };
      if (payload.event !== "onError" || typeof payload.info !== "number") return;
      hardErrorRef.current = true;
      setError(YOUTUBE_ERRORS[payload.info] ?? `YouTube reported a playback error (code ${payload.info}).`);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function handleLoad() {
    loadedRef.current = true;
    setLoaded(true);
    setSlow(false);
  }

  async function toggleFullscreen() {
    const node = playerRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await node.requestFullscreen();
    } catch {
      return;
    }
  }

  const badge = error ? "player error" : !loaded && !slow ? "connecting" : "stream player";

  return (
    <section className={cn("flex flex-col overflow-hidden border border-line bg-panel", className)}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-panel-2 px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              error ? "bg-down" : !loaded && !slow ? "animate-blink bg-amber/80" : "bg-ink-faint",
            )}
            aria-hidden
          />
          <h2 className="truncate font-mono text-2xs uppercase tracking-widest text-ink-dim">Live market broadcast</h2>
        </span>
        <span className="font-mono text-3xs uppercase tracking-wider text-ink-faint">YouTube</span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-3xs uppercase tracking-wider">
          <span
            className={cn(
              "border px-1.5 py-[1px] tracking-wider",
              error ? "border-down/40 bg-down/10 text-down" : "border-line-2 text-ink-faint",
            )}
            title="The embed does not expose the broadcast's live state; YouTube shows its own LIVE badge inside the player."
          >
            {badge}
          </span>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="border border-line px-1.5 py-[1px] text-ink-faint hover:border-line-2 hover:text-amber"
            title="Toggle fullscreen"
          >
            full
          </button>
          <a
            href={WATCH_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="border border-line px-1.5 py-[1px] text-ink-faint hover:border-amber/50 hover:text-amber"
            title="Open the broadcast on YouTube"
          >
            open on youtube ↗
          </a>
        </div>
      </header>

      <div className="flex flex-1 flex-col bg-black">
        <div ref={playerRef} className="relative aspect-video w-full shrink-0 overflow-hidden bg-black">
          {mounted && (
            <iframe
              src={EMBED_SRC}
              title="FYIP live market broadcast on YouTube"
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={handleLoad}
            />
          )}
          {!loaded && !error && !slow && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-base/80">
              <span className="font-mono text-3xs uppercase tracking-widest text-ink-faint">Connecting to YouTube</span>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-base/95 px-4 text-center">
              <span className="font-mono text-3xs uppercase tracking-widest text-down">Stream unavailable</span>
              <p className="max-w-sm text-xs text-ink-dim">{error}</p>
              <a
                href={WATCH_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="border border-amber/50 bg-amber/10 px-2 py-1 font-mono text-3xs uppercase tracking-wider text-amber hover:bg-amber/20"
              >
                open on youtube
              </a>
            </div>
          )}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-2.5 py-1.5 font-mono text-3xs uppercase tracking-wider text-ink-faint">
          <span className="text-ink-dim">id {VIDEO_ID}</span>
          <span>{slow && !loaded && !error ? "player not responding" : "embed · youtube.com"}</span>
          <span className="ml-auto hidden sm:inline">autoplay subject to browser policy</span>
        </div>
      </div>
    </section>
  );
}
