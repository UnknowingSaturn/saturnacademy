import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, RefreshCw, Wrench, MoonStar } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface DriftTrade {
  id: string;
  ticket: number;
  symbol: string;
  direction: string;
  entry_time: string;
  entry_price: number;
  total_lots: number;
  terminal_id: string;
  account_id: string;
  snapshot_received_at: string;
  active_login: string | null;
}

interface DormantAccount {
  id: string;
  name: string;
  account_number: string | null;
  broker: string | null;
  last_sync_at: string | null;
  pending_repairs?: number;
}

/**
 * Surfaces trades that the broker probably closed but the EA missed the deal
 * event for. Non-destructive — clicking Repair pulls the real close from
 * MT5 deal history via the existing repair-snapshot-closed function.
 */
export function DriftTray() {
  const [drift, setDrift] = useState<DriftTrade[]>([]);
  const [dormant, setDormant] = useState<DormantAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("trades-drift");
      if (error) throw error;
      setDrift(data?.drift_trades ?? []);
      setDormant(data?.dormant_accounts ?? []);
    } catch (err) {
      console.error("DriftTray load failed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const repair = async (trade: DriftTrade) => {
    try {
      setRepairing(trade.id);
      const { error } = await supabase.functions.invoke("repair-snapshot-closed", {
        body: { account_id: trade.account_id },
      });
      if (error) throw error;
      toast.success(`Repair requested for ${trade.symbol} #${trade.ticket}`);
      await load();
    } catch (err) {
      console.error(err);
      toast.error("Repair failed — check edge function logs");
    } finally {
      setRepairing(null);
    }
  };

  if (loading && drift.length === 0 && dormant.length === 0) return null;
  if (drift.length === 0 && dormant.length === 0) return null;

  return (
    <div className="space-y-3">
      {drift.length > 0 && (
        <Alert variant="default" className="border-amber-500/40 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-700 dark:text-amber-400">
            {drift.length} trade{drift.length === 1 ? "" : "s"} need attention
          </AlertTitle>
          <AlertDescription>
            <p className="text-xs text-muted-foreground mt-1 mb-3">
              The active MT5 terminal no longer reports these positions as open. They were likely closed at the broker — click Repair to pull the real close from MT5 deal history.
            </p>
            <div className="space-y-2">
              {drift.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 rounded border border-amber-500/20 bg-background/60 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-medium">{t.symbol}</span>
                    <span className="text-muted-foreground">#{t.ticket}</span>
                    <span className="text-xs text-muted-foreground capitalize">{t.direction}</span>
                    <span className="text-xs text-muted-foreground">{t.total_lots} lots</span>
                    <span className="text-xs text-muted-foreground hidden md:inline">
                      drift seen {formatDistanceToNow(new Date(t.snapshot_received_at), { addSuffix: true })}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                    onClick={() => repair(t)}
                    disabled={repairing === t.id}
                  >
                    {repairing === t.id ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    ) : (
                      <Wrench className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Repair
                  </Button>
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {dormant.length > 0 && (
        <Alert variant="default" className="border-slate-400/40 bg-muted/30">
          <MoonStar className="h-4 w-4 text-muted-foreground" />
          <AlertTitle>
            {dormant.length} account{dormant.length === 1 ? "" : "s"} awaiting next login
          </AlertTitle>
          <AlertDescription>
            <p className="text-xs text-muted-foreground mt-1 mb-3">
              These accounts share an MT5 install with a different active login. They'll auto-sync any missed trades the next time you log back into them — no action needed.
            </p>
            <div className="space-y-2">
              {dormant.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded border border-border bg-background/60 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-medium truncate">{a.name}</span>
                    {a.account_number && (
                      <span className="text-xs text-muted-foreground">#{a.account_number}</span>
                    )}
                    {a.broker && (
                      <span className="text-xs text-muted-foreground hidden md:inline">{a.broker}</span>
                    )}
                    {a.pending_repairs ? (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                        {a.pending_repairs} awaiting repair
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {a.last_sync_at
                        ? `last seen ${formatDistanceToNow(new Date(a.last_sync_at), { addSuffix: true })}`
                        : "never synced"}
                    </span>
                    {a.pending_repairs ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => repairAccount(a.id)}
                        disabled={repairing === a.id}
                      >
                        {repairing === a.id ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        ) : (
                          <Wrench className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Try repair
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
