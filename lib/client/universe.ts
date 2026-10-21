/** Curated instrument groups used by the terminal dashboards. */
export const UNIVERSE = {
  keyFutures: ["ES1!", "NQ1!", "YM", "RTY1!", "GC1!", "CL1!", "ZN1!"],
  indices: ["SPX", "NDX", "DJI", "RUT", "VIX"],
  equities: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "BAC", "GS", "XOM"],
  etfs: ["SPY", "QQQ", "IWM", "GLD", "USO"],
  fx: ["EURUSD", "USDJPY", "GBPUSD", "AUDUSD", "USDCAD", "USDCHF"],
  commodities: ["GC1!", "SI1!", "CL1!", "NG1!", "XAUUSD", "XAGUSD"],
  rates: ["US2Y", "US5Y", "US10Y", "US30Y", "ZN1!", "ZB1!", "ZF1!", "ZT1!"],
  crypto: ["BTCUSD", "ETHUSD"],
} as const;

export const ASSET_CLASS_FILTERS = [
  { label: "Futures", value: "future" },
  { label: "Continuous", value: "continuous_future" },
  { label: "Equities", value: "equity" },
  { label: "Indices", value: "equity_index" },
  { label: "ETFs", value: "etf" },
  { label: "FX", value: "fx" },
  { label: "Commodities", value: "commodity" },
  { label: "Rates", value: "rate" },
  { label: "Crypto", value: "crypto" },
];