import { useState, useMemo } from "react";
import { useArchivedTrades, useRestoreTrades } from "@/hooks/useTrades";
import { BulkActionBar } from "./BulkActionBar";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArchiveRestore } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateET, formatTimeET } from "@/lib/time";
import { format } from "date-fns";

export function ArchivedTradesView() {
  const { data: trades = [], isLoading } = useArchivedTrades();
  const restoreTrades = useRestoreTrades();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const sortedTrades = useMemo(() => {
    return [...trades].sort((a, b) => {
      const dateA = a.archived_at ? new Date(a.archived_at).getTime() : 0;
      const dateB = b.archived_at ? new Date(b.archived_at).getTime() : 0;
      return dateB - dateA;
    });
  }, [trades]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === trades.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(trades.map((t) => t.id)));
    }
  };

  const handleBulkRestore = async () => {
    await restoreTrades.mutateAsync(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const handleSingleRestore = async (id: string) => {
    await restoreTrades.mutateAsync([id]);
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No archived trades</p>
        <p className="text-sm">Archived trades will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2 bg-muted/30 rounded-lg text-sm text-muted-foreground">
        <Checkbox
          checked={selectedIds.size === trades.length && trades.length > 0}
          onCheckedChange={toggleSelectAll}
        />
        <span className="flex-1">
          {trades.length} archived trade{trades.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Trades list */}
      <div className="space-y-1">
        {sortedTrades.map((trade) => {
          const isSelected = selectedIds.has(trade.id);
          const result = trade.is_open
            ? "open"
            : (trade.net_pnl || 0) > 0
            ? "win"
            : (trade.net_pnl || 0) < 0
            ? "loss"
            : "be";

          return (
            <div
              key={trade.id}
              className={cn(
                "flex items-center gap-3 px-3 py-3 rounded-lg border transition-colors",
                isSelected ? "bg-primary/5 border-primary/30" : "bg-card border-border hover:bg-muted/30"
              )}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => toggleSelect(trade.id)}
              />

              {/* Trade info */}
              <div className="flex-1 flex items-center gap-4 min-w-0">
                <div className="flex flex-col">
                  <span className="font-medium text-sm">{trade.symbol}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateET(trade.entry_time)} {formatTimeET(trade.entry_time)}
                  </span>
                </div>

                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs",
                    trade.direction === "buy"
                      ? "border-emerald-500/50 text-emerald-400"
                      : "border-red-500/50 text-red-400"
                  )}
                >
                  {trade.direction.toUpperCase()}
                </Badge>

                <div
                  className={cn(
                    "text-sm font-medium",
                    result === "win" && "text-emerald-400",
                    result === "loss" && "text-red-400",
                    result === "be" && "text-muted-foreground"
                  )}
                >
                  {trade.net_pnl !== null
                    ? `${trade.net_pnl >= 0 ? "+" : ""}$${trade.net_pnl.toFixed(2)}`
                    : "-"}
                </div>

                {trade.r_multiple_actual !== null && (
                  <div className="text-xs text-muted-foreground">
                    {trade.r_multiple_actual >= 0 ? "+" : ""}
                    {trade.r_multiple_actual.toFixed(2)}R
                  </div>
                )}

                <div className="text-xs text-muted-foreground ml-auto">
                  Archived{" "}
                  {trade.archived_at
                    ? format(new Date(trade.archived_at), "MMM d, yyyy")
                    : "unknown"}
                </div>
              </div>

              {/* Restore button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSingleRestore(trade.id)}
                disabled={restoreTrades.isPending}
              >
                <ArchiveRestore className="h-4 w-4 mr-1" />
                Restore
              </Button>
            </div>
          );
        })}
      </div>

      {/* Bulk action bar */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        onAction={handleBulkRestore}
        onClear={() => setSelectedIds(new Set())}
        isLoading={restoreTrades.isPending}
        mode="restore"
      />
    </div>
  );
}
