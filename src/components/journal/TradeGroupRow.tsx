import { useState } from "react";
import { TradeGroup } from "@/hooks/useTradeGroups";
import { Trade, Account } from "@/types/trading";
import { cn } from "@/lib/utils";
import { formatDateET, formatTimeET, getDayNameET } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";

interface TradeGroupRowProps {
  group: TradeGroup;
  accounts?: Account[];
  onTradeClick: (trade: Trade) => void;
  gridCols: string;
  activeColumns: string[];
}

export function TradeGroupRow({ 
  group, 
  accounts, 
  onTradeClick, 
  gridCols,
  activeColumns 
}: TradeGroupRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getAccountName = (accountId: string | null) => {
    if (!accountId) return "—";
    const account = accounts?.find(a => a.id === accountId);
    return account?.name || "—";
  };

  const getResultBadge = () => {
    const pnl = group.combined_net_pnl;
    if (group.is_open) return { label: "Open", color: "muted" };
    if (pnl > 0) return { label: "Win", color: "profit" };
    if (pnl < 0) return { label: "Loss", color: "loss" };
    return { label: "BE", color: "breakeven" };
  };

  const result = getResultBadge();
  const day = getDayNameET(group.first_entry_time);
  const primaryTrade = group.trades[0];

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <CollapsibleTrigger asChild>
        <div
          className={cn(
            "grid gap-2 px-4 py-2 items-center",
            "hover:bg-accent/30 transition-colors cursor-pointer",
            "bg-muted/20 border-l-4",
            group.combined_net_pnl > 0 && "border-l-profit",
            group.combined_net_pnl < 0 && "border-l-loss",
            group.combined_net_pnl === 0 && "border-l-muted"
          )}
          style={{ gridTemplateColumns: gridCols }}
        >
          {/* Checkbox placeholder - groups can't be individually selected */}
          <div className="flex items-center justify-center">
            <Layers className="w-4 h-4 text-muted-foreground" />
          </div>

          {activeColumns.map(key => {
            if (key === 'trade_number') {
              return (
                <div key={key} className="text-sm font-mono-numbers text-muted-foreground flex items-center gap-1">
                  <Badge variant="secondary" className="text-xs">
                    {group.trades.length} trades
                  </Badge>
                </div>
              );
            }

            if (key === 'entry_time') {
              return (
                <div key={key} className="text-sm">
                  <div className="font-medium">{formatDateET(group.first_entry_time)}</div>
                  <div className="text-xs text-muted-foreground">{formatTimeET(group.first_entry_time)}</div>
                </div>
              );
            }

            if (key === 'day') {
              return <div key={key} className="text-sm text-muted-foreground">{day}</div>;
            }

            if (key === 'account') {
              return (
                <div key={key} className="text-sm text-muted-foreground">
                  <div className="flex flex-wrap gap-1">
                    {group.account_ids.slice(0, 2).map(id => (
                      <Badge key={id} variant="outline" className="text-xs">
                        {getAccountName(id)}
                      </Badge>
                    ))}
                    {group.account_ids.length > 2 && (
                      <Badge variant="outline" className="text-xs">
                        +{group.account_ids.length - 2}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            }

            if (key === 'symbol') {
              return <div key={key} className="font-semibold text-sm">{group.symbol}</div>;
            }

            if (key === 'session') {
              return (
                <div key={key}>
                  <Badge variant="secondary" className="text-xs">
                    {primaryTrade?.session || "—"}
                  </Badge>
                </div>
              );
            }

            if (key === 'model') {
              return (
                <div key={key}>
                  {primaryTrade?.playbook?.name ? (
                    <Badge 
                      variant="secondary" 
                      className="text-xs"
                      style={{ backgroundColor: primaryTrade.playbook.color + "20" }}
                    >
                      {primaryTrade.playbook.name}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </div>
              );
            }

            if (key === 'r_multiple_actual') {
              return (
                <div key={key} className="text-right">
                  <span
                    className={cn(
                      "font-mono-numbers font-bold text-sm",
                      group.combined_r_multiple !== null && group.combined_r_multiple >= 0 && "text-profit",
                      group.combined_r_multiple !== null && group.combined_r_multiple < 0 && "text-loss"
                    )}
                  >
                    {group.combined_r_multiple !== null
                      ? `${group.combined_r_multiple >= 0 ? "+" : ""}${group.combined_r_multiple.toFixed(1)}R`
                      : "—"}
                  </span>
                  <div className="text-xs text-muted-foreground">avg</div>
                </div>
              );
            }

            if (key === 'result') {
              return (
                <div key={key} className="text-center">
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-xs",
                      result.color === "profit" && "bg-profit/20 text-profit",
                      result.color === "loss" && "bg-loss/20 text-loss",
                      result.color === "breakeven" && "bg-breakeven/20 text-breakeven",
                      result.color === "muted" && "bg-muted/20 text-muted-foreground"
                    )}
                  >
                    {result.label}
                  </Badge>
                </div>
              );
            }

            if (key === 'net_pnl') {
              return (
                <div key={key} className="text-right">
                  <span
                    className={cn(
                      "font-mono-numbers font-bold text-sm",
                      group.combined_net_pnl >= 0 ? "text-profit" : "text-loss"
                    )}
                  >
                    {group.combined_net_pnl >= 0 ? "+" : ""}
                    ${Math.abs(group.combined_net_pnl).toFixed(2)}
                  </span>
                  <div className="text-xs text-muted-foreground">combined</div>
                </div>
              );
            }

            // Default: show from primary trade
            if (key === 'direction') {
              return (
                <div key={key}>
                  <Badge variant={group.direction === 'buy' ? 'default' : 'destructive'} className="text-xs">
                    {group.direction.toUpperCase()}
                  </Badge>
                </div>
              );
            }

            return <div key={key} className="text-sm text-muted-foreground">—</div>;
          })}

          {/* Expand/Collapse indicator */}
          <div className="flex items-center justify-center">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="bg-muted/10 border-l-4 border-l-transparent">
          {group.trades.map((trade, idx) => (
            <div
              key={trade.id}
              className={cn(
                "grid gap-2 px-4 py-2 items-center ml-4",
                "hover:bg-accent/20 transition-colors cursor-pointer",
                "border-l-2",
                trade.net_pnl && trade.net_pnl > 0 && "border-l-profit/50",
                trade.net_pnl && trade.net_pnl < 0 && "border-l-loss/50",
                idx !== group.trades.length - 1 && "border-b border-border/50"
              )}
              style={{ gridTemplateColumns: gridCols }}
              onClick={() => onTradeClick(trade)}
            >
              {/* Indent indicator */}
              <div className="text-xs text-muted-foreground text-center">
                └
              </div>

              {activeColumns.map(key => {
                if (key === 'trade_number') {
                  return (
                    <div key={key} className="text-sm font-mono-numbers text-muted-foreground">
                      #{trade.trade_number || "—"}
                    </div>
                  );
                }

                if (key === 'entry_time') {
                  return (
                    <div key={key} className="text-sm">
                      <div className="font-medium text-muted-foreground">{formatDateET(trade.entry_time)}</div>
                      <div className="text-xs text-muted-foreground">{formatTimeET(trade.entry_time)}</div>
                    </div>
                  );
                }

                if (key === 'account') {
                  return (
                    <div key={key} className="text-sm text-muted-foreground truncate">
                      {getAccountName(trade.account_id)}
                    </div>
                  );
                }

                if (key === 'symbol') {
                  return <div key={key} className="text-sm text-muted-foreground">{trade.symbol}</div>;
                }

                if (key === 'r_multiple_actual') {
                  return (
                    <div key={key} className="text-right">
                      <span
                        className={cn(
                          "font-mono-numbers text-sm",
                          trade.r_multiple_actual !== null && trade.r_multiple_actual >= 0 && "text-profit",
                          trade.r_multiple_actual !== null && trade.r_multiple_actual < 0 && "text-loss"
                        )}
                      >
                        {trade.r_multiple_actual !== null
                          ? `${trade.r_multiple_actual >= 0 ? "+" : ""}${trade.r_multiple_actual.toFixed(1)}R`
                          : "—"}
                      </span>
                    </div>
                  );
                }

                if (key === 'net_pnl') {
                  return (
                    <div key={key} className="text-right">
                      <span
                        className={cn(
                          "font-mono-numbers text-sm",
                          (trade.net_pnl || 0) >= 0 ? "text-profit" : "text-loss"
                        )}
                      >
                        {(trade.net_pnl || 0) >= 0 ? "+" : ""}
                        ${Math.abs(trade.net_pnl || 0).toFixed(2)}
                      </span>
                    </div>
                  );
                }

                if (key === 'result') {
                  const pnl = trade.net_pnl || 0;
                  let label = "BE";
                  let color = "breakeven";
                  if (trade.is_open) { label = "Open"; color = "muted"; }
                  else if (pnl > 0) { label = "Win"; color = "profit"; }
                  else if (pnl < 0) { label = "Loss"; color = "loss"; }

                  return (
                    <div key={key} className="text-center">
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-xs",
                          color === "profit" && "bg-profit/20 text-profit",
                          color === "loss" && "bg-loss/20 text-loss",
                          color === "breakeven" && "bg-breakeven/20 text-breakeven",
                          color === "muted" && "bg-muted/20 text-muted-foreground"
                        )}
                      >
                        {label}
                      </Badge>
                    </div>
                  );
                }

                // For other columns, show muted placeholder
                return <div key={key} className="text-sm text-muted-foreground/50">—</div>;
              })}

              <div className="flex items-center justify-center">
                <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
