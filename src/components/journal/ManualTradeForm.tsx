import { useState, useEffect } from "react";
import { useCreateTrade } from "@/hooks/useTrades";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { useAccountFilter } from "@/contexts/AccountFilterContext";
import { SessionType, TradeType } from "@/types/trading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Plus, Lightbulb, FileText, Clock, CheckCircle, Percent, Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { NoAccountsEmptyState } from "@/components/shared/NoAccountsEmptyState";
import { MultiAccountPicker } from "@/components/shared/MultiAccountPicker";

const TRADE_TYPE_OPTIONS: { value: TradeType; label: string; icon: React.ReactNode; description: string }[] = [
  { value: "executed", label: "Executed", icon: <CheckCircle className="w-4 h-4" />, description: "Real trade taken" },
  { value: "idea", label: "Idea", icon: <Lightbulb className="w-4 h-4" />, description: "Setup not taken" },
  { value: "paper", label: "Paper", icon: <FileText className="w-4 h-4" />, description: "Simulated trade" },
  { value: "missed", label: "Missed", icon: <Clock className="w-4 h-4" />, description: "Should have taken" },
];

function computeLotsFor(balance: number, riskPct: number, entry: number, sl: number): number {
  if (!balance || !riskPct || !entry || !sl) return 0;
  const stopDistance = Math.abs(entry - sl);
  if (stopDistance === 0) return 0;
  const riskAmount = (balance * riskPct) / 100;
  const lotSize = riskAmount / (stopDistance * 10);
  return Math.max(0.01, Math.round(lotSize * 100) / 100);
}

export function ManualTradeForm() {
  const [open, setOpen] = useState(false);
  const createTrade = useCreateTrade();
  const { data: playbooks } = usePlaybooks();
  const { selectedAccountId, accounts } = useAccountFilter();
  const { toast } = useToast();

  const [tradeType, setTradeType] = useState<TradeType>("executed");
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [entryPrice, setEntryPrice] = useState("");
  const [entryTime, setEntryTime] = useState("");
  const [exitPrice, setExitPrice] = useState("");
  const [exitTime, setExitTime] = useState("");
  const [lots, setLots] = useState("");
  const [riskMode, setRiskMode] = useState<"lots" | "risk_percent">("risk_percent");
  const [riskPercent, setRiskPercent] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [session, setSession] = useState<SessionType | "">("");
  const [pnl, setPnl] = useState("");
  const [strategy, setStrategy] = useState("");
  const [reasonNotTaken, setReasonNotTaken] = useState("");

  const isNonExecuted = tradeType !== "executed";
  const isMirroring = !isNonExecuted && accountIds.length > 1;
  // Multi-account only allowed for executed + risk_percent mode
  const allowMultiSelect = !isNonExecuted && riskMode === "risk_percent";

  // Set default account when accounts load or selection changes
  useEffect(() => {
    if (accounts.length > 0 && accountIds.length === 0) {
      const defaultAccount = selectedAccountId !== "all"
        ? selectedAccountId
        : accounts[0]?.id;
      if (defaultAccount) setAccountIds([defaultAccount]);
    }
  }, [accounts, selectedAccountId, accountIds.length]);

  // Force single-account when not allowed (non-executed or lots mode)
  useEffect(() => {
    if (!allowMultiSelect && accountIds.length > 1) {
      setAccountIds([accountIds[0]]);
    }
  }, [allowMultiSelect, accountIds]);

  const resetForm = () => {
    setTradeType("executed");
    const def = selectedAccountId !== "all" ? selectedAccountId : accounts[0]?.id || "";
    setAccountIds(def ? [def] : []);
    setSymbol("");
    setDirection("buy");
    setEntryPrice("");
    setEntryTime("");
    setExitPrice("");
    setExitTime("");
    setLots("");
    setRiskMode("risk_percent");
    setRiskPercent("");
    setSl("");
    setTp("");
    setSession("");
    setPnl("");
    setStrategy("");
    setReasonNotTaken("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const hasSize = isNonExecuted
      ? (riskMode === "lots" ? lots : riskPercent)
      : (riskMode === "risk_percent" ? riskPercent && sl : lots);

    if (!symbol || !entryPrice || !entryTime || !hasSize || accountIds.length === 0) return;

    const isOpen = tradeType === "executed" ? (!exitPrice || !exitTime) : false;
    const entryNum = parseFloat(entryPrice);
    const slNum = sl ? parseFloat(sl) : undefined;

    let successCount = 0;
    const errors: string[] = [];

    for (const acctId of accountIds) {
      const acct = accounts.find((a) => a.id === acctId);

      // Per-account lot size
      let totalLots: number;
      let riskPercentValue: number | undefined;

      if (riskMode === "risk_percent") {
        const balance = acct?.balance_start || acct?.equity_current || 0;
        riskPercentValue = parseFloat(riskPercent);
        if (isNonExecuted) {
          // Hypothetical: placeholder lots since no real risk
          totalLots = 0.01;
        } else {
          totalLots = computeLotsFor(balance, riskPercentValue, entryNum, slNum ?? entryNum);
          if (!totalLots || totalLots <= 0) {
            errors.push(acct?.name ?? acctId);
            continue;
          }
        }
      } else {
        totalLots = parseFloat(lots);
      }

      try {
        await createTrade.mutateAsync({
          account_id: acctId,
          symbol: symbol.toUpperCase(),
          direction,
          entry_price: entryNum,
          entry_time: new Date(entryTime).toISOString(),
          exit_price: exitPrice ? parseFloat(exitPrice) : undefined,
          exit_time: exitTime ? new Date(exitTime).toISOString() : undefined,
          total_lots: totalLots,
          risk_percent: riskPercentValue,
          sl_initial: slNum,
          tp_initial: tp ? parseFloat(tp) : undefined,
          session: session || undefined,
          net_pnl: pnl ? parseFloat(pnl) : undefined,
          is_open: isOpen,
          playbook_id: strategy || undefined,
          trade_type: tradeType,
          place: isNonExecuted && reasonNotTaken ? `[${tradeType}] ${reasonNotTaken}` : undefined,
        });
        successCount++;
      } catch {
        errors.push(acct?.name ?? acctId);
      }
    }

    if (successCount > 1) {
      toast({ title: `Trade logged on ${successCount} accounts` });
    }
    if (errors.length > 0) {
      toast({
        title: `Failed on ${errors.length} account${errors.length > 1 ? "s" : ""}`,
        description: errors.join(", "),
        variant: "destructive",
      });
    }

    if (successCount > 0) {
      resetForm();
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Add Trade
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Trade</DialogTitle>
        </DialogHeader>

        {accounts.length === 0 ? (
          <NoAccountsEmptyState onAction={() => setOpen(false)} />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            {/* Account Selector */}
            <div className="space-y-2">
              <Label>{isMirroring ? "Accounts *" : "Account *"}</Label>
              <MultiAccountPicker
                accounts={accounts}
                selectedIds={accountIds}
                onChange={setAccountIds}
                singleSelect={!allowMultiSelect}
                singleSelectHint={
                  !isNonExecuted && riskMode === "lots"
                    ? "Switch to Risk % to mirror across multiple accounts."
                    : undefined
                }
              />
            </div>

          {/* Trade Type Selector */}
          <div className="space-y-2">
            <Label>Trade Type</Label>
            <div className="grid grid-cols-4 gap-2">
              {TRADE_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTradeType(option.value)}
                  className={cn(
                    "flex flex-col items-center gap-1 p-3 rounded-lg border transition-colors",
                    tradeType === option.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/30 hover:bg-muted/50 border-border"
                  )}
                >
                  {option.icon}
                  <span className="text-xs font-medium">{option.label}</span>
                </button>
              ))}
            </div>
            {isNonExecuted && (
              <p className="text-xs text-muted-foreground">
                {tradeType === "idea" && "Log a trade setup you identified but chose not to take."}
                {tradeType === "paper" && "Log a simulated trade for practice or testing."}
                {tradeType === "missed" && "Log a valid setup you should have taken but missed."}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="symbol">Symbol *</Label>
              <Input
                id="symbol"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="EURUSD"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="direction">Direction *</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as "buy" | "sell")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="buy">Buy</SelectItem>
                  <SelectItem value="sell">Sell</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="entryPrice">Entry Price *</Label>
              <Input
                id="entryPrice"
                type="number"
                step="any"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="1.0850"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entryTime">Entry Time *</Label>
              <Input
                id="entryTime"
                type="datetime-local"
                value={entryTime}
                onChange={(e) => setEntryTime(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="exitPrice">
                {isNonExecuted ? "Hypothetical Exit" : "Exit Price"}
              </Label>
              <Input
                id="exitPrice"
                type="number"
                step="any"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                placeholder="1.0900"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="exitTime">
                {isNonExecuted ? "Hypothetical Exit Time" : "Exit Time"}
              </Label>
              <Input
                id="exitTime"
                type="datetime-local"
                value={exitTime}
                onChange={(e) => setExitTime(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{riskMode === "lots" ? "Lots" : "Risk %"} *</Label>
                <ToggleGroup
                  type="single"
                  value={riskMode}
                  onValueChange={(v) => v && setRiskMode(v as "lots" | "risk_percent")}
                  className="h-6"
                >
                  <ToggleGroupItem value="lots" aria-label="Lots" className="h-6 px-2 text-xs gap-1">
                    <Hash className="w-3 h-3" />
                    Lots
                  </ToggleGroupItem>
                  <ToggleGroupItem value="risk_percent" aria-label="Risk %" className="h-6 px-2 text-xs gap-1">
                    <Percent className="w-3 h-3" />
                    Risk
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              {riskMode === "lots" ? (
                <Input
                  id="lots"
                  type="number"
                  step="0.01"
                  value={lots}
                  onChange={(e) => setLots(e.target.value)}
                  placeholder="0.10"
                  required
                />
              ) : (
                <Input
                  id="riskPercent"
                  type="number"
                  step="0.1"
                  value={riskPercent}
                  onChange={(e) => setRiskPercent(e.target.value)}
                  placeholder="1.0"
                  required
                />
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sl">Stop Loss{!isNonExecuted && riskMode === "risk_percent" ? " *" : ""}</Label>
              <Input
                id="sl"
                type="number"
                step="any"
                value={sl}
                onChange={(e) => setSl(e.target.value)}
                placeholder="1.0800"
                required={!isNonExecuted && riskMode === "risk_percent"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tp">Take Profit</Label>
              <Input
                id="tp"
                type="number"
                step="any"
                value={tp}
                onChange={(e) => setTp(e.target.value)}
                placeholder="1.0950"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="session">Session</Label>
              <Select value={session} onValueChange={(v) => setSession(v as SessionType)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select session" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new_york_am">New York AM</SelectItem>
                  <SelectItem value="london">London</SelectItem>
                  <SelectItem value="tokyo">Tokyo</SelectItem>
                  <SelectItem value="new_york_pm">New York PM</SelectItem>
                  <SelectItem value="off_hours">Off Hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="strategy">Strategy</Label>
              <Select value={strategy} onValueChange={setStrategy}>
                <SelectTrigger>
                  <SelectValue placeholder="Select strategy" />
                </SelectTrigger>
                <SelectContent>
                  {playbooks?.map((pb) => (
                    <SelectItem key={pb.id} value={pb.id}>
                      {pb.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pnl">
              {isNonExecuted ? "Hypothetical P&L" : "P&L (Net)"}
            </Label>
            <Input
              id="pnl"
              type="number"
              step="0.01"
              value={pnl}
              onChange={(e) => setPnl(e.target.value)}
              placeholder={isNonExecuted ? "What would have been..." : "125.50"}
            />
            {isMirroring && pnl && (
              <p className="text-xs text-muted-foreground">
                Same P&L will be applied to all {accountIds.length} mirrored trades. Edit per-trade later if broker P&L differs.
              </p>
            )}
          </div>

          {/* Reason Not Taken - only for non-executed trades */}
          {isNonExecuted && (
            <div className="space-y-2">
              <Label htmlFor="reasonNotTaken">
                {tradeType === "idea" ? "Why not taken?" : tradeType === "missed" ? "Why missed?" : "Notes"}
              </Label>
              <Textarea
                id="reasonNotTaken"
                value={reasonNotTaken}
                onChange={(e) => setReasonNotTaken(e.target.value)}
                placeholder={
                  tradeType === "idea"
                    ? "No confirmation, wrong session, risk limit reached..."
                    : tradeType === "missed"
                    ? "Wasn't watching charts, hesitated, distracted..."
                    : "Any additional notes..."
                }
                className="h-20 resize-none"
              />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createTrade.isPending}>
              {createTrade.isPending
                ? "Adding..."
                : isMirroring
                  ? `Add to ${accountIds.length} Accounts`
                  : "Add Trade"}
            </Button>
          </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
