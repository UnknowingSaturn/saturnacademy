import { cn } from "@/lib/utils";

interface TradeProgressBarProps {
  entryPrice: number;
  currentPrice: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  direction: 'buy' | 'sell';
}

export function TradeProgressBar({
  entryPrice,
  currentPrice,
  stopLoss,
  takeProfit,
  direction,
}: TradeProgressBarProps) {
  if (!stopLoss && !takeProfit) return null;

  // For buy: SL is below entry, TP is above
  // For sell: SL is above entry, TP is below
  const sl = stopLoss ?? entryPrice;
  const tp = takeProfit ?? entryPrice;
  
  // Calculate the range
  const minPrice = Math.min(sl, tp, entryPrice, currentPrice);
  const maxPrice = Math.max(sl, tp, entryPrice, currentPrice);
  const range = maxPrice - minPrice || 1;
  
  // Calculate positions as percentages
  const getPosition = (price: number) => ((price - minPrice) / range) * 100;
  
  const entryPosition = getPosition(entryPrice);
  const currentPosition = getPosition(currentPrice);
  
  // Determine if trade is in profit
  const isProfit = direction === 'buy' 
    ? currentPrice > entryPrice 
    : currentPrice < entryPrice;

  return (
    <div className="relative h-2 bg-muted rounded-full overflow-hidden">
      {/* Stop Loss Zone */}
      {stopLoss && (
        <div
          className="absolute top-0 h-full bg-loss/20"
          style={{
            left: direction === 'buy' ? 0 : `${getPosition(stopLoss)}%`,
            width: direction === 'buy' 
              ? `${getPosition(stopLoss)}%` 
              : `${100 - getPosition(stopLoss)}%`,
          }}
        />
      )}
      
      {/* Take Profit Zone */}
      {takeProfit && (
        <div
          className="absolute top-0 h-full bg-profit/20"
          style={{
            left: direction === 'buy' ? `${getPosition(takeProfit)}%` : 0,
            width: direction === 'buy' 
              ? `${100 - getPosition(takeProfit)}%` 
              : `${getPosition(takeProfit)}%`,
          }}
        />
      )}
      
      {/* Progress Fill */}
      <div
        className={cn(
          "absolute top-0 h-full transition-all duration-300",
          isProfit ? "bg-profit/40" : "bg-loss/40"
        )}
        style={{
          left: Math.min(entryPosition, currentPosition) + '%',
          width: Math.abs(currentPosition - entryPosition) + '%',
        }}
      />
      
      {/* Entry Marker */}
      <div
        className="absolute top-0 w-0.5 h-full bg-foreground/50"
        style={{ left: `${entryPosition}%` }}
      />
      
      {/* Current Price Marker */}
      <div
        className={cn(
          "absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ring-2 ring-background",
          isProfit ? "bg-profit" : "bg-loss"
        )}
        style={{ left: `calc(${currentPosition}% - 4px)` }}
      />
    </div>
  );
}
