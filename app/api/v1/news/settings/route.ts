import { handler, ok } from "@/lib/api/respond";
import { HttpError, requirePermission } from "@/lib/auth/current";
import { aiStatus } from "@/lib/news/ai";
import { sanitizeCustomKeywords } from "@/lib/news/pipeline";
import { getNewsProvider } from "@/lib/news/providers";
import {
  getNewsSettings,
  listNewsSourceHealth,
  saveNewsSettings,
  setSourceEnabled,
  setSourceInterval,
} from "@/lib/news/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminPayload() {
  return {
    settings: getNewsSettings(),
    sources: listNewsSourceHealth(),
    ai: aiStatus(),
    policy: {
      endpointsEditable: false,
      note: "Source endpoints are code-defined and allowlisted to prevent SSRF and to keep provider licensing auditable. Administrators can enable/disable registered feeds, set polling intervals and add classification keywords.",
      minIntervalSeconds: 120,
      maxIntervalSeconds: 21_600,
    },
  };
}

export const GET = handler(async () => {
  requirePermission("admin.providers");
  return ok(adminPayload());
});

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "VALIDATION_ERROR", "Expected a JSON object.");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid JSON body.");
  }
}

export const PATCH = handler(async (req: Request) => {
  requirePermission("admin.providers");
  const body = await readBody(req);

  if (body.retentionDays !== undefined) {
    const days = Number(body.retentionDays);
    if (!Number.isFinite(days) || days < 7 || days > 365) {
      throw new HttpError(400, "VALIDATION_ERROR", "retentionDays must be between 7 and 365.");
    }
    saveNewsSettings({ retentionDays: Math.trunc(days) });
  }

  if (body.collectionEnabled !== undefined) {
    if (typeof body.collectionEnabled !== "boolean") {
      throw new HttpError(400, "VALIDATION_ERROR", "collectionEnabled must be a boolean.");
    }
    saveNewsSettings({ collectionEnabled: body.collectionEnabled });
  }

  if (body.customKeywords !== undefined) {
    saveNewsSettings({ customKeywords: sanitizeCustomKeywords(body.customKeywords) });
  }

  if (body.sources !== undefined) {
    if (!Array.isArray(body.sources)) {
      throw new HttpError(400, "VALIDATION_ERROR", "sources must be an array.");
    }
    if (body.sources.length > 20) {
      throw new HttpError(400, "VALIDATION_ERROR", "Too many source updates.");
    }
    for (const entry of body.sources) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new HttpError(400, "VALIDATION_ERROR", "Each source update must be an object.");
      }
      const update = entry as Record<string, unknown>;
      const key = typeof update.key === "string" ? update.key : "";
      const provider = key ? getNewsProvider(key) : null;
      if (!provider) throw new HttpError(400, "VALIDATION_ERROR", `Unknown source: ${key || "(missing key)"}.`);

      if (update.enabled !== undefined) {
        if (typeof update.enabled !== "boolean") {
          throw new HttpError(400, "VALIDATION_ERROR", `enabled for ${key} must be a boolean.`);
        }
        if (update.enabled && !provider.endpoint) {
          throw new HttpError(
            400,
            "SOURCE_UNAVAILABLE",
            `${provider.name} has no verified machine-readable endpoint. ${provider.unavailableReason ?? ""}`.trim(),
          );
        }
        setSourceEnabled(key, update.enabled);
      }

      if (update.intervalSeconds !== undefined) {
        const seconds = Number(update.intervalSeconds);
        if (!Number.isFinite(seconds) || seconds < 120 || seconds > 21_600) {
          throw new HttpError(400, "VALIDATION_ERROR", `Interval for ${key} must be between 120 and 21600 seconds.`);
        }
        if (key === "gdelt" && seconds < 600) {
          throw new HttpError(400, "VALIDATION_ERROR", "GDELT interval must be at least 600 seconds (rate limits).");
        }
        setSourceInterval(key, Math.trunc(seconds));
      }
    }
  }

  return ok(adminPayload());
});
