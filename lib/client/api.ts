/** Thin fetch client for the FYIP v1 API. Browser-safe (no server imports). */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function toQuery(params?: Record<string, string | number | boolean | undefined | null>): string {
  if (!params) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    usp.set(k, String(v));
  }
  const q = usp.toString();
  return q ? `?${q}` : "";
}

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(res.status, err?.code ?? "HTTP_ERROR", err?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export function apiGet<T>(path: string, params?: Record<string, string | number | boolean | undefined | null>): Promise<T> {
  return fetch(`/api/v1${path}${toQuery(params)}`, { credentials: "same-origin", cache: "no-store" }).then((r) => handle<T>(r));
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return fetch(`/api/v1${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => handle<T>(r));
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return fetch(`/api/v1${path}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => handle<T>(r));
}

export function apiDelete<T>(path: string): Promise<T> {
  return fetch(`/api/v1${path}`, {
    method: "DELETE",
    credentials: "same-origin",
  }).then((r) => handle<T>(r));
}
