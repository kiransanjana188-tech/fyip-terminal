import type {
  NewsCategory,
  NewsImpact,
  NewsPriority,
  NewsRegion,
  NewsVerification,
} from "./types";

/**
 * Transparent, rule-based classification for FYP NEWS.
 *
 * Rules are intentionally inspectable and deterministic. They never invent a
 * fact: they only tag keywords already present in the source headline/summary.
 * Market-impact labels are explicit interpretations, not forecasts or signals.
 */

export const CATEGORY_LABEL: Record<NewsCategory, string> = {
  breaking: "Breaking News",
  geopolitics: "Geopolitics",
  "central-banks": "Fed & Central Banks",
  macro: "Macroeconomics",
  "inflation-employment": "Inflation & Employment",
  rates: "Treasuries & Bonds",
  equities: "Equities & Earnings",
  technology: "AI & Technology",
  forex: "Forex",
  commodities: "Commodities & Energy",
  gold: "Gold & Precious Metals",
  crypto: "Crypto",
  risk: "Global Risk",
  "regulation-trade": "Regulation & Trade",
  company: "Company Announcements",
  general: "General Wire",
};

export const CATEGORY_ORDER: NewsCategory[] = [
  "breaking",
  "geopolitics",
  "central-banks",
  "macro",
  "inflation-employment",
  "rates",
  "equities",
  "technology",
  "forex",
  "commodities",
  "gold",
  "crypto",
  "risk",
  "regulation-trade",
  "company",
  "general",
];

export const REGION_LABEL: Record<NewsRegion, string> = {
  "united-states": "United States",
  europe: "Europe",
  "united-kingdom": "United Kingdom",
  "middle-east": "Middle East",
  china: "China",
  india: "India",
  japan: "Japan",
  "asia-pacific": "Asia-Pacific",
  canada: "Canada",
  australia: "Australia",
  global: "Global",
};

export const REGION_ORDER: NewsRegion[] = [
  "united-states",
  "europe",
  "united-kingdom",
  "middle-east",
  "china",
  "india",
  "japan",
  "asia-pacific",
  "canada",
  "australia",
  "global",
];

export const VERIFICATION_LABEL: Record<NewsVerification, string> = {
  official: "OFFICIAL",
  corroborated: "MULTI-SOURCE",
  "multi-source": "MULTI-SOURCE",
  "single-source": "SINGLE SOURCE",
  unverified: "UNVERIFIED",
};

export const PRIORITY_LABEL: Record<NewsPriority, string> = {
  breaking: "BREAKING",
  high: "HIGH",
  scheduled: "SCHEDULED",
  market: "MARKET",
  research: "RESEARCH",
  general: "GENERAL",
};

interface CategoryDef {
  key: NewsCategory;
  weight: number;
  keywords: string[];
}

/** Keyword hits are word-boundary matches on lowercased title+summary. */
const CATEGORY_DEFS: CategoryDef[] = [
  {
    key: "geopolitics",
    weight: 12,
    keywords: [
      "geopolitical", "military", "strike", "airstrike", "missile", "war", "invasion", "ceasefire",
      "sanctions", "nato", "iran", "israel", "ukraine", "russia", "taiwan", "red sea", "hormuz",
      "embassy", "conflict", "troops", "drone attack", "terror", "nuclear",
    ],
  },
  {
    key: "central-banks",
    weight: 12,
    keywords: [
      "federal reserve", "fomc", "fed", "ecb", "bank of england", "boe", "bank of japan", "boj",
      "bank of canada", "rba", "central bank", "monetary policy", "rate decision", "rate cut",
      "rate hike", "powell", "lagarde", "bailey", "ueda", "quantitative easing", "qt", "policy rate",
      "interest rate", "basis points", "bps",
    ],
  },
  {
    key: "inflation-employment",
    weight: 10,
    keywords: [
      "cpi", "pce", "ppi", "inflation", "deflation", "nonfarm", "payrolls", "unemployment",
      "jobless claims", "employment", "wage", "labor market", "labour market", "jobs report", "adp",
    ],
  },
  {
    key: "rates",
    weight: 9,
    keywords: [
      "treasury", "treasuries", "yield", "bond", "auction", "duration", "curve", "issuance",
      "debt ceiling", "bund", "gilt", "jgb", "swap spread", "10-year", "2-year", "30-year",
    ],
  },
  {
    key: "macro",
    weight: 8,
    keywords: [
      "gdp", "growth", "recession", "pmi", "ism", "retail sales", "industrial production",
      "trade balance", "consumer confidence", "housing", "durable goods", "economic data",
      "fiscal", "budget", "deficit", "stimulus", "productivity",
    ],
  },
  {
    key: "equities",
    weight: 7,
    keywords: [
      "earnings", "revenue", "profit", "guidance", "eps", "quarterly", "q1", "q2", "q3", "q4",
      "stocks", "s&p 500", "nasdaq", "dow", "ipo", "buyback", "dividend", "merger", "acquisition",
      "m&a", "shareholder", "index",
    ],
  },
  {
    key: "technology",
    weight: 7,
    keywords: [
      "artificial intelligence", "ai", "semiconductor", "chip", "nvidia", "openai", "anthropic",
      "software", "cloud", "data center", "cybersecurity", "quantum", "model", "gpu",
    ],
  },
  {
    key: "forex",
    weight: 7,
    keywords: [
      "forex", "currency", "dollar", "euro", "yen", "pound", "sterling", "fx", "eurusd",
      "usdjpy", "gbpusd", "dxy", "exchange rate", "devaluation", "intervention",
    ],
  },
  {
    key: "commodities",
    weight: 7,
    keywords: [
      "oil", "crude", "brent", "wti", "opec", "natural gas", "lng", "energy", "refinery",
      "pipeline", "copper", "wheat", "corn", "commodities", "supply disruption", "barrel",
    ],
  },
  {
    key: "gold",
    weight: 6,
    keywords: ["gold", "silver", "platinum", "palladium", "precious metal", "bullion", "safe haven"],
  },
  {
    key: "crypto",
    weight: 6,
    keywords: [
      "bitcoin", "btc", "ethereum", "eth", "crypto", "digital asset", "stablecoin", "token",
      "blockchain", "sec crypto", "binance", "coinbase",
    ],
  },
  {
    key: "risk",
    weight: 8,
    keywords: [
      "default", "downgrade", "bankruptcy", "bank run", "liquidity", "circuit breaker", "halted",
      "contagion", "credit risk", "systemic", "emergency", "capital controls", "debt crisis",
    ],
  },
  {
    key: "regulation-trade",
    weight: 7,
    keywords: [
      "tariff", "trade war", "export controls", "import", "export", "regulation", "regulator",
      "antitrust", "probe", "fine", "lawsuit", "compliance", "wto", "embargo", "customs",
    ],
  },
  {
    key: "company",
    weight: 5,
    keywords: [
      "announces", "appoints", "ceo", "cfo", "board", "investor relations", "8-k", "filing",
      "share repurchase", "offering", "partnership", "contract award", "plant", "layoffs",
    ],
  },
];

const REGION_DEFS: { key: NewsRegion; keywords: string[] }[] = [
  { key: "united-states", keywords: ["united states", "u.s.", "us ", "america", "washington", "federal reserve", "treasury", "white house", "congress", "sec ", "wall street"] },
  { key: "united-kingdom", keywords: ["united kingdom", "uk", "britain", "british", "london", "bank of england", "boe", "gilt"] },
  { key: "europe", keywords: ["europe", "european union", "eu ", "eurozone", "ecb", "germany", "france", "italy", "spain", "bund", "euro area"] },
  { key: "middle-east", keywords: ["middle east", "iran", "israel", "gaza", "lebanon", "saudi", "uae", "qatar", "yemen", "red sea", "hormuz", "opec"] },
  { key: "china", keywords: ["china", "chinese", "beijing", "pboc", "yuan", "renminbi", "hong kong"] },
  { key: "india", keywords: ["india", "indian", "rbi", "rupee", "mumbai", "delhi"] },
  { key: "japan", keywords: ["japan", "japanese", "boj", "tokyo", "yen", "jgb"] },
  { key: "asia-pacific", keywords: ["asia", "pacific", "korea", "singapore", "australia", "new zealand", "taiwan", "indonesia"] },
  { key: "canada", keywords: ["canada", "canadian", "bank of canada", "boc"] },
  { key: "australia", keywords: ["australia", "australian", "rba"] },
];

const ENTITY_TERMS = [
  "Federal Reserve", "FOMC", "ECB", "Bank of England", "Bank of Japan", "PBOC", "RBI", "OPEC",
  "NATO", "European Union", "US Treasury", "SEC", "IMF", "World Bank", "BLS", "BEA",
  "United States", "China", "India", "Japan", "Germany", "France", "United Kingdom",
  "Iran", "Israel", "Russia", "Ukraine", "Saudi Arabia", "Taiwan", "Canada", "Australia",
  "Apple", "Microsoft", "NVIDIA", "Amazon", "Alphabet", "Meta", "Tesla", "JPMorgan", "Goldman Sachs",
  "Bitcoin", "Ethereum", "Nasdaq", "S&P 500", "Dow Jones",
];

const BREAKING_TERMS =
  /\b(breaking|urgent|emergency (rate|meeting|action)|unscheduled|military strike|airstrike|missile attack|invasion|declares war|ceasefire collapses|defaults?|bank (run|failure)|trading halt(ed)?|circuit breaker|downgrade)\b/i;

const STALE_TERMS = /\b(reportedly|unconfirmed|rumou?r|claims?|alleged|according to sources|sources say)\b/i;

const SEVERE_TERMS =
  /\b(war|strike|attack|invasion|default|emergency|bank failure|halt(ed)?|downgrade|sanctions|missile|nuclear|ceasefire)\b/i;

const MARKET_TERMS =
  /\b(market|markets|stocks?|bonds?|yields?|dollar|euro|yen|oil|gold|futures|risk sentiment|volatility|vix|equities|nasdaq|s&p)\b/i;

export interface ClassificationInput {
  title: string;
  summary: string | null;
  providerCategoryHint?: NewsCategory | null;
  providerRegionHint?: NewsRegion | null;
  officialSource: boolean;
  /** Admin-configured extra keywords, keyed by category. Validated on write. */
  extraKeywords?: Partial<Record<NewsCategory, string[]>>;
}

export interface Classification {
  category: NewsCategory;
  subcategory: string | null;
  region: NewsRegion;
  country: string | null;
  entities: string[];
  keywords: string[];
  symbols: string[];
  assetClasses: string[];
  urgency: number;
  relevance: number;
  priority: NewsPriority;
  isBreaking: boolean;
  impacts: NewsImpact[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word match for single words; phrase match for multi-word terms. */
export function keywordHit(text: string, keyword: string): boolean {
  const term = keyword.trim().toLowerCase();
  if (!term) return false;
  if (!term.includes(" ") && !term.includes("&")) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`, "i").test(text);
  }
  return text.includes(term);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function classify(input: ClassificationInput): Classification {
  const text = `${input.title} ${input.summary ?? ""}`.toLowerCase();
  const hits: { category: NewsCategory; weight: number; score: number; first: string | null }[] = [];

  for (const def of CATEGORY_DEFS) {
    const custom = input.extraKeywords?.[def.key] ?? [];
    const keywords = [...def.keywords, ...custom];
    let score = 0;
    let first: string | null = null;
    for (const keyword of keywords) {
      if (!keywordHit(text, keyword)) continue;
      score += keyword.includes(" ") ? 2 : 1;
      if (!first) first = keyword;
    }
    if (score > 0) hits.push({ category: def.key, weight: def.weight, score, first });
  }

  hits.sort((a, b) => b.score * b.weight - a.score * a.weight || b.score - a.score);
  const category: NewsCategory = hits[0]?.category ?? input.providerCategoryHint ?? "general";
  const subcategory = hits[0]?.first ?? null;

  let regionScore = 0;
  let region: NewsRegion = input.providerRegionHint ?? "global";
  const regions: { key: NewsRegion; score: number }[] = [];
  for (const def of REGION_DEFS) {
    let score = 0;
    for (const keyword of def.keywords) if (keywordHit(text, keyword)) score += 1;
    if (score > 0) regions.push({ key: def.key, score });
  }
  regions.sort((a, b) => b.score - a.score);
  if (regions[0] && regions[0].score > regionScore) {
    region = regions[0].key;
    regionScore = regions[0].score;
  }
  const country = region === "global" ? null : REGION_LABEL[region];

  const entities = ENTITY_TERMS.filter((term) => keywordHit(text, term.toLowerCase()));
  const keywords = unique(
    hits.flatMap((hit) =>
      [...CATEGORY_DEFS.find((d) => d.key === hit.category)!.keywords, ...(input.extraKeywords?.[hit.category] ?? [])]
        .filter((keyword) => keywordHit(text, keyword)),
    ),
  ).slice(0, 12);

  const isBreaking =
    BREAKING_TERMS.test(input.title) ||
    (input.officialSource && SEVERE_TERMS.test(input.title)) ||
    (SEVERE_TERMS.test(input.title) && input.title.split(/\s+/).length <= 14);

  const severe = SEVERE_TERMS.test(text);
  const marketHits = (text.match(MARKET_TERMS) ?? []).length;
  const categoryWeight = hits[0]?.weight ?? 2;

  const urgency = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        24 +
          (isBreaking ? 28 : 0) +
          (severe ? 12 : 0) +
          (input.officialSource ? 12 : 0) +
          categoryWeight * (hits[0]?.score ?? 0) +
          (input.title.length < 90 ? 4 : 0),
      ),
    ),
  );

  const impacts = deriveImpacts(`${input.title}. ${input.summary ?? ""}`, category, region);
  const relevance = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        18 +
          categoryWeight * 2 +
          Math.min(12, marketHits * 3) +
          Math.min(36, impacts.length * 9) +
          (isBreaking ? 10 : 0) +
          (input.officialSource ? 6 : 0),
      ),
    ),
  );

  let priority: NewsPriority = "general";
  if (isBreaking) priority = "breaking";
  else if (urgency >= 72) priority = "high";
  else if (relevance >= 58) priority = "market";
  else if (category === "macro" || category === "rates") priority = "scheduled";

  return {
    category,
    subcategory,
    region,
    country,
    entities: unique(entities).slice(0, 10),
    keywords,
    symbols: unique(impacts.map((impact) => impact.symbol)),
    assetClasses: unique(impacts.map((impact) => impact.assetClass)),
    urgency,
    relevance,
    priority,
    isBreaking,
    impacts,
  };
}

interface ImpactRule {
  id: string;
  match: RegExp;
  categories?: NewsCategory[];
  impacts: Omit<NewsImpact, "isInterpretation">[];
}

/**
 * Potential transmission channels. Every rule is an interpretation and is
 * labelled as such in the UI. Direction is "possible", never a prediction.
 */
const IMPACT_RULES: ImpactRule[] = [
  {
    id: "middle-east-conflict",
    match: /\b(middle east|iran|israel|gaza|lebanon|red sea|hormuz|saudi|houthi|military strike|airstrike|missile attack)\b/i,
    categories: ["geopolitics", "risk", "commodities"],
    impacts: [
      { symbol: "CL", assetClass: "energy", direction: "up", mechanism: "Potential crude supply-risk premium if the conflict threatens production, shipping or Strait of Hormuz transit.", confidence: 0.5 },
      { symbol: "GC", assetClass: "metals", direction: "up", mechanism: "Safe-haven demand can support gold when geopolitical risk rises; the actual reaction may differ.", confidence: 0.45 },
      { symbol: "ES", assetClass: "equity_index", direction: "down", mechanism: "Broad risk sentiment can weaken equity-index futures if escalation persists.", confidence: 0.4 },
      { symbol: "NQ", assetClass: "equity_index", direction: "down", mechanism: "Growth/technology exposure is typically sensitive to risk-off moves, but not mechanically.", confidence: 0.35 },
      { symbol: "DXY", assetClass: "fx", direction: "two-way", mechanism: "Dollar demand can rise with risk aversion while lower energy prices may offset the move.", confidence: 0.3 },
    ],
  },
  {
    id: "central-bank-policy",
    match: /\b(fomc|federal reserve|ecb|bank of england|boj|boe|rate decision|rate cut|rate hike|monetary policy|policy rate|powell|lagarde|bailey|ueda)\b/i,
    categories: ["central-banks"],
    impacts: [
      { symbol: "US10Y", assetClass: "rates", direction: "two-way", mechanism: "Policy expectations transmit to Treasury yields via the expected path of rates and term premia.", confidence: 0.45 },
      { symbol: "DXY", assetClass: "fx", direction: "two-way", mechanism: "Rate differential expectations can move the dollar against major currencies.", confidence: 0.4 },
      { symbol: "ES", assetClass: "equity_index", direction: "two-way", mechanism: "Discount-rate expectations and growth outlook can move equity-index futures in either direction.", confidence: 0.35 },
      { symbol: "GC", assetClass: "metals", direction: "two-way", mechanism: "Gold is sensitive to real yields and the dollar; direction depends on the policy surprise.", confidence: 0.3 },
    ],
  },
  {
    id: "inflation-employment",
    match: /\b(cpi|pce|ppi|inflation|nonfarm|payrolls|unemployment|jobless claims|wage growth|adp|jobs report)\b/i,
    categories: ["inflation-employment", "macro"],
    impacts: [
      { symbol: "US10Y", assetClass: "rates", direction: "two-way", mechanism: "Inflation and labour data shift expected policy rates and Treasury yields.", confidence: 0.45 },
      { symbol: "DXY", assetClass: "fx", direction: "two-way", mechanism: "Rate-expectation changes can reprice the dollar; direction depends on the surprise versus expectations.", confidence: 0.35 },
      { symbol: "ES", assetClass: "equity_index", direction: "two-way", mechanism: "Equities may react to growth and discount-rate implications of the release.", confidence: 0.35 },
      { symbol: "GC", assetClass: "metals", direction: "two-way", mechanism: "Gold can react to real yields and dollar moves following the data.", confidence: 0.3 },
    ],
  },
  {
    id: "treasury-auction",
    match: /\b(treasury auction|auction results?|auction of|note sale|bond sale|issuance|debt ceiling|treasury yields?|bond yields?|gilts?|bunds?|jgb)\b/i,
    categories: ["rates", "macro"],
    impacts: [
      { symbol: "US10Y", assetClass: "rates", direction: "two-way", mechanism: "Auction demand, issuance and yield moves can affect the Treasury curve and duration-sensitive assets.", confidence: 0.4 },
      { symbol: "ZN", assetClass: "rates", direction: "two-way", mechanism: "10-year Treasury futures respond to yield and auction-demand changes.", confidence: 0.35 },
      { symbol: "DXY", assetClass: "fx", direction: "two-way", mechanism: "Yield differentials can feed through to dollar pricing.", confidence: 0.25 },
    ],
  },
  {
    id: "oil-supply",
    match: /\b(opec|crude|oil|brent|wti|barrel|natural gas|lng|refinery|pipeline|supply disruption|energy)\b/i,
    categories: ["commodities"],
    impacts: [
      { symbol: "CL", assetClass: "energy", direction: "two-way", mechanism: "Supply, inventory and demand news changes crude expectations; direction depends on the actual balance impact.", confidence: 0.45 },
      { symbol: "NG", assetClass: "energy", direction: "two-way", mechanism: "Gas prices can react to supply, storage and weather developments.", confidence: 0.3 },
      { symbol: "GC", assetClass: "metals", direction: "watch", mechanism: "Energy-driven inflation expectations can indirectly affect safe-haven demand.", confidence: 0.2 },
    ],
  },
  {
    id: "gold-metals",
    match: /\b(gold|silver|platinum|palladium|bullion|precious metal)\b/i,
    categories: ["gold"],
    impacts: [
      { symbol: "GC", assetClass: "metals", direction: "two-way", mechanism: "Gold reacts to real yields, the dollar and safe-haven demand; this is not a directional forecast.", confidence: 0.4 },
      { symbol: "SI", assetClass: "metals", direction: "watch", mechanism: "Silver often follows gold with higher beta and industrial-demand sensitivity.", confidence: 0.25 },
    ],
  },
  {
    id: "ai-technology",
    match: /\b(artificial intelligence|ai |semiconductor|chips?|nvidia|openai|anthropic|data center|gpu|technology earnings)\b/i,
    categories: ["technology", "equities"],
    impacts: [
      { symbol: "NQ", assetClass: "equity_index", direction: "two-way", mechanism: "Technology-sector news can affect Nasdaq-100 sentiment, but earnings and guidance details matter.", confidence: 0.4 },
      { symbol: "ES", assetClass: "equity_index", direction: "watch", mechanism: "Large technology moves can spill into broad equity indices through index weights.", confidence: 0.3 },
    ],
  },
  {
    id: "crypto",
    match: /\b(bitcoin|btc|ethereum|eth|crypto|stablecoin|digital asset)\b/i,
    categories: ["crypto"],
    impacts: [
      { symbol: "BTC", assetClass: "crypto", direction: "two-way", mechanism: "Headlines can change crypto risk appetite and regulatory expectations; the module does not predict prices.", confidence: 0.3 },
    ],
  },
  {
    id: "fx-majors",
    match: /\b(euro|eurusd|yen|usdjpy|pound|sterling|gbpusd|dollar index|dxy|currency intervention)\b/i,
    categories: ["forex"],
    impacts: [
      { symbol: "DXY", assetClass: "fx", direction: "two-way", mechanism: "Rate differentials, policy expectations and risk sentiment can move the dollar index.", confidence: 0.35 },
      { symbol: "EURUSD", assetClass: "fx", direction: "two-way", mechanism: "Euro-dollar pricing reflects relative policy expectations and growth; direction is not implied.", confidence: 0.3 },
    ],
  },
  {
    id: "trade-regulation",
    match: /\b(tariff|export controls?|sanctions?|embargo|trade war|wto|customs)\b/i,
    categories: ["regulation-trade", "risk"],
    impacts: [
      { symbol: "ES", assetClass: "equity_index", direction: "two-way", mechanism: "Trade restrictions can change supply chains, margins and risk sentiment across indices.", confidence: 0.35 },
      { symbol: "CL", assetClass: "energy", direction: "watch", mechanism: "Sanctions or export controls can affect physical supply and shipping routes.", confidence: 0.25 },
      { symbol: "DXY", assetClass: "fx", direction: "watch", mechanism: "Trade policy can influence currency expectations via growth and capital-flow channels.", confidence: 0.2 },
    ],
  },
];

export function deriveImpacts(text: string, category: NewsCategory, region: NewsRegion): NewsImpact[] {
  const impacts: NewsImpact[] = [];
  const seen = new Set<string>();
  for (const rule of IMPACT_RULES) {
    if (!rule.match.test(text)) continue;
    if (rule.categories && !rule.categories.includes(category)) {
      // A directional event in the Middle East still matters for risk even if
      // the keyword classifier chose "commodities"; keep only high-confidence rules.
      if (!(rule.id === "middle-east-conflict" && region === "middle-east")) continue;
    }
    for (const impact of rule.impacts) {
      if (seen.has(impact.symbol)) continue;
      seen.add(impact.symbol);
      impacts.push({ ...impact, isInterpretation: true });
    }
  }
  return impacts;
}

/** Whether a report's language itself signals unconfirmed information. */
export function hasUncertaintyLanguage(text: string): boolean {
  return STALE_TERMS.test(text);
}
