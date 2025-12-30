import { Trade } from "@/types/trading";
import { useTrades } from "@/hooks/useTrades";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  TrendingUp, 
  TrendingDown, 
  Shield, 
  Activity,
  Target
} from "lucide-react";
import { cn } from "@/lib/utils";
import { startOfDay, format } from "date-fns";

interface TradeSummaryBarProps {
  trades: Trade[];
  maxDailyTrades?: number;
  accountId?: string;
}

export function TradeSummaryBar({ trades, maxDailyTrades, accountId }: TradeSummaryBarProps) {
  const totalLongs = trades.filter(t => t.direction === 'buy').length;
  const totalShorts = trades.filter(t => t.direction === 'sell').length;
  
  // Calculate total risk (lots as proxy since we don't have live P&L)
  const totalLots = trades.reduce((sum, t) => sum + t.total_lots, 0);
  
  // Calculate R exposure if SL is set
  const tradesWithSL = trades.filter(t => t.sl_initial);
  const rExposure = tradesWithSL.length;

  // Fetch today's trades for the specific account
  const todayStr = format(startOfDay(new Date()), 'yyyy-MM-dd');
  const { data: todayAccountTrades = [] } = useTrades(
    accountId ? {
      accountId,
      dateFrom: todayStr,
      isArchived: false
    } : undefined
  );

  return (
    <Card className="p-4 border-border/50 bg-card/50 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-6 flex-wrap">
        {/* Positions Overview */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{trades.length} Open</span>
          </div>
          
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-1.5">
              <div className="p-1 rounded bg-profit/10">
                <TrendingUp className="h-3 w-3 text-profit" />
              </div>
              <span className="text-muted-foreground">{totalLongs}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="p-1 rounded bg-loss/10">
                <TrendingDown className="h-3 w-3 text-loss" />
              </div>
              <span className="text-muted-foreground">{totalShorts}</span>
            </div>
          </div>
        </div>

        {/* Exposure */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              <span className="font-medium">{totalLots.toFixed(2)}</span>
              <span className="text-muted-foreground ml-1">lots</span>
            </span>
          </div>
          
          {rExposure > 0 && (
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                <span className="font-medium">{rExposure}</span>
                <span className="text-muted-foreground ml-1">with SL</span>
              </span>
            </div>
          )}
        </div>

        {/* Daily Trade Count - per account */}
        {maxDailyTrades && accountId && (
          <Badge 
            variant="outline" 
            className={cn(
              "text-xs",
              todayAccountTrades.length >= maxDailyTrades 
                ? "bg-loss/10 text-loss border-loss/30" 
                : "bg-muted text-muted-foreground"
            )}
          >
            Today: {todayAccountTrades.length}/{maxDailyTrades}
          </Badge>
        )}
      </div>
    </Card>
  );
}
