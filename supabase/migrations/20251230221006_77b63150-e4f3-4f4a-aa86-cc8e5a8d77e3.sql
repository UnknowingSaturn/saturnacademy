-- Add risk_percent column for idea/paper/missed trades
ALTER TABLE trades 
ADD COLUMN risk_percent numeric;

COMMENT ON COLUMN trades.risk_percent IS 
  'Percentage of balance/equity risked on this trade (for idea/paper/missed trades)';