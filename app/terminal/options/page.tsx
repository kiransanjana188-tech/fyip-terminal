"use client";

import { useState } from "react";
import { useApi } from "@/lib/client/hooks";
import { apiPost } from "@/lib/client/api";
import { Panel, KeyValue } from "@/components/ui/Panel";
import { BlockerNote, ErrorState } from "@/components/ui/States";
import { fmt } from "@/lib/utils";

interface ChainDTO {
  available: boolean;
  reason?: string;
  calculatorAvailable?: boolean;
  chain?: Record<string, unknown>[];
  underlying?: { symbol: string; id: string };
}

interface GreeksDTO {
  greeksSource: string;
  conventions: string;
  intrinsic: number;
  extrinsic: number;
  greeks: { price: number; delta: number; gamma: number; theta: number; vega: number; rho: number };
  impliedVol: number | null;
}

function Calculator() {
  const [spot, setSpot] = useState("100");
  const [strike, setStrike] = useState("100");
  const [days, setDays] = useState("30");
  const [rate, setRate] = useState("0.04");
  const [vol, setVol] = useState("0.2");
  const [type, setType] = useState("call");
  const [marketPrice, setMarketPrice] = useState("");
  const [result, setResult] = useState<GreeksDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function compute() {
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        spot: Number(spot), strike: Number(strike), timeToExpiry: Number(days) / 365,
        rate: Number(rate), vol: Number(vol), type,
      };
      if (marketPrice) body.marketPrice = Number(marketPrice);
      const r = await apiPost<GreeksDTO>("/options/greeks", body);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    }
  }

  return (
    <Panel title="FYIP Black-Scholes calculator" subtitle="FYIP-calculated">
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Spot", spot, setSpot], ["Strike", strike, setStrike], ["Days", days, setDays],
          ["Rate", rate, setRate], ["Vol", vol, setVol], ["Mkt price (opt)", marketPrice, setMarketPrice],
        ].map(([label, val, set]) => (
          <label key={label as string} className="block">
            <span className="text-3xs uppercase tracking-wider text-ink-faint">{label as string}</span>
            <input value={val as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} className="mt-0.5 w-full border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
          </label>
        ))}
        <label className="block">
          <span className="text-3xs uppercase tracking-wider text-ink-faint">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} className="mt-0.5 w-full border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink-dim outline-none focus:border-amber">
            <option value="call">Call</option>
            <option value="put">Put</option>
          </select>
        </label>
      </div>
      <button onClick={compute} className="mt-2 w-full border border-amber/50 bg-amber/10 px-2 py-1 font-mono text-2xs uppercase tracking-widest text-amber hover:bg-amber/20">
        Compute
      </button>
      {error && <p className="mt-1 text-3xs text-down">{error}</p>}
      {result && (
        <div className="mt-3 space-y-0.5">
          <KeyValue label="Price" value={fmt(result.greeks.price, 4)} />
          <KeyValue label="Delta" value={fmt(result.greeks.delta, 4)} />
          <KeyValue label="Gamma" value={fmt(result.greeks.gamma, 6)} />
          <KeyValue label="Theta/day" value={fmt(result.greeks.theta, 5)} />
          <KeyValue label="Vega" value={fmt(result.greeks.vega, 4)} />
          <KeyValue label="Rho" value={fmt(result.greeks.rho, 4)} />
          <KeyValue label="Intrinsic" value={fmt(result.intrinsic, 4)} />
          <KeyValue label="Extrinsic" value={fmt(result.extrinsic, 4)} />
          {result.impliedVol !== null && <KeyValue label="Implied vol" value={fmt(result.impliedVol * 100, 2) + "%"} />}
          <p className="pt-1 text-3xs text-ink-faint">{result.conventions}</p>
          <p className="text-3xs text-amber">{result.greeksSource}</p>
        </div>
      )}
    </Panel>
  );
}

export default function OptionsPage() {
  const { data, error, reload } = useApi<ChainDTO>("/options/chain", { params: { symbol: "SPY" } });

  return (
    <div className="grid min-h-full grid-cols-1 gap-2 p-2 xl:grid-cols-2">
      <Panel title="Options chain" subtitle="provider-gated">
        {error && <ErrorState message={error.message} onRetry={reload} />}
        {data && !data.available && (
          <BlockerNote>{data.reason}</BlockerNote>
        )}
        {data?.available && (
          <div className="max-h-[34rem] overflow-auto border border-line">
            <table className="w-full border-collapse text-right font-mono text-2xs">
              <thead className="sticky top-0 bg-panel-2 text-3xs uppercase text-ink-faint">
                <tr>{["Exp", "Strike", "Type", "Bid", "Ask", "Vol", "OI", "IV", "Δ", "Γ", "Src"].map((h) => <th key={h} className="px-1.5 py-1">{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.chain?.map((row, i) => (
                  <tr key={i} className="border-b border-line/50">
                    <td className="px-1.5 py-[2px]">{String(row.expiration ?? "—")}</td>
                    <td className="px-1.5 py-[2px]">{String(row.strike ?? "—")}</td>
                    <td className="px-1.5 py-[2px]">{String(row.option_type ?? "—")}</td>
                    <td className="px-1.5 py-[2px]">{String(row.bid ?? "—")}</td>
                    <td className="px-1.5 py-[2px]">{String(row.ask ?? "—")}</td>
                    <td className="px-1.5 py-[2px]">{String(row.volume ?? "—")}</td>
                    <td className="px-1.5 py-[2px]">{String(row.open_interest ?? "—")}</td>
                    <td className="px-1.5 py-[2px]">{String(row.implied_vol ?? "—")}</td>
                    <td className="px-1.5 py-[2px]">{String(row.delta ?? "—")}</td>
                    <td className="px-1.5 py-[2px]">{String(row.gamma ?? "—")}</td>
                    <td className="px-1.5 py-[2px]">{String(row.greeks_source ?? row.source ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Calculator />
    </div>
  );
}