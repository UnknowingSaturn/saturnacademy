import * as React from "react";
import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trade } from "@/types/trading";
import { useUpdateTrade } from "@/hooks/useTrades";
import { Loader2 } from "lucide-react";

interface CloseLiveTradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trade: Trade;
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const CloseLiveTradeDialog = React.forwardRef<unknown, CloseLiveTradeDialogProps>(
  function CloseLiveTradeDialog({ open, onOpenChange, trade }, _ref) {
  const updateTrade = useUpdateTrade();
  const [exitPrice, setExitPrice] = useState("");
  const [exitTime, setExitTime] = useState(() => toLocalInputValue(new Date()));
  const [netPnl, setNetPnl] = useState("");

  useEffect(() => {
    if (open) {
      setExitPrice("");
      setExitTime(toLocalInputValue(new Date()));
      setNetPnl("");
    }
  }, [open]);

  // Show raw price delta as a reference (no fake $ figure — broker P&L varies by symbol)
  const priceDelta = useMemo(() => {
    const exit = parseFloat(exitPrice);
    const entry = trade.entry_price;
    if (!exit || !entry) return null;
    const diff = trade.direction === "buy" ? exit - entry : entry - exit;
    return diff;
  }, [exitPrice, trade.entry_price, trade.direction]);

  const isValid = !!exitPrice && !!exitTime && netPnl !== "";

  const handleSubmit = async () => {
    if (!isValid) return;
    await updateTrade.mutateAsync({
      id: trade.id,
      is_open: false,
      exit_price: parseFloat(exitPrice),
      exit_time: new Date(exitTime).toISOString(),
      net_pnl: parseFloat(netPnl),
      gross_pnl: parseFloat(netPnl),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Close {trade.symbol}</DialogTitle>
          <DialogDescription>
            Enter the exit details from your broker to close this position.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Exit Price</Label>
            <Input
              type="number"
              step="any"
              placeholder="1.08600"
              value={exitPrice}
              onChange={(e) => setExitPrice(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Exit Time</Label>
            <Input
              type="datetime-local"
              value={exitTime}
              onChange={(e) => setExitTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Net P&amp;L ($)</Label>
            <Input
              type="number"
              step="any"
              placeholder="0.00"
              value={netPnl}
              onChange={(e) => setNetPnl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Auto-estimated. Override with the actual broker P&amp;L.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || updateTrade.isPending}>
            {updateTrade.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Close Trade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
