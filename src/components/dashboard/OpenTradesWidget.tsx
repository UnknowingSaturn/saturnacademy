import { useNavigate } from "react-router-dom";
import { useOpenTrades } from "@/hooks/useOpenTrades";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Activity, 
  ArrowUpRight, 
  TrendingUp, 
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  Clock
} from "lucide-react";
import { cn } from "@/lib/utils";

export function OpenTradesWidget() {
  const navigate = useNavigate();
  const { data: openTrades = [], isLoading } = useOpenTrades();

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Open Trades
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="animate-pulse space-y-2">
            <div className="h-10 bg-muted rounded" />
            <div className="h-10 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (openTrades.length === 0) {
    return (
      <Card className="glass-card">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Open Trades
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="text-center py-4 text-muted-foreground text-sm">
            No open trades
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusBadge = (status: 'pending' | 'compliant' | 'violations', hasModel: boolean) => {
    if (!hasModel) {
      return (
        <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-xs">
          <AlertCircle className="h-3 w-3 mr-1" />
          Select Model
        </Badge>
      );
    }

    switch (status) {
      case 'compliant':
        return (
          <Badge variant="outline" className="bg-profit/10 text-profit border-profit/30 text-xs">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Compliant
          </Badge>
        );
      case 'violations':
        return (
          <Badge variant="outline" className="bg-loss/10 text-loss border-loss/30 text-xs">
            <AlertCircle className="h-3 w-3 mr-1" />
            Violations
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-xs">
            <Clock className="h-3 w-3 mr-1" />
            In Progress
          </Badge>
        );
    }
  };

  return (
    <Card className="glass-card">
      <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Open Trades ({openTrades.length})
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => navigate('/live-trades')}
        >
          View All
          <ArrowUpRight className="h-3 w-3 ml-1" />
        </Button>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {openTrades.slice(0, 3).map((trade) => (
          <button
            key={trade.id}
            onClick={() => navigate('/live-trades', { state: { selectedTradeId: trade.id } })}
            className="w-full flex items-center justify-between p-2 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <div className={cn(
                "p-1.5 rounded",
                trade.direction === 'buy' ? "bg-profit/10" : "bg-loss/10"
              )}>
                {trade.direction === 'buy' ? (
                  <TrendingUp className="h-3.5 w-3.5 text-profit" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5 text-loss" />
                )}
              </div>
              <div>
                <div className="text-sm font-medium">{trade.symbol}</div>
                <div className="text-xs text-muted-foreground capitalize">
                  {trade.direction}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {trade.matchedPlaybook ? (
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: trade.matchedPlaybook.color }}
                  />
                  <span className="text-xs text-muted-foreground max-w-[80px] truncate">
                    {trade.matchedPlaybook.name}
                  </span>
                </div>
              ) : null}
              {getStatusBadge(trade.complianceStatus, !!trade.model)}
            </div>
          </button>
        ))}
        
        {openTrades.length > 3 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={() => navigate('/live-trades')}
          >
            +{openTrades.length - 3} more trades
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
