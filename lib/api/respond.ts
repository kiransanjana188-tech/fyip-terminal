import { NextResponse } from "next/server";
import { HttpError } from "@/lib/auth/current";
import { ensureSeeded } from "@/lib/db/seed";
import { ensureNewsCollector } from "@/lib/news/ingest";
import { ensureProvidersStarted } from "@/lib/providers/registry";

let bootstrapped = false;
function bootstrapOnce(): void {
  if (bootstrapped) return;
  ensureSeeded();
  ensureProvidersStarted();
  ensureNewsCollector();
  bootstrapped = true;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    detail?: unknown;
  };
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function fail(status: number, code: string, message: string, detail?: unknown): NextResponse<ApiError> {
  return NextResponse.json({ error: { code, message, detail } }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Wrap an async route handler so thrown HttpErrors become structured responses
 * with stable codes, and unexpected errors become a generic 500 without leaking
 * internals.
 */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse> | NextResponse,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      bootstrapOnce();
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) {
        return fail(err.status, err.code, err.message);
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      // Log server-side for operators; never surface stack traces or secrets to clients.
      console.error("[fyip:api] unhandled error:", message, err instanceof Error ? err.stack : "");
      return fail(500, "INTERNAL_ERROR", "An unexpected server error occurred.");
    }
  };
}

export function parseJson<T = unknown>(body: unknown): T {
  return body as T;
}

export function requireString(value: unknown, field: string, max = 512): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "VALIDATION_ERROR", `Field "${field}" is required.`);
  }
  if (value.length > max) {
    throw new HttpError(400, "VALIDATION_ERROR", `Field "${field}" is too long.`);
  }
  return value.trim();
}