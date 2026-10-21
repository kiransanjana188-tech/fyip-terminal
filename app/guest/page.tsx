"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "@/lib/client/api";

/**
 * One-click guest entry: visit /guest, get a read-only session, land in the
 * terminal. If guest mode is disabled (FYIP_DISABLE_GUEST=true) the page
 * explains and links back to the standard login.
 */
export default function GuestEntryPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiGet<{ authenticated: boolean }>("/auth/me");
        if (me.authenticated) {
          // Already signed in — go straight to the terminal.
          if (!cancelled) router.replace("/terminal");
          return;
        }
        if (!cancelled) {
          await apiPost("/auth/guest");
          if (!cancelled) router.replace("/terminal");
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Could not start a guest session. Please try regular sign-in.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm border border-line bg-panel text-center">
        <div className="border-b border-line bg-panel-2 px-4 py-3">
          <div className="font-mono text-sm tracking-[0.3em] text-amber">FYIP TERMINAL</div>
        </div>
        <div className="space-y-3 p-6">
          {error === null ? (
            <>
              <p className="font-mono text-xs uppercase tracking-widest text-ink-dim">
                Entering guest mode…
              </p>
              <p className="text-3xs text-ink-faint">
                Read-only: markets, news, calendar, calculators. SIMULATED data is badged; UNAVAILABLE stays UNAVAILABLE.
              </p>
            </>
          ) : (
            <>
              <p className="border border-down/40 bg-down/5 p-2 text-xs text-down">{error}</p>
              <a href="/login" className="block font-mono text-2xs uppercase tracking-widest text-amber underline">
                Back to sign-in
              </a>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
