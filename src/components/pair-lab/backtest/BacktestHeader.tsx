// ============================================================================
// Sticky header — what you are testing (symbol, month range) and the one
// action that matters (run), available from every step.
// ============================================================================

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Play } from "lucide-react";
import { RecentRunsMenu } from "./RecentRunsMenu";
import type { IctBacktestResponse } from "@/workers/ictBacktest.worker";

interface Props {
  symbols: string[];
  symbol: string;
  onSymbol: (s: string) => void;
  fromMonth: string;
  toMonth: string;
  onMonths: (from: string, to: string) => void;
  onRun: () => void;
  isRunning: boolean;
  runLabel: string;
  progress: string | null;
  historySymbol: string;
  onOpenRun: (result: IctBacktestResponse) => void;
}

export function BacktestHeader({
  symbols, symbol, onSymbol, fromMonth, toMonth, onMonths,
  onRun, isRunning, runLabel, progress, historySymbol, onOpenRun,
}: Props) {
  return (
    <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-background/95 backdrop-blur border-b border-border/60">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Symbol</Label>
          <Select value={symbol} onValueChange={onSymbol}>
            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {symbols.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="bt-from" className="text-xs">From</Label>
          <Input id="bt-from" className="h-8 w-28" value={fromMonth}
            onChange={(e) => onMonths(e.target.value, toMonth)} placeholder="YYYY-MM" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="bt-to" className="text-xs">To</Label>
          <Input id="bt-to" className="h-8 w-28" value={toMonth}
            onChange={(e) => onMonths(fromMonth, e.target.value)} placeholder="YYYY-MM" />
        </div>

        <div className="flex-1" />

        <RecentRunsMenu symbol={historySymbol} onOpen={onOpenRun} />

        <Button className="h-8" onClick={onRun} disabled={isRunning}>
          {isRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
          {isRunning ? "Running…" : runLabel}
        </Button>
      </div>
      {progress && (
        <p className="text-[11px] text-muted-foreground pt-1.5">{progress}</p>
      )}
    </div>
  );
}
