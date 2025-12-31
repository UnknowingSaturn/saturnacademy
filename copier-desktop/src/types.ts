export interface CopierStatus {
  is_connected: boolean;
  is_running: boolean;
  last_sync: string | null;
  trades_today: number;
  pnl_today: number;
  open_positions: number;
  last_error: string | null;
  config_version: number;
}

export interface Execution {
  id: string;
  timestamp: string;
  event_type: string;
  symbol: string;
  direction: string;
  master_lots: number;
  receiver_lots: number;
  master_price: number;
  executed_price: number | null;
  slippage_pips: number | null;
  status: string;
  error_message: string | null;
  receiver_account: string;
}

export interface Mt5Terminal {
  terminal_id: string;
  path: string;
  broker: string | null;
  has_mql5: boolean;
  master_installed: boolean;
  receiver_installed: boolean;
  account_info?: AccountInfo | null;
}

export interface AccountInfo {
  account_number: string;
  broker: string;
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  leverage: number;
  currency: string;
  server: string;
}

export type CopierRole = 'master' | 'receiver' | 'independent';

export interface WizardState {
  step: number;
  terminals: Mt5Terminal[];
  masterTerminal: Mt5Terminal | null;
  receiverTerminals: Mt5Terminal[];
  setupComplete: boolean;
}

export interface SetupTokenResponse {
  token: string;
  expires_at: string;
  role: CopierRole;
  master_account_id: string | null;
}
