import * as React from "react";
import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  Send,
  RotateCcw,
  Info,
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
import ReactMarkdown from "react-markdown";

interface BacktestPanelProps {
  selectedPlaybookId: string;
  playbookName?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AlphaDefinition {
  name?: string;
  filters: {
    symbols?: string[];
    sessions?: string[];
    min_rr?: number;
    require_sl?: boolean;
    max_trades_per_day?: number;
    max_daily_loss_r?: number;
    allowed_directions?: string[];
    min_duration_minutes?: number;
    max_duration_minutes?: number;
  };
  unverifiable_rules?: Array<{ rule: string; assumed: string; note: string }>;
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

interface BacktestResults {
  id: string;
  metrics: SimMetrics;
  equity_curve: Array<{ date: string; alpha_equity: number; actual_equity: number }>;
  trade_log: TradeSignal[];
  alpha_definition: AlphaDefinition;
  unverifiable_rules: Array<{ rule: string; assumed: string; note: string }>;
  filters_applied: string[];
}

const SIMULATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/simulate-alpha`;

export function BacktestPanel({ selectedPlaybookId, playbookName }: BacktestPanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isRunningBacktest, setIsRunningBacktest] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Alpha & results
  const [alpha, setAlpha] = useState<AlphaDefinition | null>(null);
  const [results, setResults] = useState<BacktestResults | null>(null);
  const [activeResultTab, setActiveResultTab] = useState("overview");
  const [phase, setPhase] = useState<"build" | "results">("build");

  // Extract alpha JSON from assistant message
  const extractAlpha = (content: string): AlphaDefinition | null => {
    const match = content.match(/```alpha-json\s*\n([\s\S]*?)```/);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  };

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming || !user) return;

    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let assistantContent = "";

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const resp = await fetch(SIMULATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          mode: "build_alpha",
          messages: newMessages,
          playbook_id: selectedPlaybookId === "none" ? null : selectedPlaybookId,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const updateAssistant = (content: string) => {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content } : m));
          }
          return [...prev, { role: "assistant", content }];
        });
      };

      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantContent += delta;
              updateAssistant(assistantContent);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      // Check if alpha was generated
      const extracted = extractAlpha(assistantContent);
      if (extracted) setAlpha(extracted);

      // Scroll to bottom
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 100);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast({ title: "Error", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, messages, isStreaming, user, selectedPlaybookId, toast]);

  const runBacktest = async () => {
    if (!alpha || !user || isRunningBacktest) return;
    setIsRunningBacktest(true);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const resp = await fetch(SIMULATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          mode: "run_backtest",
          playbook_id: selectedPlaybookId,
          alpha,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      setResults(data);
      setPhase("results");
      toast({ title: "Backtest complete", description: `Evaluated ${data.metrics.total_trades} trades deterministically` });
    } catch (e) {
      toast({ title: "Backtest failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsRunningBacktest(false);
    }
  };

  const handleRefine = () => {
    setPhase("build");
  };

  const handleReset = () => {
    setMessages([]);
    setAlpha(null);
    setResults(null);
    setPhase("build");
    setInput("");
  };

  if (selectedPlaybookId === "none") {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center space-y-2">
          <Zap className="h-12 w-12 mx-auto opacity-50" />
          <p className="text-lg font-medium">Select a playbook to backtest</p>
          <p className="text-sm">The backtester converts your playbook rules into a deterministic alpha and tests it against your trade history.</p>
        </div>
      </div>
    );
  }

  // ─── Results Phase ───
  if (phase === "results" && results) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b border-border bg-card p-4 flex items-center justify-between">
          <div>
            <h3 className="font-medium text-sm">Backtest Results — {alpha?.name || playbookName}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {results.filters_applied.length} filters applied deterministically •{" "}
              {results.unverifiable_rules.length} rules assumed met (no chart data)
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRefine} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Refine Alpha
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset}>Reset</Button>
          </div>
        </div>

        {/* Unverifiable rules banner */}
        {results.unverifiable_rules.length > 0 && (
          <div className="border-b border-border bg-muted/30 px-4 py-2">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Unverifiable rules (assumed met):</span>{" "}
                {results.unverifiable_rules.map((r) => r.rule).join(" • ")}
              </div>
            </div>
          </div>
        )}

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
              <MetricsOverview metrics={results.metrics} filtersApplied={results.filters_applied} />
            </TabsContent>
            <TabsContent value="equity" className="flex-1 m-0 p-4 overflow-auto">
              <EquityCurveChart data={results.equity_curve} />
            </TabsContent>
            <TabsContent value="trades" className="flex-1 m-0 overflow-auto">
              <TradeLogTable trades={results.trade_log} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    );
  }

  // ─── Build Phase (Chat) ───
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border bg-card px-4 py-3 flex items-center justify-between">
        <div>
          <h3 className="font-medium text-sm">Alpha Builder — {playbookName || "Backtest"}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Chat with AI to convert your playbook rules into a deterministic alpha
          </p>
        </div>
        <div className="flex gap-2">
          {alpha && (
            <Button size="sm" onClick={runBacktest} disabled={isRunningBacktest} className="gap-1.5">
              {isRunningBacktest ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run Backtest
            </Button>
          )}
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleReset}>Reset</Button>
          )}
        </div>
      </div>

      {/* Alpha preview bar */}
      {alpha && (
        <div className="border-b border-border bg-primary/5 px-4 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
            <span className="text-xs font-medium">Alpha ready:</span>
            {alpha.filters.symbols && alpha.filters.symbols.length > 0 && (
              <Badge variant="secondary" className="text-xs">Symbols: {alpha.filters.symbols.join(", ")}</Badge>
            )}
            {alpha.filters.sessions && alpha.filters.sessions.length > 0 && (
              <Badge variant="secondary" className="text-xs">Sessions: {alpha.filters.sessions.join(", ")}</Badge>
            )}
            {alpha.filters.min_rr && (
              <Badge variant="secondary" className="text-xs">Min R:R {alpha.filters.min_rr}</Badge>
            )}
            {alpha.filters.require_sl && (
              <Badge variant="secondary" className="text-xs">SL required</Badge>
            )}
            {alpha.filters.max_trades_per_day && (
              <Badge variant="secondary" className="text-xs">Max {alpha.filters.max_trades_per_day}/day</Badge>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Zap className="h-10 w-10 mx-auto opacity-40 mb-3" />
              <p className="text-sm font-medium mb-1">Start building your alpha</p>
              <p className="text-xs max-w-md mx-auto mb-4">
                Type "build my alpha" or describe what you want to test, and the AI will ask about each rule in your playbook to create a deterministic filter set.
              </p>
              <div className="flex gap-2 justify-center flex-wrap">
                <Button variant="outline" size="sm" onClick={() => { setInput("Build my alpha from this playbook"); }}>
                  Build my alpha
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setInput("What rules can you test deterministically?"); }}>
                  What can you test?
                </Button>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-4 py-2.5 text-sm",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                )}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}

          {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-4 py-2.5">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-border bg-card p-3">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your rules or ask to build the alpha..."
            className="min-h-[40px] max-h-[120px] resize-none text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="shrink-0"
          >
            {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components (reused from SimulatorPanel) ───

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

function MetricsOverview({ metrics, filtersApplied }: { metrics: SimMetrics; filtersApplied: string[] }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard
          label="Win Rate"
          value={`${metrics.win_rate}%`}
          icon={TrendingUp}
          variant={metrics.win_rate >= 55 ? "positive" : metrics.win_rate >= 45 ? "neutral" : "negative"}
        />
        <MetricCard
          label="Profit Factor"
          value={metrics.profit_factor >= 999 ? "∞" : `${metrics.profit_factor}`}
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
          label="Avg R"
          value={`${metrics.avg_r}R`}
          icon={Target}
          variant={metrics.avg_r >= 1 ? "positive" : metrics.avg_r >= 0 ? "neutral" : "negative"}
        />
        <MetricCard
          label="Sharpe"
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

      {/* Filters applied */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Filters Applied (Deterministic)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-1.5 flex-wrap">
            {filtersApplied.map((f) => (
              <Badge key={f} variant="outline" className="text-xs">{f.replace(/_/g, " ")}</Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            All filters are applied programmatically — no AI guessing. Results are 100% reproducible.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Interpretation</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            The alpha took <strong>{metrics.alpha_taken}</strong> of {metrics.total_trades} trades,
            skipping <strong>{metrics.alpha_skipped}</strong>.
            {metrics.alpha_skipped > metrics.alpha_taken
              ? " The alpha filters aggressively — your rules are selective."
              : " Most trades pass the filters — your rules are permissive."}
          </p>
          <p>
            <strong>Agreement ({metrics.agreement_score}%)</strong> — how often the alpha matches what you actually tagged to this playbook.
            {metrics.agreement_score >= 70
              ? " You're following your rules well."
              : " There's a gap between your rules and your actual trading."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function EquityCurveChart({ data }: { data: Array<{ date: string; alpha_equity: number; actual_equity: number }> }) {
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
            <Line type="monotone" dataKey="alpha_equity" name="Alpha Equity" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="actual_equity" name="Actual Equity" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
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
