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
import { useToast } from "@/hooks/use-toast";
import { NoAccountsEmptyState } from "@/components/shared/NoAccountsEmptyState";
import { MultiAccountPicker } from "@/components/shared/MultiAccountPicker";

interface StartLiveTradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (tradeId: string) => void;
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function computeLotsFor(balance: number, riskPct: number, entry: number, sl: number): number {
  if (!balance || !riskPct || !entry || !sl) return 0;
  const stopDistance = Math.abs(entry - sl);
  if (stopDistance === 0) return 0;
  const riskAmount = (balance * riskPct) / 100;
  const lotSize = riskAmount / (stopDistance * 10);
  return Math.max(0.01, Math.round(lotSize * 100) / 100);
}

export const StartLiveTradeDialog = React.forwardRef<unknown, StartLiveTradeDialogProps>(
  function StartLiveTradeDialog({ open, onOpenChange, onCreated }, _ref) {
  const createTrade = useCreateTrade();
  const { data: accounts = [] } = useAccounts();
  const { data: playbooks = [] } = usePlaybooks();
  const { selectedAccountId } = useAccountFilter();
  const { toast } = useToast();

  const defaultAccountId = useMemo(() => {
    if (selectedAccountId && selectedAccountId !== "all") return selectedAccountId;
    return accounts[0]?.id ?? "";
  }, [selectedAccountId, accounts]);

  const [accountIds, setAccountIds] = useState<string[]>([]);
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
      setAccountIds(defaultAccountId ? [defaultAccountId] : []);
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

  // Force single-account when in Lots mode
  useEffect(() => {
    if (sizingMode === "lots" && accountIds.length > 1) {
      setAccountIds([accountIds[0]]);
    }
  }, [sizingMode, accountIds]);

  const isMirroring = accountIds.length > 1;
  const primaryAccount = accounts.find((a) => a.id === accountIds[0]);

  // Compute lot size hint for risk mode (uses first/primary account)
  const computedLotsPrimary = useMemo(() => {
    if (sizingMode !== "risk") return parseFloat(lots) || 0;
    const balance = primaryAccount?.balance_start || primaryAccount?.equity_current || 0;
    return computeLotsFor(balance, parseFloat(riskPercent), parseFloat(entryPrice), parseFloat(stopLoss));
  }, [sizingMode, riskPercent, entryPrice, stopLoss, primaryAccount, lots]);

  const isValid =
    accountIds.length > 0 &&
    !!symbol.trim() &&
    !!entryPrice &&
    !!entryTime &&
    (sizingMode === "risk" ? !!riskPercent && !!stopLoss : !!lots) &&
    computedLotsPrimary > 0;

  const handleSubmit = async () => {
    if (!isValid) return;

    const entryNum = parseFloat(entryPrice);
    const slNum = stopLoss ? parseFloat(stopLoss) : undefined;
    const tpNum = takeProfit ? parseFloat(takeProfit) : undefined;
    const riskNum = parseFloat(riskPercent);
    const fixedLots = parseFloat(lots);

    let firstId: string | undefined;
    let successCount = 0;
    const errors: string[] = [];

    for (const acctId of accountIds) {
      const acct = accounts.find((a) => a.id === acctId);
      const balance = acct?.balance_start || acct?.equity_current || 0;
      const lotsForAcct =
        sizingMode === "risk"
          ? computeLotsFor(balance, riskNum, entryNum, slNum ?? entryNum)
          : fixedLots;

      if (!lotsForAcct || lotsForAcct <= 0) {
        errors.push(acct?.name ?? acctId);
        continue;
      }

      try {
        const result = await createTrade.mutateAsync({
          symbol: symbol.trim().toUpperCase(),
          direction,
          total_lots: lotsForAcct,
          entry_price: entryNum,
          entry_time: new Date(entryTime).toISOString(),
          sl_initial: slNum,
          tp_initial: tpNum,
          account_id: acctId,
          is_open: true,
          trade_type: "executed",
          playbook_id: playbookId === "none" ? undefined : playbookId,
          risk_percent: sizingMode === "risk" ? riskNum : undefined,
        });
        if (result?.id) {
          successCount++;
          // Prefer the trade on the currently filtered account
          if (!firstId || acctId === defaultAccountId) firstId = result.id;
        }
      } catch (e) {
        errors.push(acct?.name ?? acctId);
      }
    }

    if (successCount > 1) {
      toast({ title: `Live trade opened on ${successCount} accounts` });
    }
    if (errors.length > 0) {
      toast({
        title: `Failed on ${errors.length} account${errors.length > 1 ? "s" : ""}`,
        description: errors.join(", "),
        variant: "destructive",
      });
    }

    if (firstId) onCreated?.(firstId);
    if (successCount > 0) onOpenChange(false);
  };

  // No accounts → show empty state
  const showEmptyState = accounts.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Start Live Trade</DialogTitle>
          <DialogDescription>
            Manually open a position you just placed in your broker.
          </DialogDescription>
        </DialogHeader>

        {showEmptyState ? (
          <NoAccountsEmptyState onAction={() => onOpenChange(false)} />
        ) : (
          <>
            <div className="space-y-3">
              {/* Account(s) */}
              <div className="space-y-1.5">
                <Label>{isMirroring ? "Accounts" : "Account"}</Label>
                <MultiAccountPicker
                  accounts={accounts}
                  selectedIds={accountIds}
                  onChange={setAccountIds}
                  singleSelect={sizingMode === "lots"}
                  singleSelectHint={
                    sizingMode === "lots"
                      ? "Switch to Risk % to mirror across multiple accounts."
                      : undefined
                  }
                />
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
                      {isMirroring
                        ? `Each account gets its own lot size based on its balance. Primary: ≈ ${computedLotsPrimary.toFixed(2)} lots`
                        : `≈ ${computedLotsPrimary.toFixed(2)} lots${primaryAccount?.balance_start ? ` on $${primaryAccount.balance_start.toLocaleString()} balance` : ""}`}
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
                {isMirroring ? `Open on ${accountIds.length} Accounts` : "Open Trade"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
});
