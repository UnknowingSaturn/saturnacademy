import type { 
  CopierConfigFile, 
  CopierReceiverConfig, 
  CopierSymbolMapping, 
  CopierReceiverSettings 
} from '@/types/copier';
import type { Account } from '@/types/trading';

// Generate a hash from config content for version tracking
function generateConfigHash(config: CopierConfigFile): string {
  const content = JSON.stringify({
    master: config.master,
    receivers: config.receivers,
  });
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// Generate the config file from database data
export function generateCopierConfig(
  masterAccount: Account,
  receiverAccounts: Account[],
  symbolMappings: CopierSymbolMapping[],
  receiverSettings: CopierReceiverSettings[],
  version: number = 1
): CopierConfigFile {
  // Build receiver configs
  const receivers: CopierReceiverConfig[] = receiverAccounts.map(receiver => {
    // Get settings for this receiver
    const settings = receiverSettings.find(s => s.receiver_account_id === receiver.id);
    
    // Get symbol mappings for this receiver
    const mappings = symbolMappings
      .filter(m => m.receiver_account_id === receiver.id && m.is_enabled)
      .reduce((acc, m) => {
        acc[m.master_symbol] = m.receiver_symbol;
        return acc;
      }, {} as Record<string, string>);
    
    return {
      receiver_id: receiver.id,
      account_name: receiver.name,
      broker: receiver.broker,
      terminal_id: receiver.terminal_id,
      
      risk: {
        mode: settings?.risk_mode || 'balance_multiplier',
        value: settings?.risk_value || 1.0,
      },
      
      safety: {
        max_slippage_pips: settings?.max_slippage_pips || 3.0,
        max_daily_loss_r: settings?.max_daily_loss_r || 3.0,
        allowed_sessions: settings?.allowed_sessions || ['tokyo', 'london', 'new_york_am', 'new_york_pm'],
        manual_confirm_mode: settings?.manual_confirm_mode || false,
        prop_firm_safe_mode: settings?.prop_firm_safe_mode || false,
        poll_interval_ms: settings?.poll_interval_ms || 1000,
      },
      
      symbol_mappings: mappings,
    };
  });
  
  const config: CopierConfigFile = {
    version,
    generated_at: new Date().toISOString(),
    config_hash: '', // Will be set after generation
    
    master: {
      account_id: masterAccount.id,
      account_name: masterAccount.name,
      broker: masterAccount.broker,
      terminal_id: masterAccount.terminal_id,
    },
    
    receivers,
  };
  
  // Generate hash after building config
  config.config_hash = generateConfigHash(config);
  
  return config;
}

// Download config file to user's device
export function downloadConfigFile(config: CopierConfigFile): void {
  const jsonString = JSON.stringify(config, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `copier-config-v${config.version}-${timestamp}.json`;
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Common symbol mapping presets
export const SYMBOL_MAPPING_PRESETS: Record<string, Record<string, string>> = {
  'IC Markets → FTMO': {
    'USTEC.cash': 'USTEC',
    'US30.cash': 'US30',
    'US500.cash': 'US500',
    'XAUUSD': 'GOLD',
    'XAGUSD': 'SILVER',
    'EURUSD': 'EURUSD',
    'GBPUSD': 'GBPUSD',
    'USDJPY': 'USDJPY',
  },
  'IC Markets → FundedNext': {
    'USTEC.cash': 'NAS100',
    'US30.cash': 'US30',
    'US500.cash': 'SPX500',
    'XAUUSD': 'XAUUSD',
    'XAGUSD': 'XAGUSD',
    'EURUSD': 'EURUSD',
    'GBPUSD': 'GBPUSD',
    'USDJPY': 'USDJPY',
  },
  'Oanda → IC Markets': {
    'NAS100_USD': 'USTEC.cash',
    'US30_USD': 'US30.cash',
    'SPX500_USD': 'US500.cash',
    'XAU_USD': 'XAUUSD',
    'XAG_USD': 'XAGUSD',
    'EUR_USD': 'EURUSD',
    'GBP_USD': 'GBPUSD',
    'USD_JPY': 'USDJPY',
  },
};

// Auto-suggest symbol mapping based on similarity
export function suggestSymbolMapping(
  masterSymbol: string,
  receiverSymbols: string[]
): string | null {
  const normalize = (s: string) => s.toLowerCase().replace(/[._-]/g, '');
  const masterNorm = normalize(masterSymbol);
  
  // Direct match
  const directMatch = receiverSymbols.find(s => normalize(s) === masterNorm);
  if (directMatch) return directMatch;
  
  // Common patterns
  const patterns = [
    { master: /ustec|nas100|nasdaq/i, receiver: /ustec|nas100|nasdaq/i },
    { master: /us30|dow/i, receiver: /us30|dow/i },
    { master: /us500|spx|sp500/i, receiver: /us500|spx|sp500/i },
    { master: /xauusd|gold/i, receiver: /xauusd|gold/i },
    { master: /xagusd|silver/i, receiver: /xagusd|silver/i },
  ];
  
  for (const pattern of patterns) {
    if (pattern.master.test(masterSymbol)) {
      const match = receiverSymbols.find(s => pattern.receiver.test(s));
      if (match) return match;
    }
  }
  
  // Fuzzy match - find closest
  let bestMatch: string | null = null;
  let bestScore = 0;
  
  for (const receiverSymbol of receiverSymbols) {
    const receiverNorm = normalize(receiverSymbol);
    let score = 0;
    
    // Count matching characters
    for (let i = 0; i < Math.min(masterNorm.length, receiverNorm.length); i++) {
      if (masterNorm[i] === receiverNorm[i]) score++;
    }
    
    if (score > bestScore && score >= 3) {
      bestScore = score;
      bestMatch = receiverSymbol;
    }
  }
  
  return bestMatch;
}
