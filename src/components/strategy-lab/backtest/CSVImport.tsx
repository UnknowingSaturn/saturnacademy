import * as React from "react";
import { useRef } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { TradeRecord, ParsedMetrics } from "./BacktestMetricsGrid";

interface CSVImportProps {
  onDataParsed: (trades: TradeRecord[], metrics: ParsedMetrics) => void;
  disabled?: boolean;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes; continue; }
    if ((char === "," || char === "\t" || char === ";") && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current.trim());
  return result;
}

function computeMetrics(trades: TradeRecord[]): ParsedMetrics {
  if (trades.length === 0) return { raw: "No trades" };

  const wins = trades.filter((t) => t.profit > 0);
  const losses = trades.filter((t) => t.profit < 0);
  const totalProfit = trades.reduce((s, t) => s + t.profit, 0);
  const grossProfit = wins.reduce((s, t) => s + t.profit, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profit, 0));
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const winRate = (wins.length / trades.length) * 100;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const expectancy = totalProfit / trades.length;

  // Max drawdown from balance curve
  let peak = trades[0]?.balance ?? 0;
  let maxDdAbs = 0;
  let maxDdPct = 0;
  for (const t of trades) {
    if (t.balance > peak) peak = t.balance;
    const dd = peak - t.balance;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDdAbs) maxDdAbs = dd;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
  }

  const recoveryFactor = maxDdAbs > 0 ? totalProfit / maxDdAbs : 0;

  // Sharpe approximation (daily returns)
  const returns = trades.map((t, i) => {
    const prevBal = i > 0 ? trades[i - 1].balance : t.balance - t.profit;
    return prevBal > 0 ? t.profit / prevBal : 0;
  });
  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const stdDev = Math.sqrt(returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / returns.length);
  const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;

  const bestTrade = Math.max(...trades.map((t) => t.profit));
  const worstTrade = Math.min(...trades.map((t) => t.profit));

  const raw = `Total Net Profit: ${totalProfit.toFixed(2)}\nProfit Factor: ${profitFactor.toFixed(2)}\nSharpe Ratio: ${sharpeRatio.toFixed(2)}\nMaximal Drawdown: ${maxDdPct.toFixed(1)}% ($${maxDdAbs.toFixed(2)})\nTotal Trades: ${trades.length}\nWin Rate: ${winRate.toFixed(1)}%\nRecovery Factor: ${recoveryFactor.toFixed(2)}\nAvg Win: ${avgWin.toFixed(2)}\nAvg Loss: ${avgLoss.toFixed(2)}\nBest Trade: ${bestTrade.toFixed(2)}\nWorst Trade: ${worstTrade.toFixed(2)}\nExpectancy: ${expectancy.toFixed(2)}`;

  return {
    totalNetProfit: totalProfit,
    grossProfit,
    grossLoss,
    profitFactor,
    sharpeRatio,
    maxDrawdownPct: maxDdPct,
    maxDrawdownAbs: maxDdAbs,
    totalTrades: trades.length,
    winRate,
    avgWin,
    avgLoss: -avgLoss,
    bestTrade,
    worstTrade,
    expectancy,
    recoveryFactor,
    raw,
  };
}

export function CSVImport({ onDataParsed, disabled }: CSVImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        toast({ title: "Empty file", description: "CSV has no data rows.", variant: "destructive" });
        return;
      }

      const header = parseCSVLine(lines[0]).map((h) => h.toLowerCase());

      // Auto-detect columns
      const dateIdx = header.findIndex((h) => /date|time|open.?time/i.test(h));
      const typeIdx = header.findIndex((h) => /type|direction|side/i.test(h));
      const lotsIdx = header.findIndex((h) => /lot|volume|size/i.test(h));
      const priceIdx = header.findIndex((h) => /price|entry/i.test(h));
      const profitIdx = header.findIndex((h) => /profit|pnl|p&l|net/i.test(h));
      const balanceIdx = header.findIndex((h) => /balance/i.test(h));

      if (profitIdx === -1) {
        toast({ title: "Missing column", description: "CSV must have a Profit/PnL column.", variant: "destructive" });
        return;
      }

      const trades: TradeRecord[] = [];
      let runningBalance = 10000;

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        const profit = parseFloat(cols[profitIdx]) || 0;
        const balance = balanceIdx >= 0 ? parseFloat(cols[balanceIdx]) || runningBalance + profit : runningBalance + profit;
        runningBalance = balance;

        const dateStr = dateIdx >= 0 ? cols[dateIdx] : "";
        const d = new Date(dateStr);

        trades.push({
          date: dateStr,
          type: typeIdx >= 0 && /sell|short/i.test(cols[typeIdx]) ? "sell" : "buy",
          lots: lotsIdx >= 0 ? parseFloat(cols[lotsIdx]) || 0.01 : 0.01,
          price: priceIdx >= 0 ? parseFloat(cols[priceIdx]) || 0 : 0,
          profit,
          balance,
          hour: isNaN(d.getTime()) ? undefined : d.getHours(),
          dayOfWeek: isNaN(d.getTime()) ? undefined : d.getDay(),
        });
      }

      const metrics = computeMetrics(trades);
      onDataParsed(trades, metrics);
      toast({ title: "CSV imported", description: `Parsed ${trades.length} trades successfully.` });
    } catch {
      toast({ title: "Parse error", description: "Could not parse CSV file.", variant: "destructive" });
    }

    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <>
      <input ref={inputRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleFile} />
      <Button
        variant="outline"
        size="sm"
        className="text-xs"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
      >
        <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
        Import CSV
      </Button>
    </>
  );
}

export { computeMetrics };
