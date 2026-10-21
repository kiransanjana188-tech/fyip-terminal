import type { NewsStoryView } from "./store";

/**
 * Optional, provider-independent AI summary.
 *
 * Disabled unless the operator configures an OpenAI-compatible endpoint via
 * environment variables. The model is constrained to the supplied source text
 * and the response is clearly labelled as machine-generated. If anything is
 * missing we say so instead of falling back to a paid provider or inventing
 * content.
 */

export interface AiStatus {
  enabled: boolean;
  model: string | null;
  reason: string | null;
}

function config(): { baseUrl: string; apiKey: string; model: string } | null {
  const baseUrl = process.env.FYIP_AI_BASE_URL?.trim();
  const apiKey = process.env.FYIP_AI_API_KEY?.trim();
  const model = process.env.FYIP_AI_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  try {
    const url = new URL(baseUrl);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !local) return null;
  } catch {
    return null;
  }
  return { baseUrl, apiKey, model };
}

export function aiStatus(): AiStatus {
  const configured = config();
  return configured
    ? { enabled: true, model: configured.model, reason: null }
    : {
        enabled: false,
        model: null,
        reason:
          "AI summarization is not configured. Set FYIP_AI_BASE_URL, FYIP_AI_API_KEY and FYIP_AI_MODEL to enable an optional OpenAI-compatible endpoint. All other FYP NEWS features work without it.",
      };
}

export class AiUnavailableError extends Error {
  constructor(
    public code: "AI_DISABLED" | "NO_SOURCE_TEXT" | "AI_FAILED",
    message: string,
  ) {
    super(message);
  }
}

function completionUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

export async function summarizeStory(story: NewsStoryView): Promise<{
  summary: string;
  model: string;
  generatedAt: string;
  notice: string;
}> {
  const configured = config();
  if (!configured) {
    throw new AiUnavailableError("AI_DISABLED", aiStatus().reason ?? "AI summarization is not configured.");
  }
  if (story.isFixture) {
    throw new AiUnavailableError("NO_SOURCE_TEXT", "Fixture stories are for development and are not summarized.");
  }
  if (!story.summary || story.summary.trim().length < 40) {
    throw new AiUnavailableError(
      "NO_SOURCE_TEXT",
      "This provider supplied only a headline. FYIP does not invent summaries, so there is no source text to summarize.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(completionUrl(configured.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${configured.apiKey}`,
      },
      body: JSON.stringify({
        model: configured.model,
        temperature: 0.2,
        max_tokens: 240,
        messages: [
          {
            role: "system",
            content:
              "You are a financial-news neutral summarizer inside FYP TERMINAL. Use ONLY the supplied headline and source summary. Do not add facts, numbers, dates, forecasts, prices, causality or trading advice that are not in the source. Do not claim anything is confirmed. Write at most 90 words in plain English. If the source text is insufficient, say so.",
          },
          {
            role: "user",
            content: `Headline: ${story.title}\n\nSource summary: ${story.summary}\n\nSource: ${story.sourceName}`,
          },
        ],
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new AiUnavailableError("AI_FAILED", `AI provider returned HTTP ${response.status}.`);
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) throw new AiUnavailableError("AI_FAILED", "AI provider returned an empty summary.");
    return {
      summary: text.slice(0, 1_200),
      model: configured.model,
      generatedAt: new Date().toISOString(),
      notice: "Machine-generated from the source summary. Verify against the original source; this is not a new fact and not a trading signal.",
    };
  } catch (error) {
    if (error instanceof AiUnavailableError) throw error;
    const aborted = error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"));
    throw new AiUnavailableError("AI_FAILED", aborted ? "AI request timed out." : "AI request failed.");
  } finally {
    clearTimeout(timer);
  }
}
