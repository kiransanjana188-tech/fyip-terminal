"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, ApiError } from "@/lib/client/api";

type Mode = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await apiPost("/auth/login", { email, password });
      } else {
        await apiPost("/auth/register", { email, displayName, password });
      }
      router.push("/terminal");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function guest() {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/auth/guest");
      router.push("/terminal");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm border border-line bg-panel">
        <div className="border-b border-line bg-panel-2 px-4 py-3">
          <div className="font-mono text-sm tracking-[0.3em] text-amber">FYIP TERMINAL</div>
          <div className="mt-1 text-3xs uppercase tracking-widest text-ink-faint">
            Global Financial Intelligence. One Workstation.
          </div>
        </div>

        <div className="flex border-b border-line">
          {(["login", "register"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); }}
              className={
                "flex-1 px-3 py-2 font-mono text-2xs uppercase tracking-widest " +
                (mode === m ? "bg-panel text-amber" : "text-ink-faint hover:text-ink-dim")
              }
            >
              {m === "login" ? "Sign in" : "Register"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3 p-4">
          <label className="block">
            <span className="text-3xs uppercase tracking-wider text-ink-faint">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border border-line-2 bg-base px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-amber"
              autoComplete="username"
            />
          </label>

          {mode === "register" && (
            <label className="block">
              <span className="text-3xs uppercase tracking-wider text-ink-faint">Display name</span>
              <input
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 w-full border border-line-2 bg-base px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-amber"
              />
            </label>
          )}

          <label className="block">
            <span className="text-3xs uppercase tracking-wider text-ink-faint">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full border border-line-2 bg-base px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-amber"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>

          {error && <p className="border border-down/40 bg-down/5 p-2 text-xs text-down">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full border border-amber/50 bg-amber/10 px-3 py-2 font-mono text-2xs uppercase tracking-widest text-amber hover:bg-amber/20 disabled:opacity-50"
          >
            {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
          </button>

          <p className="text-center text-3xs text-ink-faint">
            First run: sign in with the admin account from your environment (see .env.example).
          </p>

          <div className="flex items-center gap-2 pt-1">
            <div className="h-px flex-1 bg-line" />
            <span className="text-3xs uppercase tracking-widest text-ink-faint">or</span>
            <div className="h-px flex-1 bg-line" />
          </div>

          <button
            type="button"
            onClick={guest}
            disabled={busy}
            className="w-full border border-line px-3 py-2 font-mono text-2xs uppercase tracking-widest text-ink-dim hover:border-amber/40 hover:text-amber disabled:opacity-50"
          >
            Enter guest mode (view-only)
          </button>
          <p className="text-center text-3xs text-ink-faint">
            Read-only demo session: markets, news, calendar, calculators. No alerts, workspaces or admin.
          </p>
        </form>
      </div>
    </main>
  );
}