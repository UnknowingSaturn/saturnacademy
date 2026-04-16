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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useCreateTrade } from "@/hooks/useTrades";
import { useAccounts } from "@/hooks/useAccounts";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { useAccountFilter } from "@/contexts/AccountFilterContext";
import { TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface StartLiveTradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (tradeId: string) => void;
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function StartLiveTradeDialog({ open, onOpenChange, onCreated }: StartLiveTradeDialogProps) {
  const createTrade = useCreateTrade();
  const { data: accounts = [] } = useAccounts();
  const { data: playbooks = [] } = usePlaybooks();
  const { selectedAccountId } = useAccountFilter();

  const defaultAccountId = useMemo(() => {
    if (selectedAccountId && selectedAccountId !== "all") return selectedAccountId;
    return accounts[0]?.id ?? "";
  }, [selectedAccountId, accounts]);

  const [accountId, setAccountId] = useState<string>(defaultAccountId);
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [entryPrice, setEntryPrice] = useState("");
  const [entryTime, setEntryTime] = useState(() => toLocalInputValue(new Date()));
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [sizingMode, setSizingMode] = useState<"risk" | "lots">("risk");
  const [riskPercent, setRiskPercent] = useState("0.5");
  const [lots, setLots] = useState("0.10");
  const [playbookId, setPlaybookId] = useState<string>("none");

  // Reset to defaults whenever dialog opens
  useEffect(() => {
    if (open) {
      setAccountId(defaultAccountId);
      setSymbol("");
      setDirection("buy");
      setEntryPrice("");
      setEntryTime(toLocalInputValue(new Date()));
      setStopLoss("");
      setTakeProfit("");
      setSizingMode("risk");
      setRiskPercent("0.5");
      setLots("0.10");
      setPlaybookId("none");
    }
  }, [open, defaultAccountId]);

  const selectedAccount = accounts.find((a) => a.id === accountId);

  // Compute lot size from risk %
  const computedLots = useMemo(() => {
    if (sizingMode !== "risk") return parseFloat(lots) || 0;
    const risk = parseFloat(riskPercent);
    const entry = parseFloat(entryPrice);
    const sl = parseFloat(stopLoss);
    const balance = selectedAccount?.balance_start || selectedAccount?.equity_current || 0;
    if (!risk || !entry || !sl || !balance) return 0;
    const stopDistance = Math.abs(entry - sl);
    if (stopDistance === 0) return 0;
    // Simplified: $/lot ≈ stopDistance × 10 (assumes major FX). User can override via lots mode.
    const riskAmount = (balance * risk) / 100;
    const lotSize = riskAmount / (stopDistance * 10);
    return Math.max(0.01, Math.round(lotSize * 100) / 100);
  }, [sizingMode, riskPercent, entryPrice, stopLoss, selectedAccount, lots]);

  const isValid =
    !!accountId &&
    !!symbol.trim() &&
    !!entryPrice &&
    !!entryTime &&
    (sizingMode === "risk" ? !!riskPercent && !!stopLoss : !!lots) &&
    computedLots > 0;

  const handleSubmit = async () => {
    if (!isValid) return;

    const result = await createTrade.mutateAsync({
      symbol: symbol.trim().toUpperCase(),
      direction,
      total_lots: computedLots,
      entry_price: parseFloat(entryPrice),
      entry_time: new Date(entryTime).toISOString(),
      sl_initial: stopLoss ? parseFloat(stopLoss) : undefined,
      tp_initial: takeProfit ? parseFloat(takeProfit) : undefined,
      account_id: accountId,
      is_open: true,
      trade_type: "executed",
      playbook_id: playbookId === "none" ? undefined : playbookId,
      risk_percent: sizingMode === "risk" ? parseFloat(riskPercent) : undefined,
    });

    if (result?.id) onCreated?.(result.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Start Live Trade</DialogTitle>
          <DialogDescription>
            Manually open a position you just placed in your broker.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Account */}
          <div className="space-y-1.5">
            <Label>Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Symbol + Direction */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Symbol</Label>
              <Input
                placeholder="EURUSD"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Direction</Label>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  type="button"
                  variant={direction === "buy" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDirection("buy")}
                  className={cn(
                    "h-10",
                    direction === "buy" && "bg-profit text-profit-foreground hover:bg-profit/90"
                  )}
                >
                  <TrendingUp className="h-4 w-4" />
                  Buy
                </Button>
                <Button
                  type="button"
                  variant={direction === "sell" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDirection("sell")}
                  className={cn(
                    "h-10",
                    direction === "sell" && "bg-loss text-loss-foreground hover:bg-loss/90"
                  )}
                >
                  <TrendingDown className="h-4 w-4" />
                  Sell
                </Button>
              </div>
            </div>
          </div>

          {/* Entry price + time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Entry Price</Label>
              <Input
                type="number"
                step="any"
                placeholder="1.08500"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Entry Time</Label>
              <Input
                type="datetime-local"
                value={entryTime}
                onChange={(e) => setEntryTime(e.target.value)}
              />
            </div>
          </div>

          {/* SL / TP */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-loss">Stop Loss</Label>
              <Input
                type="number"
                step="any"
                placeholder="1.08300"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-profit">Take Profit</Label>
              <Input
                type="number"
                step="any"
                placeholder="1.08900"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
              />
            </div>
          </div>

          {/* Risk sizing */}
          <div className="space-y-1.5">
            <Label>Position Size</Label>
            <Tabs value={sizingMode} onValueChange={(v) => setSizingMode(v as "risk" | "lots")}>
              <TabsList className="grid grid-cols-2 w-full h-9">
                <TabsTrigger value="risk">Risk %</TabsTrigger>
                <TabsTrigger value="lots">Lots</TabsTrigger>
              </TabsList>
              <TabsContent value="risk" className="mt-2 space-y-1.5">
                <Input
                  type="number"
                  step="0.1"
                  placeholder="0.5"
                  value={riskPercent}
                  onChange={(e) => setRiskPercent(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  ≈ {computedLots.toFixed(2)} lots
                  {selectedAccount?.balance_start
                    ? ` on $${selectedAccount.balance_start.toLocaleString()} balance`
                    : ""}
                </p>
              </TabsContent>
              <TabsContent value="lots" className="mt-2">
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.10"
                  value={lots}
                  onChange={(e) => setLots(e.target.value)}
                />
              </TabsContent>
            </Tabs>
          </div>

          {/* Playbook */}
          <div className="space-y-1.5">
            <Label>Playbook (optional)</Label>
            <Select value={playbookId} onValueChange={setPlaybookId}>
              <SelectTrigger>
                <SelectValue placeholder="No playbook" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No playbook</SelectItem>
                {playbooks.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || createTrade.isPending}>
            {createTrade.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Open Trade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
