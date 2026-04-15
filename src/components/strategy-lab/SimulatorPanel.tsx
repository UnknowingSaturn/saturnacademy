import * as React from "react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Play,
  Loader2,
  TrendingUp,
  TrendingDown,
  Target,
  BarChart3,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface SimulatorPanelProps {
  selectedPlaybookId: string;
  playbookName?: string;
}

interface SimMetrics {
  total_trades: number;
  alpha_taken: number;
  alpha_skipped: number;
  win_rate: number;
  profit_factor: number;
  total_pnl: number;
  max_drawdown: number;
  avg_r: number;
  sharpe: number;
  agreement_score: number;
}

interface TradeSignal {
  trade_id: string;
  symbol: string;
  direction: string;
  session: string | null;
  signal: string;
  reason: string;
  confidence: number;
  actual_pnl: number;
  r_multiple: number | null;
  entry_time: string;
  agreed: boolean;
}

interface EquityPoint {
  date: string;
  alpha_equity: number;
  actual_equity: number;
}

interface SimResults {
  id: string;
  metrics: SimMetrics;
  equity_curve: EquityPoint[];
  trade_log: TradeSignal[];
}

export function SimulatorPanel({ selectedPlaybookId, playbookName }: SimulatorPanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<SimResults | null>(null);
  const [activeResultTab, setActiveResultTab] = useState("overview");

  // Parameters
  const [minR, setMinR] = useState(1.5);
  const [requireSL, setRequireSL] = useState(true);
  const [sessionFilter, setSessionFilter] = useState(true);
  const [symbolFilter, setSymbolFilter] = useState(true);

  const canRun = selectedPlaybookId !== "none" && !isRunning;

  const runSimulation = async () => {
    if (!canRun || !user) return;
    setIsRunning(true);
    setResults(null);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/simulate-alpha`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            playbook_id: selectedPlaybookId,
            parameters: {
              min_r_multiple: minR,
              require_sl: requireSL,
              session_filter: sessionFilter,
              symbol_filter: symbolFilter,
            },
          }),
        }
      );

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      setResults(data);
      toast({ title: "Simulation complete", description: `Evaluated ${data.metrics.total_trades} trades` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Simulation failed", description: msg, variant: "destructive" });
    } finally {
      setIsRunning(false);
    }
  };

  if (selectedPlaybookId === "none") {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center space-y-2">
          <Zap className="h-12 w-12 mx-auto opacity-50" />
          <p className="text-lg font-medium">Select a playbook to simulate</p>
          <p className="text-sm">The simulator converts your playbook rules into an alpha and tests it against your trade history.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Control Bar */}
      <div className="border-b border-border bg-card p-4">
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Min R:R</Label>
            <Input
              type="number"
              value={minR}
              onChange={(e) => setMinR(parseFloat(e.target.value) || 1)}
              className="w-20 h-8 text-sm"
              step={0.5}
              min={0.5}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={requireSL} onCheckedChange={setRequireSL} id="req-sl" />
            <Label htmlFor="req-sl" className="text-xs">Require SL</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={sessionFilter} onCheckedChange={setSessionFilter} id="sess-filter" />
            <Label htmlFor="sess-filter" className="text-xs">Session Filter</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={symbolFilter} onCheckedChange={setSymbolFilter} id="sym-filter" />
            <Label htmlFor="sym-filter" className="text-xs">Symbol Filter</Label>
          </div>
          <Button onClick={runSimulation} disabled={!canRun} className="ml-auto gap-2">
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {isRunning ? "Simulating..." : "Run Simulation"}
          </Button>
        </div>
        {playbookName && (
          <p className="text-xs text-muted-foreground mt-2">
            Simulating <span className="font-medium text-foreground">{playbookName}</span> alpha against your trade history
          </p>
        )}
      </div>

      {/* Results */}
      {results ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <Tabs value={activeResultTab} onValueChange={setActiveResultTab} className="h-full flex flex-col">
            <div className="border-b border-border px-4">
              <TabsList className="h-9">
                <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
                <TabsTrigger value="equity" className="text-xs">Equity Curve</TabsTrigger>
                <TabsTrigger value="trades" className="text-xs">Trade Log</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="flex-1 m-0 p-4 overflow-auto">
              <MetricsOverview metrics={results.metrics} />
            </TabsContent>

            <TabsContent value="equity" className="flex-1 m-0 p-4 overflow-auto">
              <EquityCurveChart data={results.equity_curve} />
            </TabsContent>

            <TabsContent value="trades" className="flex-1 m-0 overflow-auto">
              <TradeLogTable trades={results.trade_log} />
            </TabsContent>
          </Tabs>
        </div>
      ) : !isRunning ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <BarChart3 className="h-10 w-10 mx-auto opacity-40" />
            <p className="text-sm">Configure parameters and click <strong>Run Simulation</strong></p>
            <p className="text-xs max-w-md">
              The AI will evaluate each of your trades against the playbook's rules to determine which trades the alpha would have taken or skipped.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground">AI is evaluating your trades against the playbook alpha...</p>
            <p className="text-xs text-muted-foreground">This may take 15-30 seconds</p>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, variant }: { label: string; value: string; icon: React.ElementType; variant?: "positive" | "negative" | "neutral" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            "p-2 rounded-lg",
            variant === "positive" && "bg-green-500/10 text-green-500",
            variant === "negative" && "bg-red-500/10 text-red-500",
            (!variant || variant === "neutral") && "bg-primary/10 text-primary"
          )}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricsOverview({ metrics }: { metrics: SimMetrics }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard
          label="Agreement Score"
          value={`${metrics.agreement_score}%`}
          icon={Target}
          variant={metrics.agreement_score >= 70 ? "positive" : metrics.agreement_score >= 50 ? "neutral" : "negative"}
        />
        <MetricCard
          label="Alpha Win Rate"
          value={`${metrics.win_rate}%`}
          icon={TrendingUp}
          variant={metrics.win_rate >= 55 ? "positive" : metrics.win_rate >= 45 ? "neutral" : "negative"}
        />
        <MetricCard
          label="Profit Factor"
          value={metrics.profit_factor === Infinity ? "∞" : `${metrics.profit_factor}`}
          icon={BarChart3}
          variant={metrics.profit_factor >= 1.5 ? "positive" : metrics.profit_factor >= 1 ? "neutral" : "negative"}
        />
        <MetricCard
          label="Total P&L"
          value={`$${metrics.total_pnl.toLocaleString()}`}
          icon={metrics.total_pnl >= 0 ? TrendingUp : TrendingDown}
          variant={metrics.total_pnl >= 0 ? "positive" : "negative"}
        />
        <MetricCard
          label="Sharpe Ratio"
          value={`${metrics.sharpe}`}
          icon={Zap}
          variant={metrics.sharpe >= 1 ? "positive" : metrics.sharpe >= 0.5 ? "neutral" : "negative"}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Total Trades" value={`${metrics.total_trades}`} icon={BarChart3} />
        <MetricCard label="Alpha Taken" value={`${metrics.alpha_taken}`} icon={CheckCircle2} variant="positive" />
        <MetricCard label="Alpha Skipped" value={`${metrics.alpha_skipped}`} icon={XCircle} variant="neutral" />
        <MetricCard
          label="Max Drawdown"
          value={`$${metrics.max_drawdown.toLocaleString()}`}
          icon={AlertTriangle}
          variant={metrics.max_drawdown > 1000 ? "negative" : "neutral"}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Interpretation</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong>Agreement Score ({metrics.agreement_score}%)</strong> — how often the alpha's decision matches what you actually did.
            {metrics.agreement_score >= 70
              ? " You're following your rules well."
              : " Consider whether the trades the alpha skipped were justified by the playbook."}
          </p>
          <p>
            The alpha would have taken <strong>{metrics.alpha_taken}</strong> of {metrics.total_trades} trades,
            skipping <strong>{metrics.alpha_skipped}</strong>.
            {metrics.alpha_skipped > metrics.alpha_taken
              ? " The playbook is quite selective — the alpha filters aggressively."
              : " The playbook rules are permissive — most trades pass the filter."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function EquityCurveChart({ data }: { data: EquityPoint[] }) {
  const chartData = data.map((d) => ({
    ...d,
    date: new Date(d.date).toLocaleDateString(),
  }));

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Alpha vs Actual Equity</CardTitle>
      </CardHeader>
      <CardContent className="h-[calc(100%-4rem)]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} className="text-muted-foreground" />
            <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            <Line
              type="monotone"
              dataKey="alpha_equity"
              name="Alpha Equity"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="actual_equity"
              name="Actual Equity"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function TradeLogTable({ trades }: { trades: TradeSignal[] }) {
  return (
    <ScrollArea className="h-full">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Signal</TableHead>
            <TableHead className="text-xs">Symbol</TableHead>
            <TableHead className="text-xs">Direction</TableHead>
            <TableHead className="text-xs">Session</TableHead>
            <TableHead className="text-xs">P&L</TableHead>
            <TableHead className="text-xs">R</TableHead>
            <TableHead className="text-xs">Confidence</TableHead>
            <TableHead className="text-xs">Agreed</TableHead>
            <TableHead className="text-xs min-w-[200px]">Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((t) => (
            <TableRow key={t.trade_id} className={cn(t.signal === "skip" && "opacity-60")}>
              <TableCell>
                <Badge variant={t.signal === "take" ? "default" : "secondary"} className="text-xs">
                  {t.signal === "take" ? "TAKE" : "SKIP"}
                </Badge>
              </TableCell>
              <TableCell className="text-xs font-mono">{t.symbol}</TableCell>
              <TableCell className="text-xs">
                <span className={t.direction === "buy" ? "text-green-500" : "text-red-500"}>
                  {t.direction.toUpperCase()}
                </span>
              </TableCell>
              <TableCell className="text-xs">{t.session || "—"}</TableCell>
              <TableCell className={cn("text-xs font-mono", t.actual_pnl >= 0 ? "text-green-500" : "text-red-500")}>
                ${t.actual_pnl.toFixed(2)}
              </TableCell>
              <TableCell className="text-xs font-mono">
                {t.r_multiple != null ? `${t.r_multiple.toFixed(2)}R` : "—"}
              </TableCell>
              <TableCell className="text-xs">{(t.confidence * 100).toFixed(0)}%</TableCell>
              <TableCell>
                {t.agreed ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">{t.reason}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
