import { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useOpenTrades } from "@/hooks/useOpenTrades";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { useAccountFilter } from "@/contexts/AccountFilterContext";
import { Playbook } from "@/types/trading";
import { ModelSelectionPrompt } from "@/components/journal/ModelSelectionPrompt";
import { LiveTradeCompliancePanel } from "@/components/journal/LiveTradeCompliancePanel";
import { TradeSummaryBar } from "@/components/live/TradeSummaryBar";
import { LiveTradeCard } from "@/components/live/LiveTradeCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Activity, 
  Radio,
  Loader2,
  Zap
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function LiveTrades() {
  const location = useLocation();
  const { data: allOpenTrades = [], isLoading } = useOpenTrades();
  const { data: playbooks = [] } = usePlaybooks();
  const { selectedAccountId, selectedAccount } = useAccountFilter();
  
  // Filter open trades by selected account
  const openTrades = useMemo(() => {
    if (selectedAccountId === 'all') return allOpenTrades;
    return allOpenTrades.filter(t => t.account_id === selectedAccountId);
  }, [allOpenTrades, selectedAccountId]);

  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(
    location.state?.selectedTradeId || null
  );
  const [selectedPlaybook, setSelectedPlaybook] = useState<Playbook | null>(null);

  const selectedTrade = openTrades.find(t => t.id === selectedTradeId);

  // Get max trades per session from the selected trade's playbook
  const maxDailyTrades = selectedPlaybook?.max_trades_per_session || undefined;
  
  // Get account ID for trade summary bar
  const summaryAccountId = selectedAccountId !== 'all' 
    ? selectedAccountId 
    : selectedTrade?.account_id;

  // Auto-select first trade if none selected
  useEffect(() => {
    if (!selectedTradeId && openTrades.length > 0) {
      setSelectedTradeId(openTrades[0].id);
    }
  }, [openTrades, selectedTradeId]);

  // When trade is selected, find matching playbook
  useEffect(() => {
    if (selectedTrade?.playbook_id) {
      const pb = playbooks.find(p => p.id === selectedTrade.playbook_id);
      setSelectedPlaybook(pb || null);
    } else if (selectedTrade?.matchedPlaybook) {
      setSelectedPlaybook(selectedTrade.matchedPlaybook);
    } else {
      setSelectedPlaybook(null);
    }
  }, [selectedTrade, playbooks]);

  const handleModelSelected = (playbook: Playbook) => {
    setSelectedPlaybook(playbook);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6 animate-fade-in gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
          <Activity className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">
            Live Trades
            {selectedAccount && (
              <span className="text-lg font-normal text-muted-foreground ml-2">
                • {selectedAccount.name}
              </span>
            )}
          </h1>
          <p className="text-muted-foreground text-sm">
            Real-time position monitoring & compliance
          </p>
        </div>
        {openTrades.length > 0 && (
          <Badge className="bg-profit/10 text-profit border-profit/30 gap-1.5">
            <Zap className="h-3 w-3" />
            Real-time
          </Badge>
        )}
      </div>

      {openTrades.length === 0 ? (
        <Card className="flex-1 flex items-center justify-center border-dashed">
          <CardContent className="text-center py-12">
            <div className="p-4 rounded-full bg-muted/50 w-fit mx-auto mb-4">
              <Activity className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">
              No Open Trades
            </h3>
            <p className="text-muted-foreground text-sm max-w-sm">
              When you open positions, they'll appear here with live compliance tracking
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary Bar */}
          <TradeSummaryBar trades={openTrades} maxDailyTrades={maxDailyTrades} accountId={summaryAccountId} />

          {/* Main Content */}
          <div className="flex-1 grid lg:grid-cols-5 gap-4 min-h-0">
            {/* Left Panel - Trade List */}
            <Card className="lg:col-span-2 flex flex-col border-border/50">
              <CardHeader className="py-3 px-4 border-b border-border/50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Radio className="h-3.5 w-3.5 text-profit animate-pulse" />
                  Open Positions
                </CardTitle>
              </CardHeader>
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-2">
                  {openTrades.map((trade) => (
                    <LiveTradeCard
                      key={trade.id}
                      trade={trade}
                      isSelected={selectedTradeId === trade.id}
                      onClick={() => setSelectedTradeId(trade.id)}
                      showAccountBadge={selectedAccountId === 'all'}
                    />
                  ))}
                </div>
              </ScrollArea>
            </Card>

            {/* Right Panel - Compliance View */}
            <Card className="lg:col-span-3 flex flex-col border-border/50">
              {selectedTrade ? (
                <>
                  <CardHeader className="py-3 px-4 border-b border-border/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "p-2 rounded-lg",
                          selectedTrade.direction === 'buy' 
                            ? "bg-profit/10" 
                            : "bg-loss/10"
                        )}>
                          <Activity className={cn(
                            "h-5 w-5",
                            selectedTrade.direction === 'buy' 
                              ? "text-profit" 
                              : "text-loss"
                          )} />
                        </div>
                        <div>
                          <CardTitle className="text-base flex items-center gap-2">
                            {selectedTrade.symbol}
                            <span className="text-sm font-normal text-muted-foreground uppercase">
                              {selectedTrade.direction}
                            </span>
                          </CardTitle>
                          <div className="text-xs text-muted-foreground">
                            Entry @ {selectedTrade.entry_price} • {selectedTrade.total_lots} lots
                          </div>
                        </div>
                      </div>
                      <Badge variant="outline" className="bg-profit/10 text-profit border-profit/30">
                        <Radio className="h-3 w-3 mr-1 animate-pulse" />
                        LIVE
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 p-4 overflow-auto">
                    {!selectedTrade.playbook_id || !selectedPlaybook ? (
                      <ModelSelectionPrompt 
                        trade={selectedTrade} 
                        onModelSelected={handleModelSelected}
                      />
                    ) : (
                      <LiveTradeCompliancePanel
                        trade={selectedTrade}
                        playbook={selectedPlaybook}
                      />
                    )}
                  </CardContent>
                </>
              ) : (
                <CardContent className="flex-1 flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Select a trade to view compliance</p>
                  </div>
                </CardContent>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
