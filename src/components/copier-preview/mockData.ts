import { CopierStatus, Execution, Mt5Terminal, MasterHeartbeat, MasterPosition, PreviewState } from '@/types/copier-preview';

// Generate a random ID
const randomId = () => Math.random().toString(36).substring(2, 15);

// Mock master terminal
export const mockMasterTerminal: Mt5Terminal = {
  terminal_id: 'terminal_a1b2c3d4e5f6',
  path: 'C:\\Program Files\\MetaTrader 5\\terminal64.exe',
  broker: 'FTMO',
  has_mql5: true,
  master_installed: true,
  receiver_installed: false,
  account_info: {
    account_number: '5000123456',
    broker: 'FTMO',
    balance: 100000,
    equity: 102345.67,
    margin: 2500,
    free_margin: 99845.67,
    leverage: 100,
    currency: 'USD',
    server: 'FTMO-Demo',
  },
};

// Mock receiver terminals
export const mockReceiverTerminals: Mt5Terminal[] = [
  {
    terminal_id: 'terminal_r1234567890',
    path: 'C:\\Program Files\\MetaTrader 5 FundedNext\\terminal64.exe',
    broker: 'FundedNext',
    has_mql5: true,
    master_installed: false,
    receiver_installed: true,
    account_info: {
      account_number: '8001234567',
      broker: 'FundedNext',
      balance: 50000,
      equity: 51234.56,
      margin: 1250,
      free_margin: 49984.56,
      leverage: 100,
      currency: 'USD',
      server: 'FundedNext-Live',
    },
  },
  {
    terminal_id: 'terminal_r0987654321',
    path: 'C:\\Program Files\\MetaTrader 5 IC\\terminal64.exe',
    broker: 'IC Markets',
    has_mql5: true,
    master_installed: false,
    receiver_installed: true,
    account_info: {
      account_number: '1234567890',
      broker: 'IC Markets',
      balance: 25000,
      equity: 25678.90,
      margin: 625,
      free_margin: 25053.90,
      leverage: 500,
      currency: 'USD',
      server: 'ICMarkets-Live02',
    },
  },
  {
    terminal_id: 'terminal_r1122334455',
    path: 'C:\\Program Files\\MetaTrader 5 Pepperstone\\terminal64.exe',
    broker: 'Pepperstone',
    has_mql5: true,
    master_installed: false,
    receiver_installed: true,
    account_info: {
      account_number: '9876543210',
      broker: 'Pepperstone',
      balance: 10000,
      equity: 10123.45,
      margin: 250,
      free_margin: 9873.45,
      leverage: 200,
      currency: 'USD',
      server: 'Pepperstone-Edge01',
    },
  },
];

// Create mock copier status based on preview state
export const createMockStatus = (state: PreviewState): CopierStatus => ({
  is_connected: state.isConnected,
  is_running: state.isRunning,
  last_sync: state.isConnected ? new Date().toISOString() : null,
  trades_today: 7,
  pnl_today: 342.50,
  open_positions: 3,
  last_error: state.showError ? state.errorMessage : null,
  config_version: 12,
});

// Create mock heartbeat
export const createMockHeartbeat = (isConnected: boolean): MasterHeartbeat | null => {
  if (!isConnected) return null;
  return {
    timestamp_utc: new Date().toISOString(),
    terminal_id: mockMasterTerminal.terminal_id,
    account: 5000123456,
    balance: 100000,
    equity: 102345.67,
    open_positions: 3,
  };
};

// Generate mock executions
export const generateMockExecutions = (count: number = 10): Execution[] => {
  const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'GBPJPY', 'AUDUSD'];
  const eventTypes = ['open', 'close', 'modify', 'partial_close'];
  const receivers = ['FundedNext (8001234567)', 'IC Markets (1234567890)', 'Pepperstone (9876543210)'];
  
  const executions: Execution[] = [];
  const now = Date.now();
  
  for (let i = 0; i < count; i++) {
    const isSuccess = Math.random() > 0.15; // 85% success rate
    const isBuy = Math.random() > 0.5;
    const masterLots = +(Math.random() * 2 + 0.1).toFixed(2);
    const slippage = Math.random() * 3;
    
    executions.push({
      id: randomId(),
      timestamp: new Date(now - i * 1000 * 60 * (5 + Math.random() * 30)).toISOString(),
      event_type: eventTypes[Math.floor(Math.random() * eventTypes.length)],
      symbol: symbols[Math.floor(Math.random() * symbols.length)],
      direction: isBuy ? 'buy' : 'sell',
      master_lots: masterLots,
      receiver_lots: +(masterLots * (0.4 + Math.random() * 0.2)).toFixed(2),
      master_price: 1.0856 + Math.random() * 0.01,
      executed_price: isSuccess ? 1.0856 + Math.random() * 0.01 : null,
      slippage_pips: isSuccess ? +slippage.toFixed(1) : null,
      status: isSuccess ? 'success' : 'failed',
      error_message: isSuccess ? null : 'Connection timeout to receiver terminal',
      receiver_account: receivers[Math.floor(Math.random() * receivers.length)],
    });
  }
  
  return executions;
};

// Generate mock positions
export const generateMockPositions = (): MasterPosition[] => [
  {
    position_id: 123456789,
    symbol: 'EURUSD',
    direction: 'buy',
    volume: 1.00,
    open_price: 1.08567,
    sl: 1.08200,
    tp: 1.09200,
  },
  {
    position_id: 123456790,
    symbol: 'XAUUSD',
    direction: 'sell',
    volume: 0.50,
    open_price: 2045.50,
    sl: 2055.00,
    tp: 2020.00,
  },
  {
    position_id: 123456791,
    symbol: 'GBPJPY',
    direction: 'buy',
    volume: 0.25,
    open_price: 189.456,
    sl: 188.900,
    tp: 190.500,
  },
];

// Default preview state
export const defaultPreviewState: PreviewState = {
  isConnected: true,
  isRunning: true,
  showError: false,
  errorMessage: 'Failed to connect to receiver terminal: Connection timeout',
};
