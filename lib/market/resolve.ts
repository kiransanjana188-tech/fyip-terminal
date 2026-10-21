import { getInstrument, type InstrumentRow } from "@/lib/market/instruments";
import { frontContractFor } from "@/lib/market/quotes";

export interface ResolvedMarketSymbol {
  requested: string;
  instrument: InstrumentRow;
  contractSymbol: string;
  continuous: boolean;
}

export function resolveMarketSymbol(input: string): ResolvedMarketSymbol | null {
  const requested = input.trim().toUpperCase();
  if (!requested) return null;
  const direct = getInstrument(requested);
  const continuousAlias = getInstrument(`${requested}1!`);
  const continuousCandidate =
    continuousAlias && continuousAlias.is_continuous === 1
      ? continuousAlias
      : direct && direct.is_continuous === 1
        ? direct
        : null;

  if (continuousCandidate) {
    const front = frontContractFor(continuousCandidate);
    const frontInstrument = front ? getInstrument(front.id) : null;
    if (frontInstrument) {
      return {
        requested,
        instrument: frontInstrument,
        contractSymbol: frontInstrument.symbol,
        continuous: true,
      };
    }
  }

  if (direct) {
    return {
      requested,
      instrument: direct,
      contractSymbol: direct.symbol,
      continuous: direct.is_continuous === 1,
    };
  }

  return null;
}
