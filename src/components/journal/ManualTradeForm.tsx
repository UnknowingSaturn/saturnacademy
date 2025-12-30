import { useState } from "react";
import { useCreateTrade } from "@/hooks/useTrades";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { SessionType, TradeType } from "@/types/trading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Lightbulb, FileText, Clock, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const TRADE_TYPE_OPTIONS: { value: TradeType; label: string; icon: React.ReactNode; description: string }[] = [
  { value: "executed", label: "Executed", icon: <CheckCircle className="w-4 h-4" />, description: "Real trade taken" },
  { value: "idea", label: "Idea", icon: <Lightbulb className="w-4 h-4" />, description: "Setup not taken" },
  { value: "paper", label: "Paper", icon: <FileText className="w-4 h-4" />, description: "Simulated trade" },
  { value: "missed", label: "Missed", icon: <Clock className="w-4 h-4" />, description: "Should have taken" },
];

export function ManualTradeForm() {
  const [open, setOpen] = useState(false);
  const createTrade = useCreateTrade();
  const { data: playbooks } = usePlaybooks();

  const [tradeType, setTradeType] = useState<TradeType>("executed");
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [entryPrice, setEntryPrice] = useState("");
  const [entryTime, setEntryTime] = useState("");
  const [exitPrice, setExitPrice] = useState("");
  const [exitTime, setExitTime] = useState("");
  const [lots, setLots] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [session, setSession] = useState<SessionType | "">("");
  const [pnl, setPnl] = useState("");
  const [strategy, setStrategy] = useState("");
  const [reasonNotTaken, setReasonNotTaken] = useState("");

  const isNonExecuted = tradeType !== "executed";

  const resetForm = () => {
    setTradeType("executed");
    setSymbol("");
    setDirection("buy");
    setEntryPrice("");
    setEntryTime("");
    setExitPrice("");
    setExitTime("");
    setLots("");
    setSl("");
    setTp("");
    setSession("");
    setPnl("");
    setStrategy("");
    setReasonNotTaken("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!symbol || !entryPrice || !entryTime || !lots) return;

    // For non-executed trades, they're always "closed" conceptually (hypothetical outcome)
    const isOpen = tradeType === "executed" ? (!exitPrice || !exitTime) : false;

    await createTrade.mutateAsync({
      symbol: symbol.toUpperCase(),
      direction,
      entry_price: parseFloat(entryPrice),
      entry_time: new Date(entryTime).toISOString(),
      exit_price: exitPrice ? parseFloat(exitPrice) : undefined,
      exit_time: exitTime ? new Date(exitTime).toISOString() : undefined,
      total_lots: parseFloat(lots),
      sl_initial: sl ? parseFloat(sl) : undefined,
      tp_initial: tp ? parseFloat(tp) : undefined,
      session: session || undefined,
      net_pnl: pnl ? parseFloat(pnl) : undefined,
      is_open: isOpen,
      playbook_id: strategy || undefined,
      trade_type: tradeType,
      // Store reason not taken in the place field for now (could be separate field later)
      place: isNonExecuted && reasonNotTaken ? `[${tradeType}] ${reasonNotTaken}` : undefined,
    });

    resetForm();
    setOpen(false);
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
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
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
              <Label htmlFor="lots">Lots *</Label>
              <Input
                id="lots"
                type="number"
                step="0.01"
                value={lots}
                onChange={(e) => setLots(e.target.value)}
                placeholder="0.10"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sl">Stop Loss</Label>
              <Input
                id="sl"
                type="number"
                step="any"
                value={sl}
                onChange={(e) => setSl(e.target.value)}
                placeholder="1.0800"
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
              {createTrade.isPending ? "Adding..." : "Add Trade"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
