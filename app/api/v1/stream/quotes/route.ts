import { getCurrentUser } from "@/lib/auth/current";
import { instrumentIdForSymbol, getInstrument } from "@/lib/market/instruments";
import { quoteHub } from "@/lib/market/hub";
import { buildQuoteView, frontContractFor } from "@/lib/market/quotes";
import { bridgeThresholds, deriveDataStatus } from "@/lib/market/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STREAM_TYPES = new Set(["quote", "depth", "trade"]);

/**
 * Server-Sent Events gateway for normalized quotes, depth ladders and trade
 * prints. `types` (comma list, default "quote") selects what is pushed.
 *
 * Clients subscribe only to the symbols they currently need; the server does
 * NOT broadcast every raw event to every client. Authentication + market.read
 * are enforced before the stream opens.
 */
export async function GET(req: Request): Promise<Response> {
  const user = getCurrentUser();
  if (!user || !user.permissions.includes("market.read")) {
    return new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "Authentication required." } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const symbolsParam = url.searchParams.get("symbols");
  const symbolSet = symbolsParam
    ? new Set(symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 100))
    : null;
  // Continuous futures (ES, ES1!) are views, not real feeds: resolve each root
  // to the front contract id so quotes/depth/trade coming off the bridge for
  // that contract match the subscription. The alias map keeps the client-facing
  // key exactly the symbol the client subscribed with.
  const aliases = new Map<string, string | null>();
  const idSet = symbolSet
    ? new Set(
        [...symbolSet].flatMap((s) => {
          // Root symbols like "ES" may match the ES index row exactly, but
          // streaming depth/trade means the user wants the ES front contract:
          // try the Bloomberg continuous alias "1!" too and prefer it.
          const directId = instrumentIdForSymbol(s);
          const contBaseId = instrumentIdForSymbol(`${s}1!`);
          const baseId = directId ?? contBaseId;
          if (!baseId) return [];
          const cont = contBaseId ? getInstrument(contBaseId) : null;
          if (cont?.is_continuous === 1) {
            const contFront = frontContractFor(cont);
            if (contFront) {
              aliases.set(contFront.id, s);
              return [contFront.id];
            }
          }
          const base = getInstrument(baseId);
          if (!base) return [baseId];
          const front = frontContractFor(base);
          if (front) {
            aliases.set(front.id, s);
            return [front.id];
          }
          aliases.set(baseId, s);
          return [baseId];
        }),
      )
    : null;

  const typesRaw = url.searchParams.get("types") ?? "quote";
  const types = new Set(typesRaw.split(",").map((t) => t.trim()).filter((t) => STREAM_TYPES.has(t)));

  const encoder = new TextEncoder();
  const thresholds = bridgeThresholds();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* client gone */
        }
      };

      send("hello", { serverTime: new Date().toISOString(), types: [...types], thresholds });

      // Initial snapshot for the subscribed symbols.
      const initial = [...idSet ?? []]
        .map((instrumentId) => getInstrument(instrumentId))
        .filter((i): i is NonNullable<typeof i> => !!i)
        .map(buildQuoteView);
      if (types.has("quote")) send("snapshot", { quotes: initial });
      if (types.has("depth")) {
        for (const instrumentId of idSet ?? []) {
          const ladder = quoteHub.latestDepth(instrumentId);
          if (ladder) {
            const inst = getInstrument(instrumentId);
            send("depth", {
              ...ladder,
              symbol: aliases.get(instrumentId) ?? aliases.get(ladder.instrumentId) ?? inst?.symbol ?? ladder.instrumentId,
            });
          }
        }
      }

      const unsubscribers: (() => void)[] = [];

      if (types.has("quote")) {
        unsubscribers.push(
          quoteHub.subscribe((quote) => {
            if (idSet && !idSet.has(quote.instrumentId)) return;
            const inst = getInstrument(quote.instrumentId);
            if (!inst) return;
            const feed = quoteHub.feedState(quote.provider);
            send("quote", {
              ...quote,
              symbol: inst.symbol,
              displayName: inst.display_name,
              assetClass: inst.asset_class,
              status: deriveDataStatus({
                declared: quote.dataStatus,
                eventTimestamp: quote.eventTimestamp,
                receivedTimestamp: quote.receivedTimestamp,
                connected: feed.connected,
                ...thresholds,
              }),
            });
          }),
        );
      }

      if (types.has("depth")) {
        unsubscribers.push(
          quoteHub.subscribeDepth((ladder) => {
            if (idSet && !idSet.has(ladder.instrumentId)) return;
            const inst = getInstrument(ladder.instrumentId);
            send("depth", {
              ...ladder,
              symbol: aliases.get(ladder.instrumentId) ?? inst?.symbol ?? ladder.instrumentId,
            });
          }),
        );
      }

      if (types.has("trade")) {
        unsubscribers.push(
          quoteHub.subscribeTrade((trade) => {
            if (idSet && !idSet.has(trade.instrumentId)) return;
            const inst = getInstrument(trade.instrumentId);
            send("trade", {
              ...trade,
              symbol: aliases.get(trade.instrumentId) ?? inst?.symbol ?? trade.instrumentId,
            });
          }),
        );
      }

      const ping = setInterval(() => send("ping", { t: Date.now() }), 15000);

      const close = () => {
        clearInterval(ping);
        for (const off of unsubscribers) off();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
