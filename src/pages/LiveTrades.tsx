import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useOpenTrades } from "@/hooks/useOpenTrades";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { Trade, Playbook } from "@/types/trading";
import { ModelSelectionPrompt } from "@/components/journal/ModelSelectionPrompt";
import { LiveTradeCompliancePanel } from "@/components/journal/LiveTradeCompliancePanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  Activity, 
  TrendingUp, 
  TrendingDown, 
  AlertCircle, 
  CheckCircle2, 
  Clock,
  ArrowRight,
  Radio,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrokerDateTimeET } from "@/lib/time";

export default function LiveTrades() {
  const location = useLocation();
  const { data: openTrades = [], isLoading } = useOpenTrades();
  const { data: playbooks = [] } = usePlaybooks();
  
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(
    location.state?.selectedTradeId || null
  );
  const [selectedPlaybook, setSelectedPlaybook] = useState<Playbook | null>(null);

  const selectedTrade = openTrades.find(t => t.id === selectedTradeId);

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
    } else if (selectedTrade?.playbook) {
      setSelectedPlaybook(selectedTrade.playbook);
    } else {
      setSelectedPlaybook(null);
    }
  }, [selectedTrade, playbooks]);

  const handleModelSelected = (playbook: Playbook) => {
    setSelectedPlaybook(playbook);
  };

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-xl bg-primary/10">
          <Activity className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Live Trades</h1>
          <p className="text-muted-foreground text-sm">
            Monitor and manage your open positions
          </p>
        </div>
        {openTrades.length > 0 && (
          <Badge className="ml-auto bg-primary/10 text-primary border-primary/30">
            <Radio className="h-3 w-3 mr-1 animate-pulse" />
            {openTrades.length} Active
          </Badge>
        )}
      </div>

      {openTrades.length === 0 ? (
        <Card className="flex-1 flex items-center justify-center">
          <CardContent className="text-center py-12">
            <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              No Open Trades
            </h3>
            <p className="text-muted-foreground text-sm">
              Open positions will appear here with their compliance status
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex-1 grid lg:grid-cols-3 gap-6 min-h-0">
          {/* Left Panel - Trade List */}
          <Card className="lg:col-span-1 flex flex-col">
            <CardHeader className="py-3 px-4 border-b border-border">
              <CardTitle className="text-sm">Open Positions</CardTitle>
            </CardHeader>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {openTrades.map((trade) => (
                  <button
                    key={trade.id}
                    onClick={() => setSelectedTradeId(trade.id)}
                    className={cn(
                      "w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left",
                      selectedTradeId === trade.id
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "p-1.5 rounded",
                        trade.direction === 'buy' ? "bg-profit/10" : "bg-loss/10"
                      )}>
                        {trade.direction === 'buy' ? (
                          <TrendingUp className="h-4 w-4 text-profit" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-loss" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-sm">{trade.symbol}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatBrokerDateTimeET(trade.entry_time, trade.account?.broker_utc_offset ?? 0)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {trade.matchedPlaybook && (
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: trade.matchedPlaybook.color }}
                        />
                      )}
                      {getStatusBadge(trade.complianceStatus, !!trade.playbook_id)}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </Card>

          {/* Right Panel - Compliance View */}
          <Card className="lg:col-span-2 flex flex-col">
            {selectedTrade ? (
              <>
                <CardHeader className="py-3 px-4 border-b border-border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "p-2 rounded-lg",
                        selectedTrade.direction === 'buy' ? "bg-profit/10" : "bg-loss/10"
                      )}>
                        {selectedTrade.direction === 'buy' ? (
                          <TrendingUp className="h-5 w-5 text-profit" />
                        ) : (
                          <TrendingDown className="h-5 w-5 text-loss" />
                        )}
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          {selectedTrade.symbol} 
                          <span className="ml-2 text-sm font-normal text-muted-foreground capitalize">
                            {selectedTrade.direction}
                          </span>
                        </CardTitle>
                        <div className="text-xs text-muted-foreground">
                          Entry @ {selectedTrade.entry_price} • {selectedTrade.total_lots} lots
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
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
                  <ArrowRight className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Select a trade to view compliance</p>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
