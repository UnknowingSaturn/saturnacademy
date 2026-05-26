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

function fmtShortDate(d: Date): string {
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function computeMetrics(trades: TradeRecord[]): ParsedMetrics {
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
  const startBalance = trades[0].balance - trades[0].profit;
  let peak = startBalance;
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

  // Per-trade returns
  const returns = trades.map((t, i) => {
    const prevBal = i > 0 ? trades[i - 1].balance : startBalance;
    return prevBal > 0 ? t.profit / prevBal : 0;
  });
  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;

  const downsideReturns = returns.filter((r) => r < 0);
  const downsideVar = downsideReturns.length > 0
    ? downsideReturns.reduce((s, r) => s + r ** 2, 0) / returns.length
    : 0;
  const downsideStd = Math.sqrt(downsideVar);
  const sortinoRatio = downsideStd > 0 ? (meanReturn / downsideStd) * Math.sqrt(252) : 0;

  const bestTrade = Math.max(...trades.map((t) => t.profit));
  const worstTrade = Math.min(...trades.map((t) => t.profit));

  // Date-range derived metrics
  const dateTrades = trades.filter((t) => t.date && !isNaN(new Date(t.date).getTime()));
  const firstDate = dateTrades.length > 0 ? new Date(dateTrades[0].date) : null;
  const lastDate = dateTrades.length > 0
    ? new Date(dateTrades[dateTrades.length - 1].closeDate || dateTrades[dateTrades.length - 1].date)
    : null;

  let cagrPct: number | undefined;
  let exposurePct: number | undefined;
  let calmarRatio: number | undefined;
  if (firstDate && lastDate && !isNaN(firstDate.getTime()) && !isNaN(lastDate.getTime())) {
    const days = Math.max(1, (lastDate.getTime() - firstDate.getTime()) / 86400000);
    const endBalance = trades[trades.length - 1].balance;
    if (startBalance > 0 && endBalance > 0) {
      cagrPct = (Math.pow(endBalance / startBalance, 365 / days) - 1) * 100;
    }
    if (cagrPct !== undefined && maxDdPct > 0) {
      calmarRatio = cagrPct / maxDdPct;
    }
    const totalElapsed = days * 86400;
    const totalDuration = trades.reduce((s, t) => s + (t.durationSec ?? 0), 0);
    if (totalDuration > 0 && totalElapsed > 0) {
      exposurePct = Math.min(100, (totalDuration / totalElapsed) * 100);
    }
  }

  // Avg duration
  const tradesWithDuration = trades.filter((t) => (t.durationSec ?? 0) > 0);
  let avgDuration: string | undefined;
  if (tradesWithDuration.length > 0) {
    const avgSec = tradesWithDuration.reduce((s, t) => s + (t.durationSec ?? 0), 0) / tradesWithDuration.length;
    const h = Math.floor(avgSec / 3600);
    const m = Math.floor((avgSec % 3600) / 60);
    avgDuration = h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  const startDate = firstDate ? fmtShortDate(firstDate) : undefined;
  const endDate = lastDate ? fmtShortDate(lastDate) : undefined;

  const raw = `Total Net Profit: ${totalProfit.toFixed(2)}
Profit Factor: ${profitFactor.toFixed(2)}
Sharpe Ratio: ${sharpeRatio.toFixed(2)}
Sortino Ratio: ${sortinoRatio.toFixed(2)}
${cagrPct !== undefined ? `CAGR: ${cagrPct.toFixed(2)}%\n` : ""}${calmarRatio !== undefined ? `Calmar: ${calmarRatio.toFixed(2)}\n` : ""}Maximal Drawdown: ${maxDdPct.toFixed(1)}% ($${maxDdAbs.toFixed(2)})
Total Trades: ${trades.length}
Win Rate: ${winRate.toFixed(1)}%
Recovery Factor: ${recoveryFactor.toFixed(2)}
Avg Win: ${avgWin.toFixed(2)}
Avg Loss: ${avgLoss.toFixed(2)}
Best Trade: ${bestTrade.toFixed(2)}
Worst Trade: ${worstTrade.toFixed(2)}
Expectancy: ${expectancy.toFixed(2)}
${exposurePct !== undefined ? `Exposure: ${exposurePct.toFixed(1)}%\n` : ""}${avgDuration ? `Avg Duration: ${avgDuration}\n` : ""}${startDate && endDate ? `Period: ${startDate} → ${endDate}` : ""}`;

  return {
    totalNetProfit: totalProfit,
    grossProfit,
    grossLoss,
    profitFactor,
    sharpeRatio,
    sortinoRatio,
    cagrPct,
    calmarRatio,
    exposurePct,
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
    avgDuration,
    startDate,
    endDate,
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
      const dateIdx = header.findIndex((h) => /^(date|time|open.?time|entry.?time)$/i.test(h));
      const closeIdx = header.findIndex((h) => /(close.?time|exit.?time|close.?date|exit.?date)/i.test(h));
      const typeIdx = header.findIndex((h) => /^(type|direction|side)$/i.test(h));
      const symbolIdx = header.findIndex((h) => /^(symbol|instrument|ticker|market)$/i.test(h));
      const lotsIdx = header.findIndex((h) => /^(lot|lots|volume|size|qty|quantity)$/i.test(h));
      const priceIdx = header.findIndex((h) => /^(price|entry|entry.?price|open.?price)$/i.test(h));
      const profitIdx = header.findIndex((h) => /profit|pnl|p&l|net|gain/i.test(h));
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
        const balance =
          balanceIdx >= 0 ? parseFloat(cols[balanceIdx]) || runningBalance + profit : runningBalance + profit;
        runningBalance = balance;

        const dateStr = dateIdx >= 0 ? cols[dateIdx] : "";
        const closeStr = closeIdx >= 0 ? cols[closeIdx] : "";
        const d = new Date(dateStr);
        const cd = closeStr ? new Date(closeStr) : null;
        const durationSec =
          cd && !isNaN(cd.getTime()) && !isNaN(d.getTime())
            ? Math.max(0, (cd.getTime() - d.getTime()) / 1000)
            : undefined;

        trades.push({
          date: dateStr,
          closeDate: closeStr || undefined,
          type: typeIdx >= 0 && /sell|short/i.test(cols[typeIdx]) ? "sell" : "buy",
          symbol: symbolIdx >= 0 ? cols[symbolIdx] : undefined,
          lots: lotsIdx >= 0 ? parseFloat(cols[lotsIdx]) || 0.01 : 0.01,
          price: priceIdx >= 0 ? parseFloat(cols[priceIdx]) || 0 : 0,
          profit,
          balance,
          hour: isNaN(d.getTime()) ? undefined : d.getHours(),
          dayOfWeek: isNaN(d.getTime()) ? undefined : d.getDay(),
          durationSec,
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
