// Maps broker symbols to TradingView format
// TradingView uses EXCHANGE:SYMBOL format

const symbolMap: Record<string, string> = {
  // Forex pairs
  'EURUSD': 'FX:EURUSD',
  'GBPUSD': 'FX:GBPUSD',
  'USDJPY': 'FX:USDJPY',
  'USDCHF': 'FX:USDCHF',
  'AUDUSD': 'FX:AUDUSD',
  'USDCAD': 'FX:USDCAD',
  'NZDUSD': 'FX:NZDUSD',
  'EURGBP': 'FX:EURGBP',
  'EURJPY': 'FX:EURJPY',
  'GBPJPY': 'FX:GBPJPY',
  'AUDJPY': 'FX:AUDJPY',
  'EURAUD': 'FX:EURAUD',
  'EURNZD': 'FX:EURNZD',
  'GBPAUD': 'FX:GBPAUD',
  'GBPCAD': 'FX:GBPCAD',
  'GBPCHF': 'FX:GBPCHF',
  'GBPNZD': 'FX:GBPNZD',
  'AUDCAD': 'FX:AUDCAD',
  'AUDCHF': 'FX:AUDCHF',
  'AUDNZD': 'FX:AUDNZD',
  'CADJPY': 'FX:CADJPY',
  'CADCHF': 'FX:CADCHF',
  'CHFJPY': 'FX:CHFJPY',
  'NZDJPY': 'FX:NZDJPY',
  'NZDCAD': 'FX:NZDCAD',
  'NZDCHF': 'FX:NZDCHF',
  
  // Metals
  'XAUUSD': 'TVC:GOLD',
  'XAGUSD': 'TVC:SILVER',
  'GOLD': 'TVC:GOLD',
  'SILVER': 'TVC:SILVER',
  
  // Indices
  'NAS100': 'NASDAQ:NDX',
  'US100': 'NASDAQ:NDX',
  'USTEC': 'NASDAQ:NDX',
  'NDX': 'NASDAQ:NDX',
  'SPX500': 'SP:SPX',
  'US500': 'SP:SPX',
  'SPX': 'SP:SPX',
  'US30': 'DJ:DJI',
  'DJ30': 'DJ:DJI',
  'DJI': 'DJ:DJI',
  'DE40': 'XETR:DAX',
  'GER40': 'XETR:DAX',
  'DAX': 'XETR:DAX',
  'UK100': 'CAPITALCOM:UK100',
  'FTSE': 'CAPITALCOM:UK100',
  'JP225': 'TVC:NI225',
  'JPN225': 'TVC:NI225',
  
  // Crypto
  'BTCUSD': 'COINBASE:BTCUSD',
  'ETHUSD': 'COINBASE:ETHUSD',
  'XRPUSD': 'BITSTAMP:XRPUSD',
  
  // Oil
  'XTIUSD': 'TVC:USOIL',
  'USOIL': 'TVC:USOIL',
  'WTI': 'TVC:USOIL',
  'XBRUSD': 'TVC:UKOIL',
  'UKOIL': 'TVC:UKOIL',
  'BRENT': 'TVC:UKOIL',
};

/**
 * Maps a broker symbol to TradingView format
 * Returns null if the symbol is not supported
 */
export function mapToTradingViewSymbol(brokerSymbol: string): string | null {
  // Normalize the symbol: remove special characters and uppercase
  const normalized = brokerSymbol
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  
  // Direct match
  if (symbolMap[normalized]) {
    return symbolMap[normalized];
  }
  
  // Try matching without trailing numbers (some brokers add suffixes)
  const withoutSuffix = normalized.replace(/\d+$/, '');
  if (symbolMap[withoutSuffix]) {
    return symbolMap[withoutSuffix];
  }
  
  // Try matching with common prefixes removed
  const prefixes = ['#', 'M', 'X'];
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) {
      const withoutPrefix = normalized.slice(1);
      if (symbolMap[withoutPrefix]) {
        return symbolMap[withoutPrefix];
      }
    }
  }
  
  return null;
}

/**
 * Checks if a symbol is supported by TradingView
 */
export function isTradingViewSupported(brokerSymbol: string): boolean {
  return mapToTradingViewSymbol(brokerSymbol) !== null;
}
