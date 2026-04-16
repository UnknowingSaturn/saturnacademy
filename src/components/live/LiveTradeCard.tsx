import { useState, useEffect } from "react";
import { Trade, Playbook } from "@/types/trading";
import { Badge } from "@/components/ui/badge";
import { 
  TrendingUp, 
  TrendingDown, 
  CheckCircle2, 
  AlertCircle, 
  Clock,
  Timer,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrokerDateTimeET } from "@/lib/time";
import { TradeProgressBar } from "./TradeProgressBar";
import { CloseLiveTradeDialog } from "./CloseLiveTradeDialog";
import { useUpdateTrade } from "@/hooks/useTrades";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface LiveTradeCardProps {
  trade: Trade & {
    matchedPlaybook?: Playbook;
    complianceStatus: 'pending' | 'compliant' | 'violations';
  };
  isSelected: boolean;
  onClick: () => void;
  showAccountBadge?: boolean;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function LiveTradeCard({ trade, isSelected, onClick, showAccountBadge = false }: LiveTradeCardProps) {
  const [duration, setDuration] = useState(0);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const updateTrade = useUpdateTrade();

  // Live duration timer
  useEffect(() => {
    const entryTime = new Date(trade.entry_time).getTime();
    
    const updateDuration = () => {
      const now = Date.now();
      setDuration(Math.floor((now - entryTime) / 1000));
    };

    updateDuration();
    const interval = setInterval(updateDuration, 60000);
    
    return () => clearInterval(interval);
  }, [trade.entry_time]);

  const handleCloseTrade = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateTrade.mutate({
      id: trade.id,
      is_open: false,
      exit_time: new Date().toISOString(),
      net_pnl: 0,
      gross_pnl: 0,
    });
  };

  const getStatusBadge = () => {
    if (!trade.playbook_id) {
      return (
        <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-xs">
          <AlertCircle className="h-3 w-3 mr-1" />
          No Model
        </Badge>
      );
    }

    switch (trade.complianceStatus) {
      case 'compliant':
        return (
          <Badge variant="outline" className="bg-profit/10 text-profit border-profit/30 text-xs">
            <CheckCircle2 className="h-3 w-3" />
          </Badge>
        );
      case 'violations':
        return (
          <Badge variant="outline" className="bg-loss/10 text-loss border-loss/30 text-xs">
            <AlertCircle className="h-3 w-3" />
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-xs">
            <Clock className="h-3 w-3" />
          </Badge>
        );
    }
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full p-4 rounded-xl border transition-all text-left space-y-3 relative group",
        isSelected
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border/50 hover:border-border hover:bg-muted/30"
      )}
    >
      {/* Action buttons (Close trade + Dismiss) */}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <div
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            setCloseDialogOpen(true);
          }}
          className="p-1 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary cursor-pointer"
          title="Close trade with exit price"
        >
          <XCircle className="h-3.5 w-3.5" />
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <div
              role="button"
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive cursor-pointer"
              title="Dismiss stuck trade"
            >
              <X className="h-3.5 w-3.5" />
            </div>
          </AlertDialogTrigger>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>Dismiss this trade?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the trade from the live view and mark it as closed with $0 P&L. Use this for stuck trades that are no longer open in your terminal.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleCloseTrade}>
                Dismiss
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <CloseLiveTradeDialog
        open={closeDialogOpen}
        onOpenChange={setCloseDialogOpen}
        trade={trade}
      />

      {/* Header Row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "p-2 rounded-lg",
            trade.direction === 'buy' ? "bg-profit/10" : "bg-loss/10"
          )}>
            {trade.direction === 'buy' ? (
              <TrendingUp className="h-4 w-4 text-profit" />
            ) : (
              <TrendingDown className="h-4 w-4 text-loss" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{trade.symbol}</span>
              <span className="text-xs text-muted-foreground uppercase">
                {trade.direction}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {formatBrokerDateTimeET(trade.entry_time, trade.account?.broker_utc_offset ?? 0)}
            </div>
            {showAccountBadge && trade.account && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 mt-0.5">
                {trade.account.name}
              </Badge>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {trade.matchedPlaybook && (
            <div
              className="w-2.5 h-2.5 rounded-full ring-2 ring-background"
              style={{ backgroundColor: trade.matchedPlaybook.color }}
              title={trade.matchedPlaybook.name}
            />
          )}
          {getStatusBadge()}
        </div>
      </div>

      {/* Trade Details */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-muted-foreground">Entry</div>
          <div className="font-medium">{trade.entry_price}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Size</div>
          <div className="font-medium">{trade.total_lots} lots</div>
        </div>
        <div>
          <div className="text-muted-foreground flex items-center gap-1">
            <Timer className="h-3 w-3" />
            Duration
          </div>
          <div className="font-medium">{formatDuration(duration)}</div>
        </div>
      </div>

      {/* SL/TP Progress Bar */}
      {(trade.sl_initial || trade.tp_initial) && (
        <TradeProgressBar
          entryPrice={trade.entry_price}
          currentPrice={trade.entry_price}
          stopLoss={trade.sl_initial}
          takeProfit={trade.tp_initial}
          direction={trade.direction}
        />
      )}

      {/* SL/TP Values */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1">
          <span className="text-loss">SL:</span>
          <span className="font-medium">
            {trade.sl_initial ?? '—'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-profit">TP:</span>
          <span className="font-medium">
            {trade.tp_initial ?? '—'}
          </span>
        </div>
      </div>
    </button>
  );
}