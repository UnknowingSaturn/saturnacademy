import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, Wrench, Info, LogIn } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

type DriftReason = "likely_broker_closed" | "login_switched";

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
  expected_login: string | null;
  account_name: string | null;
  reason: DriftReason;
}

/**
 * Surfaces trades that the broker probably closed but the EA missed the deal
 * event for. Non-destructive — clicking Repair pulls the real close from
 * MT5 deal history via the trade-repair function.
 *
 * Dormant-account info is intentionally NOT shown here — the Accounts page
 * already shows a Dormant badge and Repair CTA per account.
 */
export function DriftTray() {
  const [drift, setDrift] = useState<DriftTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("trade-repair", { body: { action: "list-drift" } });
      if (error) throw error;
      setDrift(data?.drift_trades ?? []);
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
      const { error } = await supabase.functions.invoke("trade-repair", {
        body: { action: "repair", account_id: trade.account_id },
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

  if (drift.length === 0) return null;

  const switched = drift.filter((t) => t.reason === "login_switched");
  const brokerClosed = drift.filter((t) => t.reason === "likely_broker_closed");

  return (
    <div className="space-y-3">
      {switched.length > 0 && (
        <Alert variant="default" className="border-slate-400/40 bg-muted/30">
          <LogIn className="h-4 w-4 text-muted-foreground" />
          <AlertTitle>
            {switched.length} trade{switched.length === 1 ? "" : "s"} waiting for the right MT5 login
          </AlertTitle>
          <AlertDescription>
            <p className="text-xs text-muted-foreground mt-1 mb-3">
              You're logged into a different account on this MT5 terminal. Log back into the original account and we'll sync these automatically — no action needed here.
            </p>
            <div className="space-y-2">
              {switched.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 rounded border border-border bg-background/60 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-wrap">
                    <span className="font-medium">{t.symbol}</span>
                    <span className="text-muted-foreground">#{t.ticket}</span>
                    <span className="text-xs text-muted-foreground capitalize">{t.direction}</span>
                    <span className="text-xs text-muted-foreground">{t.total_lots} lots</span>
                    {t.expected_login && (
                      <span className="text-xs text-muted-foreground">
                        log into #{t.expected_login}
                        {t.active_login ? ` (currently #${t.active_login})` : ""}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {brokerClosed.length > 0 && (
        <Alert variant="default" className="border-border bg-muted/30">
          <Info className="h-4 w-4 text-muted-foreground" />
          <AlertTitle>
            {brokerClosed.length} trade{brokerClosed.length === 1 ? "" : "s"} may have closed at the broker
          </AlertTitle>
          <AlertDescription>
            <p className="text-xs text-muted-foreground mt-1 mb-3">
              MT5 is connected but no longer reports these positions as open. This usually means the broker closed them (SL/TP hit, weekend rollover, or manual close from another device). Use Repair to pull the real close from deal history.
            </p>
            <div className="space-y-2">
              {brokerClosed.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 rounded border border-border bg-background/60 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-medium">{t.symbol}</span>
                    <span className="text-muted-foreground">#{t.ticket}</span>
                    <span className="text-xs text-muted-foreground capitalize">{t.direction}</span>
                    <span className="text-xs text-muted-foreground">{t.total_lots} lots</span>
                    <span className="text-xs text-muted-foreground hidden md:inline">
                      since {formatDistanceToNow(new Date(t.snapshot_received_at), { addSuffix: true })}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
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
    </div>
  );
}
