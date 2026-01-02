import { SafetyConfig, RiskConfig } from "../types";

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

/**
 * Validate risk configuration
 */
export function validateRiskConfig(config: RiskConfig): ValidationResult {
  const errors: ValidationError[] = [];

  // Validate risk value based on mode
  switch (config.mode) {
    case "fixed_lot":
      if (config.value < 0.01) {
        errors.push({
          field: "risk.value",
          message: "Lot size must be at least 0.01",
        });
      }
      if (config.value > 100) {
        errors.push({
          field: "risk.value",
          message: "Lot size cannot exceed 100 lots",
        });
      }
      break;

    case "lot_multiplier":
    case "balance_multiplier":
      if (config.value <= 0) {
        errors.push({
          field: "risk.value",
          message: "Multiplier must be greater than 0",
        });
      }
      if (config.value > 10) {
        errors.push({
          field: "risk.value",
          message: "Multiplier cannot exceed 10x",
        });
      }
      break;

    case "risk_percent":
      if (config.value <= 0) {
        errors.push({
          field: "risk.value",
          message: "Risk percentage must be greater than 0",
        });
      }
      if (config.value > 10) {
        errors.push({
          field: "risk.value",
          message: "Risk percentage should not exceed 10% for safety",
        });
      }
      break;

    case "risk_dollar":
      if (config.value <= 0) {
        errors.push({
          field: "risk.value",
          message: "Risk amount must be greater than 0",
        });
      }
      if (config.value > 10000) {
        errors.push({
          field: "risk.value",
          message: "Risk amount seems too high. Please verify.",
        });
      }
      break;
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate safety configuration
 */
export function validateSafetyConfig(config: SafetyConfig): ValidationResult {
  const errors: ValidationError[] = [];

  // Max slippage
  if (config.max_slippage_pips < 0) {
    errors.push({
      field: "safety.max_slippage_pips",
      message: "Max slippage cannot be negative",
    });
  }
  if (config.max_slippage_pips > 50) {
    errors.push({
      field: "safety.max_slippage_pips",
      message: "Max slippage is unusually high (>50 pips)",
    });
  }

  // Max daily loss
  if (config.max_daily_loss_r <= 0) {
    errors.push({
      field: "safety.max_daily_loss_r",
      message: "Max daily loss must be greater than 0",
    });
  }
  if (config.max_daily_loss_r > 10) {
    errors.push({
      field: "safety.max_daily_loss_r",
      message: "Max daily loss should not exceed 10R for safety",
    });
  }

  // Max drawdown (if set)
  if (config.max_drawdown_percent !== undefined) {
    if (config.max_drawdown_percent <= 0) {
      errors.push({
        field: "safety.max_drawdown_percent",
        message: "Max drawdown must be greater than 0",
      });
    }
    if (config.max_drawdown_percent > 50) {
      errors.push({
        field: "safety.max_drawdown_percent",
        message: "Max drawdown should not exceed 50%",
      });
    }
  }

  // Poll interval
  if (config.poll_interval_ms < 100) {
    errors.push({
      field: "safety.poll_interval_ms",
      message: "Poll interval cannot be less than 100ms",
    });
  }
  if (config.poll_interval_ms > 10000) {
    errors.push({
      field: "safety.poll_interval_ms",
      message: "Poll interval should not exceed 10 seconds",
    });
  }

  // Retry attempts
  if (config.max_retry_attempts !== undefined) {
    if (config.max_retry_attempts < 0) {
      errors.push({
        field: "safety.max_retry_attempts",
        message: "Retry attempts cannot be negative",
      });
    }
    if (config.max_retry_attempts > 10) {
      errors.push({
        field: "safety.max_retry_attempts",
        message: "More than 10 retry attempts is not recommended",
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate symbol mapping
 */
export function validateSymbolMapping(
  masterSymbol: string,
  receiverSymbol: string
): ValidationResult {
  const errors: ValidationError[] = [];

  if (!masterSymbol.trim()) {
    errors.push({
      field: "master_symbol",
      message: "Master symbol cannot be empty",
    });
  }

  if (!receiverSymbol.trim()) {
    errors.push({
      field: "receiver_symbol",
      message: "Receiver symbol cannot be empty",
    });
  }

  // Basic symbol format validation (alphanumeric, some special chars)
  const symbolRegex = /^[A-Za-z0-9._-]+$/;
  
  if (masterSymbol && !symbolRegex.test(masterSymbol)) {
    errors.push({
      field: "master_symbol",
      message: "Invalid symbol format",
    });
  }

  if (receiverSymbol && !symbolRegex.test(receiverSymbol)) {
    errors.push({
      field: "receiver_symbol",
      message: "Invalid symbol format",
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Get error message for a specific field
 */
export function getFieldError(
  errors: ValidationError[],
  field: string
): string | undefined {
  return errors.find((e) => e.field === field)?.message;
}
