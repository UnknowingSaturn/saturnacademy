// ============================================================================
// Symbol aliasing — collapse broker variants of the same instrument into a
// single canonical name (EURUSD/EURUSD+/EURUSD.r → EURUSD).
//
// Single source of truth for both the React client (src/lib/symbolAliasing.ts
// re-exports from here) and Supabase edge functions. Keep dependency-free so
// it can run unchanged in Deno.
// ============================================================================

export interface SymbolAlias {
  raw_symbol: string;
  canonical_symbol: string;
  source: "manual" | "auto";
}

// Hard-coded family map. Keys are uppercased canonical names; values are
// alternate spellings a broker might use. Add new entries here, not at the
// call site.
const FAMILY_MAP: Record<string, string[]> = {
  NAS100:  ["NAS100", "NASUSD", "NDX100", "US100", "USTEC", "USTECH", "TECH100"],
  SP500:   ["SP500", "SPX500", "SPXUSD", "US500", "USA500", "S&P500", "SP500CASH"],
  US30:    ["US30", "DJ30", "DJI30", "USA30", "DOW", "WS30"],
  GER40:   ["GER40", "DE40", "DAX40", "GERMANY40", "DAX", "GER30", "DE30"],
  UK100:   ["UK100", "FTSE100", "FTSE", "UKX"],
  JPN225:  ["JPN225", "JP225", "NIKKEI", "NI225"],
  XAUUSD:  ["XAUUSD", "GOLD", "GOLDUSD"],
  XAGUSD:  ["XAGUSD", "SILVER", "SILVERUSD"],
  BTCUSD:  ["BTCUSD", "BITCOIN", "BTC", "BTCUSDT"],
  ETHUSD:  ["ETHUSD", "ETHEREUM", "ETH", "ETHUSDT"],
  XTIUSD:  ["XTIUSD", "USOIL", "WTI", "OIL", "CRUDE"],
  XBRUSD:  ["XBRUSD", "UKOIL", "BRENT", "BCOUSD"],
};

const FAMILY_REVERSE: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canonical, alts] of Object.entries(FAMILY_MAP)) {
    for (const alt of alts) m.set(alt.toUpperCase(), canonical);
  }
  return m;
})();

const STRIP_SUFFIXES = [
  ".cash", ".pro", ".raw", ".rfd", ".m", ".i", ".sml", ".std",
  "-pro", "-raw", "-mini", "-cash", "-ecn",
  "_i", "_m", "_pro", "_raw", "_cash",
];
const STRIP_CHARS = ["+", "#", "*", "!", "~"];

/**
 * Normalize a single raw broker symbol to its canonical form.
 * Pure function, no DB lookup.
 */
export function normalizeSymbol(raw: string): string {
  if (!raw) return raw;
  let s = raw.trim().toUpperCase();

  for (const suf of STRIP_SUFFIXES) {
    if (s.toLowerCase().endsWith(suf)) s = s.slice(0, -suf.length);
  }
  while (s.length > 3 && STRIP_CHARS.includes(s.slice(-1))) s = s.slice(0, -1);

  if (FAMILY_REVERSE.has(s)) return FAMILY_REVERSE.get(s)!;

  const stripped = s.replace(/[+#*!~]/g, "");
  if (FAMILY_REVERSE.has(stripped)) return FAMILY_REVERSE.get(stripped)!;

  return s;
}

export interface AliasSuggestion {
  raw_symbol: string;
  canonical_symbol: string;
  trade_count: number;
  group: string[];
}

export function detectAliasSuggestions(
  raws: Array<{ symbol: string; count: number }>,
  existing: SymbolAlias[] = [],
): AliasSuggestion[] {
  const existingMap = new Map(existing.map((a) => [a.raw_symbol.toUpperCase(), a]));
  const groups = new Map<string, Array<{ symbol: string; count: number }>>();

  for (const { symbol, count } of raws) {
    if (!symbol) continue;
    const canonical = normalizeSymbol(symbol);
    if (!groups.has(canonical)) groups.set(canonical, []);
    groups.get(canonical)!.push({ symbol, count });
  }

  const out: AliasSuggestion[] = [];
  for (const [canonical, members] of groups) {
    const needsAlias = members.some((m) => m.symbol.toUpperCase() !== canonical);
    if (!needsAlias) continue;

    const group = members.map((m) => m.symbol);
    for (const m of members) {
      const existingEntry = existingMap.get(m.symbol.toUpperCase());
      if (existingEntry && existingEntry.canonical_symbol.toUpperCase() === canonical) continue;
      out.push({
        raw_symbol: m.symbol,
        canonical_symbol: canonical,
        trade_count: m.count,
        group,
      });
    }
  }
  out.sort((a, b) => b.group.length - a.group.length || b.trade_count - a.trade_count);
  return out;
}

/**
 * Returns a resolver function: rawSymbol → canonicalSymbol.
 * Lookup order: saved alias → normalizeSymbol() → identity.
 */
export function buildSymbolResolver(aliases: SymbolAlias[]): (raw: string) => string {
  const map = new Map<string, string>();
  for (const a of aliases) {
    map.set(a.raw_symbol.toUpperCase(), a.canonical_symbol);
  }
  return (raw: string): string => {
    if (!raw) return raw;
    const saved = map.get(raw.toUpperCase());
    if (saved) return saved;
    return normalizeSymbol(raw);
  };
}
