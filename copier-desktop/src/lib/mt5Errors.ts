/**
 * MT5 Trade Server Return Codes
 * Human-readable error messages for common MT5 errors
 */

export interface MT5ErrorInfo {
  code: number;
  shortName: string;
  description: string;
  suggestion: string;
  severity: "info" | "warning" | "error";
}

// Common MT5 error codes mapped to user-friendly messages
const MT5_ERRORS: Record<number, MT5ErrorInfo> = {
  // Success / Info
  10008: {
    code: 10008,
    shortName: "Order Placed",
    description: "Order has been placed successfully.",
    suggestion: "Wait for order to be filled.",
    severity: "info",
  },
  10009: {
    code: 10009,
    shortName: "Request Completed",
    description: "Trade request completed successfully.",
    suggestion: "",
    severity: "info",
  },

  // Common Errors
  10004: {
    code: 10004,
    shortName: "Requote",
    description: "Price changed before execution. A new price was offered.",
    suggestion: "Enable retries or increase max slippage tolerance.",
    severity: "warning",
  },
  10006: {
    code: 10006,
    shortName: "Request Rejected",
    description: "Trade request was rejected by the broker.",
    suggestion: "Check if trading is allowed. The market may be closed.",
    severity: "error",
  },
  10007: {
    code: 10007,
    shortName: "Request Canceled",
    description: "Trade request was canceled by the trader.",
    suggestion: "This is usually intentional. Check if manual confirm mode is on.",
    severity: "info",
  },
  10010: {
    code: 10010,
    shortName: "Only Partial Filled",
    description: "Only part of the requested volume was filled.",
    suggestion: "Check remaining volume and retry if needed.",
    severity: "warning",
  },
  10011: {
    code: 10011,
    shortName: "Processing Error",
    description: "Request processing error on the server side.",
    suggestion: "Wait and retry. Contact broker if persistent.",
    severity: "error",
  },
  10012: {
    code: 10012,
    shortName: "Request Canceled (Timeout)",
    description: "Request timed out before completion.",
    suggestion: "Check network connection and try again.",
    severity: "warning",
  },
  10013: {
    code: 10013,
    shortName: "Invalid Request",
    description: "Invalid trade request parameters.",
    suggestion: "Check lot size, stop loss, and take profit values.",
    severity: "error",
  },
  10014: {
    code: 10014,
    shortName: "Invalid Volume",
    description: "The requested volume is invalid for this symbol.",
    suggestion: "Check minimum/maximum lot size and volume step.",
    severity: "error",
  },
  10015: {
    code: 10015,
    shortName: "Invalid Price",
    description: "The requested price is invalid.",
    suggestion: "Use current market price or check for stale quotes.",
    severity: "error",
  },
  10016: {
    code: 10016,
    shortName: "Invalid Stops",
    description: "Stop Loss or Take Profit is too close to current price.",
    suggestion: "Increase SL/TP distance to meet broker requirements.",
    severity: "error",
  },
  10017: {
    code: 10017,
    shortName: "Trade Disabled",
    description: "Trading is disabled for this account.",
    suggestion: "Check account permissions or contact broker.",
    severity: "error",
  },
  10018: {
    code: 10018,
    shortName: "Market Closed",
    description: "Market is closed for this symbol.",
    suggestion: "Wait for market to open.",
    severity: "warning",
  },
  10019: {
    code: 10019,
    shortName: "Insufficient Funds",
    description: "Not enough free margin to open this trade.",
    suggestion: "Reduce lot size or close some positions.",
    severity: "error",
  },
  10020: {
    code: 10020,
    shortName: "Prices Changed",
    description: "Prices changed significantly since request.",
    suggestion: "Retry with current prices.",
    severity: "warning",
  },
  10021: {
    code: 10021,
    shortName: "No Quotes",
    description: "No quotes available for this symbol.",
    suggestion: "Check if symbol exists and market is open.",
    severity: "error",
  },
  10022: {
    code: 10022,
    shortName: "Invalid Expiration",
    description: "Invalid order expiration date.",
    suggestion: "Check order expiration settings.",
    severity: "error",
  },
  10023: {
    code: 10023,
    shortName: "Order Changed",
    description: "Order state changed during modification.",
    suggestion: "Refresh and try again.",
    severity: "warning",
  },
  10024: {
    code: 10024,
    shortName: "Too Many Requests",
    description: "Too many trade requests from this account.",
    suggestion: "Reduce request frequency. Wait before retrying.",
    severity: "warning",
  },
  10025: {
    code: 10025,
    shortName: "No Changes",
    description: "No changes in the request (nothing to modify).",
    suggestion: "This is informational only.",
    severity: "info",
  },
  10026: {
    code: 10026,
    shortName: "AutoTrading Disabled",
    description: "Autotrading is disabled in the terminal.",
    suggestion: "Enable 'Algo Trading' button in MT5.",
    severity: "error",
  },
  10027: {
    code: 10027,
    shortName: "Client Protection",
    description: "Request blocked by client protection.",
    suggestion: "Check account settings with broker.",
    severity: "error",
  },
  10028: {
    code: 10028,
    shortName: "Frozen Position",
    description: "Request rejected because position is frozen.",
    suggestion: "Wait for freeze period to end.",
    severity: "warning",
  },
  10029: {
    code: 10029,
    shortName: "Invalid Fill Type",
    description: "The fill type is not supported for this symbol.",
    suggestion: "Change order fill type (FOK/IOC/Return).",
    severity: "error",
  },
  10030: {
    code: 10030,
    shortName: "Connection Lost",
    description: "Connection to trade server was lost.",
    suggestion: "Check network connection. MT5 will retry automatically.",
    severity: "error",
  },

  // Additional common errors
  10031: {
    code: 10031,
    shortName: "Only Real Accounts",
    description: "Operation allowed only for real accounts.",
    suggestion: "This operation is not available on demo accounts.",
    severity: "warning",
  },
  10032: {
    code: 10032,
    shortName: "Limit Orders",
    description: "Limit on pending orders reached.",
    suggestion: "Close some pending orders first.",
    severity: "error",
  },
  10033: {
    code: 10033,
    shortName: "Volume Limit",
    description: "Total position volume limit exceeded.",
    suggestion: "Close some positions or reduce new order volume.",
    severity: "error",
  },
  10034: {
    code: 10034,
    shortName: "Position Closed",
    description: "Position was already closed.",
    suggestion: "This is informational. Position may have hit SL/TP.",
    severity: "info",
  },
  10035: {
    code: 10035,
    shortName: "Invalid Close Volume",
    description: "Close volume exceeds position volume.",
    suggestion: "Adjust close volume to match open position.",
    severity: "error",
  },
  10036: {
    code: 10036,
    shortName: "Close Order Already Exists",
    description: "A close order already exists for this position.",
    suggestion: "Wait for existing close order to complete.",
    severity: "warning",
  },
  10038: {
    code: 10038,
    shortName: "Limit Positions",
    description: "Maximum number of open positions reached.",
    suggestion: "Close some positions before opening new ones.",
    severity: "error",
  },
  10039: {
    code: 10039,
    shortName: "Reject Hedge",
    description: "Hedging is not allowed for this account.",
    suggestion: "This account doesn't support hedging mode.",
    severity: "error",
  },
  10040: {
    code: 10040,
    shortName: "Reject Close",
    description: "Position close rejected due to FIFO rule.",
    suggestion: "Close positions in the order they were opened.",
    severity: "error",
  },
};

/**
 * Get error info for an MT5 error code
 */
export function getMT5ErrorInfo(code: number): MT5ErrorInfo {
  return MT5_ERRORS[code] || {
    code,
    shortName: `Error ${code}`,
    description: `Unknown MT5 error code: ${code}`,
    suggestion: "Check MT5 documentation or contact support.",
    severity: "error",
  };
}

/**
 * Parse error message to extract MT5 code if present
 * Handles formats like "Error 10004: Requote" or just error messages
 */
export function parseErrorMessage(errorMessage: string): MT5ErrorInfo | null {
  // Try to extract error code from message
  const codeMatch = errorMessage.match(/\b(10\d{3})\b/);
  if (codeMatch) {
    const code = parseInt(codeMatch[1], 10);
    return getMT5ErrorInfo(code);
  }
  
  // Check for known error keywords
  const lowerMessage = errorMessage.toLowerCase();
  
  if (lowerMessage.includes("requote")) return MT5_ERRORS[10004];
  if (lowerMessage.includes("rejected")) return MT5_ERRORS[10006];
  if (lowerMessage.includes("timeout")) return MT5_ERRORS[10012];
  if (lowerMessage.includes("invalid volume") || lowerMessage.includes("invalid lot")) return MT5_ERRORS[10014];
  if (lowerMessage.includes("invalid price")) return MT5_ERRORS[10015];
  if (lowerMessage.includes("invalid stop")) return MT5_ERRORS[10016];
  if (lowerMessage.includes("market closed") || lowerMessage.includes("market is closed")) return MT5_ERRORS[10018];
  if (lowerMessage.includes("insufficient") || lowerMessage.includes("not enough margin")) return MT5_ERRORS[10019];
  if (lowerMessage.includes("no quotes")) return MT5_ERRORS[10021];
  if (lowerMessage.includes("autotrading") || lowerMessage.includes("algo trading")) return MT5_ERRORS[10026];
  if (lowerMessage.includes("connection")) return MT5_ERRORS[10030];
  
  return null;
}

/**
 * Format error message with enhanced details
 */
export function formatErrorMessage(errorMessage: string): string {
  const errorInfo = parseErrorMessage(errorMessage);
  
  if (errorInfo) {
    return `${errorInfo.shortName}: ${errorInfo.description}`;
  }
  
  return errorMessage;
}
