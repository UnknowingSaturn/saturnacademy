import { Card, CardContent } from "@/components/ui/card";
import {
  TrendingUp,
  TrendingDown,
  Target,
  Activity,
  BarChart3,
  Clock,
  Zap,
  Shield,
  Percent,
  DollarSign,
  ArrowUpDown,
  Trophy,
  AlertTriangle,
} from "lucide-react";

export interface ParsedMetrics {
  totalNetProfit?: number;
  grossProfit?: number;
  grossLoss?: number;
  profitFactor?: number;
  sharpeRatio?: number;
  maxDrawdownPct?: number;
  maxDrawdownAbs?: number;
  totalTrades?: number;
  winRate?: number;
  avgWin?: number;
  avgLoss?: number;
  bestTrade?: number;
  worstTrade?: number;
  expectancy?: number;
  recoveryFactor?: number;
  avgDuration?: string;
  raw: string;
}

export interface TradeRecord {
  date: string;
  type: "buy" | "sell";
  lots: number;
  price: number;
  sl?: number;
  tp?: number;
  profit: number;
  balance: number;
  hour?: number;
  dayOfWeek?: number;
}

type Threshold = "good" | "warning" | "danger" | "neutral";

function getThreshold(value: number | undefined, good: number, warn: number, higher: boolean): Threshold {
  if (value === undefined) return "neutral";
  if (higher) {
    if (value >= good) return "good";
    if (value >= warn) return "warning";
    return "danger";
  }
  if (value <= good) return "good";
  if (value <= warn) return "warning";
  return "danger";
}

const thresholdColors: Record<Threshold, string> = {
  good: "text-green-500",
  warning: "text-amber-500",
  danger: "text-red-500",
  neutral: "text-muted-foreground",
};

const thresholdBg: Record<Threshold, string> = {
  good: "bg-green-500/10",
  warning: "bg-amber-500/10",
  danger: "bg-red-500/10",
  neutral: "bg-muted/50",
};

function MetricCard({
  label,
  value,
  icon: Icon,
  threshold,
  suffix,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  threshold: Threshold;
  suffix?: string;
}) {
  return (
    <Card className={`${thresholdBg[threshold]} border-border/50`}>
      <CardContent className="pt-3 pb-2 px-3">
        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground truncate">{label}</p>
            <p className={`text-sm font-mono font-semibold ${thresholdColors[threshold]}`}>
              {value}{suffix && <span className="text-[10px] text-muted-foreground ml-0.5">{suffix}</span>}
            </p>
          </div>
          <Icon className={`h-3.5 w-3.5 shrink-0 ${thresholdColors[threshold]}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function fmt(v: number | undefined, decimals = 2): string {
  if (v === undefined || isNaN(v)) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function BacktestMetricsGrid({ metrics }: { metrics: ParsedMetrics }) {
  const m = metrics;

  const cards = [
    { label: "Net Profit", value: `$${fmt(m.totalNetProfit)}`, icon: DollarSign, threshold: getThreshold(m.totalNetProfit, 0, -1000, true) },
    { label: "Profit Factor", value: fmt(m.profitFactor), icon: Target, threshold: getThreshold(m.profitFactor, 1.5, 1.0, true) },
    { label: "Sharpe Ratio", value: fmt(m.sharpeRatio), icon: Activity, threshold: getThreshold(m.sharpeRatio, 1.0, 0.5, true) },
    { label: "Max DD %", value: `${fmt(m.maxDrawdownPct, 1)}%`, icon: TrendingDown, threshold: getThreshold(m.maxDrawdownPct, 15, 25, false) },
    { label: "Total Trades", value: m.totalTrades?.toString() || "—", icon: BarChart3, threshold: getThreshold(m.totalTrades, 100, 30, true) },
    { label: "Win Rate", value: `${fmt(m.winRate, 1)}%`, icon: Percent, threshold: getThreshold(m.winRate, 55, 40, true) },
    { label: "Avg Win", value: `$${fmt(m.avgWin)}`, icon: TrendingUp, threshold: "good" as Threshold },
    { label: "Avg Loss", value: `$${fmt(m.avgLoss)}`, icon: TrendingDown, threshold: "danger" as Threshold },
    { label: "Best Trade", value: `$${fmt(m.bestTrade)}`, icon: Trophy, threshold: "good" as Threshold },
    { label: "Worst Trade", value: `$${fmt(m.worstTrade)}`, icon: AlertTriangle, threshold: "danger" as Threshold },
    { label: "Expectancy", value: `$${fmt(m.expectancy)}`, icon: Zap, threshold: getThreshold(m.expectancy, 0, -50, true) },
    { label: "Recovery Factor", value: fmt(m.recoveryFactor), icon: Shield, threshold: getThreshold(m.recoveryFactor, 3, 1, true) },
    { label: "Avg Duration", value: m.avgDuration || "—", icon: Clock, threshold: "neutral" as Threshold },
    { label: "Max DD $", value: `$${fmt(m.maxDrawdownAbs)}`, icon: ArrowUpDown, threshold: "neutral" as Threshold },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {cards.map((c) => (
        <MetricCard key={c.label} {...c} />
      ))}
    </div>
  );
}
