/**
 * Comprehensive symbol alias database for mapping between different broker naming conventions.
 * Each group represents the same underlying instrument with different broker names.
 */

export const SYMBOL_ALIAS_GROUPS: Record<string, string[]> = {
  // US Indices
  NASDAQ_100: [
    'USTEC', 'USTEC.cash', 'NAS100', 'NASDAQ', 'US100', 'NDX', 'USTECH', 
    'USTECH100', 'NAS100.cash', 'US_TECH100', 'NSDQ100', 'USTEC100'
  ],
  DOW_JONES: [
    'US30', 'US30.cash', 'DOW', 'DJ30', 'DJI', 'DOWJONES', 'WS30', 
    'USA30', 'USIND30', 'US30.', 'DJ30.cash'
  ],
  SP500: [
    'US500', 'US500.cash', 'SP500', 'SPX', 'SPX500', 'USA500', 
    'SP500.cash', 'US_SPX500', 'USP500'
  ],
  RUSSELL_2000: [
    'US2000', 'US2000.cash', 'RUSSELL2000', 'RTY', 'RUSS2000', 'USA2000'
  ],

  // European Indices
  DAX: [
    'DE40', 'DE40.cash', 'DAX40', 'GER40', 'GER30', 'DAX30', 'GERMANY40', 
    'DE30', 'DE30.cash', 'GER40.cash'
  ],
  FTSE: [
    'UK100', 'UK100.cash', 'FTSE100', 'FTSE', 'GBP100', 'GB100'
  ],
  CAC40: [
    'FRA40', 'FRA40.cash', 'CAC', 'CAC40', 'F40', 'FRANCE40'
  ],
  EUROSTOXX: [
    'EU50', 'EU50.cash', 'STOXX50', 'STOXX', 'EUROSTOXX50', 'SX5E'
  ],

  // Asian Indices
  NIKKEI: [
    'JP225', 'JP225.cash', 'NIKKEI', 'NIKKEI225', 'JPN225', 'N225', 'NKY'
  ],
  HANG_SENG: [
    'HK50', 'HK50.cash', 'HSI', 'HANGSENG', 'HONGKONG50', 'HKG50'
  ],
  CHINA_A50: [
    'CHINA50', 'CN50', 'A50', 'CHINAA50', 'CHN50', 'FTXIN9'
  ],
  ASX200: [
    'AUS200', 'AUS200.cash', 'ASX200', 'AU200', 'XJO', 'AUSTRALIA200'
  ],

  // Precious Metals
  GOLD: [
    'XAUUSD', 'GOLD', 'XAU/USD', 'XAUUSD.', 'GOLDUSD', 'XAU_USD', 
    'XAUUSD.cash', 'GOLD.cash', 'GLD', 'XAU'
  ],
  SILVER: [
    'XAGUSD', 'SILVER', 'XAG/USD', 'XAGUSD.', 'SILVERUSD', 'XAG_USD',
    'XAGUSD.cash', 'SILVER.cash', 'SLV', 'XAG'
  ],
  PLATINUM: [
    'XPTUSD', 'PLATINUM', 'XPT/USD', 'XPTUSD.', 'XPT_USD', 'XPT'
  ],
  PALLADIUM: [
    'XPDUSD', 'PALLADIUM', 'XPD/USD', 'XPDUSD.', 'XPD_USD', 'XPD'
  ],

  // Energy
  CRUDE_OIL_WTI: [
    'USOUSD', 'USOIL', 'WTI', 'WTIUSD', 'CRUDEOIL', 'USOIL.cash', 
    'CL', 'USOILSPOT', 'CRUDE', 'OIL', 'USO', 'OILUSD'
  ],
  CRUDE_OIL_BRENT: [
    'UKOUSD', 'UKOIL', 'BRENT', 'BRENTUSD', 'UKOIL.cash', 'BRN',
    'BRENTOIL', 'BRNOIL', 'BRENTOILUSD'
  ],
  NATURAL_GAS: [
    'NATGAS', 'NGAS', 'NATURALGAS', 'NATGASUSD', 'XNGUSD', 'NG', 'NATGAS.cash'
  ],

  // Major Forex Pairs
  EURUSD: ['EURUSD', 'EUR/USD', 'EURUSD.', 'EUR_USD', 'EURUSD.cash'],
  GBPUSD: ['GBPUSD', 'GBP/USD', 'GBPUSD.', 'GBP_USD', 'GBPUSD.cash'],
  USDJPY: ['USDJPY', 'USD/JPY', 'USDJPY.', 'USD_JPY', 'USDJPY.cash'],
  USDCHF: ['USDCHF', 'USD/CHF', 'USDCHF.', 'USD_CHF', 'USDCHF.cash'],
  AUDUSD: ['AUDUSD', 'AUD/USD', 'AUDUSD.', 'AUD_USD', 'AUDUSD.cash'],
  USDCAD: ['USDCAD', 'USD/CAD', 'USDCAD.', 'USD_CAD', 'USDCAD.cash'],
  NZDUSD: ['NZDUSD', 'NZD/USD', 'NZDUSD.', 'NZD_USD', 'NZDUSD.cash'],

  // Cross Pairs
  EURGBP: ['EURGBP', 'EUR/GBP', 'EURGBP.', 'EUR_GBP'],
  EURJPY: ['EURJPY', 'EUR/JPY', 'EURJPY.', 'EUR_JPY'],
  GBPJPY: ['GBPJPY', 'GBP/JPY', 'GBPJPY.', 'GBP_JPY'],
  EURCHF: ['EURCHF', 'EUR/CHF', 'EURCHF.', 'EUR_CHF'],
  GBPCHF: ['GBPCHF', 'GBP/CHF', 'GBPCHF.', 'GBP_CHF'],
  AUDNZD: ['AUDNZD', 'AUD/NZD', 'AUDNZD.', 'AUD_NZD'],
  AUDJPY: ['AUDJPY', 'AUD/JPY', 'AUDJPY.', 'AUD_JPY'],
  CADJPY: ['CADJPY', 'CAD/JPY', 'CADJPY.', 'CAD_JPY'],
  EURAUD: ['EURAUD', 'EUR/AUD', 'EURAUD.', 'EUR_AUD'],
  EURCAD: ['EURCAD', 'EUR/CAD', 'EURCAD.', 'EUR_CAD'],
  EURNZD: ['EURNZD', 'EUR/NZD', 'EURNZD.', 'EUR_NZD'],
  GBPAUD: ['GBPAUD', 'GBP/AUD', 'GBPAUD.', 'GBP_AUD'],
  GBPCAD: ['GBPCAD', 'GBP/CAD', 'GBPCAD.', 'GBP_CAD'],
  GBPNZD: ['GBPNZD', 'GBP/NZD', 'GBPNZD.', 'GBP_NZD'],
  NZDJPY: ['NZDJPY', 'NZD/JPY', 'NZDJPY.', 'NZD_JPY'],
  CHFJPY: ['CHFJPY', 'CHF/JPY', 'CHFJPY.', 'CHF_JPY'],
  AUDCAD: ['AUDCAD', 'AUD/CAD', 'AUDCAD.', 'AUD_CAD'],
  AUDCHF: ['AUDCHF', 'AUD/CHF', 'AUDCHF.', 'AUD_CHF'],
  CADCHF: ['CADCHF', 'CAD/CHF', 'CADCHF.', 'CAD_CHF'],
  NZDCAD: ['NZDCAD', 'NZD/CAD', 'NZDCAD.', 'NZD_CAD'],
  NZDCHF: ['NZDCHF', 'NZD/CHF', 'NZDCHF.', 'NZD_CHF'],

  // Crypto
  BITCOIN: [
    'BTCUSD', 'BTC/USD', 'BTCUSD.', 'BITCOIN', 'XBTUSD', 'BTC_USD', 'BTC'
  ],
  ETHEREUM: [
    'ETHUSD', 'ETH/USD', 'ETHUSD.', 'ETHEREUM', 'ETH_USD', 'ETH'
  ],
  LITECOIN: [
    'LTCUSD', 'LTC/USD', 'LTCUSD.', 'LITECOIN', 'LTC_USD', 'LTC'
  ],
  RIPPLE: [
    'XRPUSD', 'XRP/USD', 'XRPUSD.', 'RIPPLE', 'XRP_USD', 'XRP'
  ],
};

/**
 * Normalize a symbol for comparison (uppercase, remove common suffixes)
 */
export function normalizeSymbol(symbol: string): string {
  return symbol
    .toUpperCase()
    .replace(/\.CASH$/i, '')
    .replace(/\.$/, '')
    .replace(/[/_]/g, '');
}

/**
 * Find the alias group that a symbol belongs to
 */
export function findAliasGroup(symbol: string): string[] | null {
  const normalized = normalizeSymbol(symbol);
  
  for (const [groupName, aliases] of Object.entries(SYMBOL_ALIAS_GROUPS)) {
    const normalizedAliases = aliases.map(normalizeSymbol);
    if (normalizedAliases.includes(normalized)) {
      return aliases;
    }
  }
  
  return null;
}

/**
 * Get suggested receiver symbols for a given master symbol
 * Returns aliases sorted by similarity to the input
 */
export function getSuggestedSymbols(masterSymbol: string): string[] {
  const aliasGroup = findAliasGroup(masterSymbol);
  
  if (!aliasGroup) {
    return [];
  }
  
  // Filter out the exact input and sort by length (shorter = more common)
  const upperMaster = masterSymbol.toUpperCase();
  return aliasGroup
    .filter(alias => alias.toUpperCase() !== upperMaster)
    .sort((a, b) => a.length - b.length);
}

/**
 * Calculate similarity score between two symbols (0-1)
 */
function calculateSimilarity(s1: string, s2: string): number {
  const a = normalizeSymbol(s1);
  const b = normalizeSymbol(s2);
  
  if (a === b) return 1;
  
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  
  let matches = 0;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) {
      matches++;
    }
  }
  
  return matches / maxLen;
}

/**
 * Suggest the best matching receiver symbol from available options
 */
export function suggestBestMatch(
  masterSymbol: string, 
  availableSymbols: string[]
): string | null {
  const aliasGroup = findAliasGroup(masterSymbol);
  
  // First try: exact match from alias group
  if (aliasGroup) {
    for (const alias of aliasGroup) {
      const match = availableSymbols.find(
        s => normalizeSymbol(s) === normalizeSymbol(alias)
      );
      if (match && match.toUpperCase() !== masterSymbol.toUpperCase()) {
        return match;
      }
    }
  }
  
  // Second try: fuzzy match based on similarity
  let bestMatch: string | null = null;
  let bestScore = 0;
  
  for (const symbol of availableSymbols) {
    if (symbol.toUpperCase() === masterSymbol.toUpperCase()) continue;
    
    const score = calculateSimilarity(masterSymbol, symbol);
    if (score > bestScore && score > 0.5) {
      bestScore = score;
      bestMatch = symbol;
    }
  }
  
  return bestMatch;
}
