import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useStrategyLabChat } from "@/hooks/useStrategyLabChat";
import { StrategyChat } from "./StrategyChat";
import { CodeEditor } from "./CodeEditor";
import { StrategyVersionList, type StrategyVersion } from "./StrategyVersionList";
import { ReportUpload } from "./ReportUpload";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Download,
  RotateCcw,
  FlaskConical,
  ArrowRight,
} from "lucide-react";
import { BacktestMetricsGrid, type ParsedMetrics, type TradeRecord } from "./backtest/BacktestMetricsGrid";
import { CSVImport } from "./backtest/CSVImport";
import { EquityCurveChart } from "./backtest/EquityCurveChart";
import { TradeDistributionCharts } from "./backtest/TradeDistributionCharts";
import { MonteCarloPanel } from "./backtest/MonteCarloPanel";

interface BacktestDashboardProps {
  selectedPlaybookId: string;
  playbookName?: string;
}

type Phase = "build" | "run" | "analyze";

function parseMetricsFromString(raw: string): ParsedMetrics {
  const extract = (pattern: RegExp) => {
    const m = raw.match(pattern);
    return m ? m[1]?.trim() : undefined;
  };
  const num = (s?: string) => {
    if (!s) return undefined;
    const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? undefined : n;
  };
  const pctMatch = (s?: string) => {
    if (!s) return undefined;
    const m = s.match(/([\d.]+)\s*%/);
    return m ? parseFloat(m[1]) : undefined;
  };

  return {
    totalNetProfit: num(extract(/Total Net Profit[:\s]*\*?\*?([^\n*]+)/i)),
    grossProfit: num(extract(/Gross Profit[:\s]*\*?\*?([^\n*]+)/i)),
    grossLoss: num(extract(/Gross Loss[:\s]*\*?\*?([^\n*]+)/i)),
    profitFactor: num(extract(/Profit Factor[:\s]*\*?\*?([^\n*]+)/i)),
    sharpeRatio: num(extract(/Sharpe Ratio[:\s]*\*?\*?([^\n*]+)/i)),
    maxDrawdownPct: pctMatch(extract(/(?:Maximal|Max|Maximum)\s*Drawdown[:\s]*\*?\*?([^\n*]+)/i)),
    maxDrawdownAbs: num(extract(/(?:Maximal|Max|Maximum)\s*Drawdown[:\s]*\*?\*?([^\n*]+)/i)),
    totalTrades: num(extract(/Total Trades[:\s]*\*?\*?([^\n*]+)/i)),
    winRate: pctMatch(extract(/(?:Win Rate|Profit Trades.*?%)[:\s]*\*?\*?([^\n*]+)/i)) ??
      (() => {
        const total = num(extract(/Total Trades[:\s]*\*?\*?([^\n*]+)/i));
        const profitTrades = num(extract(/Profit Trades[:\s]*\*?\*?(\d+)/i));
        return total && profitTrades ? (profitTrades / total) * 100 : undefined;
      })(),
    avgWin: num(extract(/Average (?:profit|win) trade[:\s]*\*?\*?([^\n*]+)/i)),
    avgLoss: num(extract(/Average (?:loss|losing) trade[:\s]*\*?\*?([^\n*]+)/i)),
    bestTrade: num(extract(/(?:Largest|Best) profit trade[:\s]*\*?\*?([^\n*]+)/i)),
    worstTrade: num(extract(/(?:Largest|Worst) loss trade[:\s]*\*?\*?([^\n*]+)/i)),
    expectancy: num(extract(/Expected Payoff[:\s]*\*?\*?([^\n*]+)/i)),
    recoveryFactor: num(extract(/Recovery Factor[:\s]*\*?\*?([^\n*]+)/i)),
    avgDuration: extract(/(?:Average|Avg)\s*(?:Duration|holding time)[:\s]*\*?\*?([^\n*]+)/i),
    raw,
  };
}

export function BacktestDashboard({ selectedPlaybookId, playbookName }: BacktestDashboardProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("build");
  const [currentCode, setCurrentCode] = useState("");
  const [currentFilename, setCurrentFilename] = useState("Strategy.mq5");
  const [versions, setVersions] = useState<StrategyVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [backtestMetrics, setBacktestMetrics] = useState<ParsedMetrics | null>(null);
  const [rawMetricsStr, setRawMetricsStr] = useState<string | null>(null);
  const [tradeRecords, setTradeRecords] = useState<TradeRecord[]>([]);

  const extraBody = useMemo(
    () => (rawMetricsStr ? { backtest_metrics: rawMetricsStr } : {}),
    [rawMetricsStr]
  );

  const extractAndSaveCode = useCallback(
    async (content: string) => {
      const match = content.match(/```(?:mql5|cpp|MQL5)\n([\s\S]*?)```/i);
      if (!match) return;
      const code = match[1].trim();
      setCurrentCode(code);
      const nameMatch = content.match(
        /(?:EA|Expert Advisor|strategy)[:\s]*["']?([^"'\n]+)/i
      );
      const name = nameMatch
        ? nameMatch[1].trim().slice(0, 50)
        : playbookName || "Generated EA";
      const safeName = name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
      setCurrentFilename(`${safeName || "Strategy"}.mq5`);
      setPhase("run");

      if (!user) return;
      const playbookId = selectedPlaybookId === "none" ? null : selectedPlaybookId;
      const existingVersion = versions.find((v) => v.playbook_id === playbookId);
      const version = existingVersion ? existingVersion.version + 1 : 1;

      const { data } = await supabase
        .from("generated_strategies")
        .insert([{ user_id: user.id, playbook_id: playbookId, name, version, mql5_code: code }])
        .select("id")
        .single();

      if (data) {
        setActiveVersionId(data.id);
        loadVersions();
      }
    },
    [user, selectedPlaybookId, playbookName]
  );

  const loadVersions = useCallback(async () => {
    const query = supabase
      .from("generated_strategies")
      .select("id, name, version, created_at, playbook_id")
      .order("created_at", { ascending: false })
      .limit(50);
    if (selectedPlaybookId !== "none") query.eq("playbook_id", selectedPlaybookId);
    const { data } = await query;
    if (data) setVersions(data);
  };

  const handleSelectVersion = async (id: string) => {
    setActiveVersionId(id);
    const { data } = await supabase
      .from("generated_strategies")
      .select("mql5_code, name")
      .eq("id", id)
      .single();
    if (data) {
      setCurrentCode(data.mql5_code);
      setCurrentFilename(`${data.name.replace(/[^a-zA-Z0-9]/g, "_")}.mq5`);
      setPhase("run");
    }
  };

  const handleDeleteVersion = async (id: string) => {
    await supabase.from("generated_strategies").delete().eq("id", id);
    if (activeVersionId === id) {
      setActiveVersionId(null);
      setCurrentCode("");
    }
    loadVersions();
  };

  const handleMetricsParsed = useCallback(
    (metrics: string) => {
      setRawMetricsStr(metrics);
      setBacktestMetrics(parseMetricsFromString(metrics));
      setPhase("analyze");
      toast({ title: "Report parsed", description: "Metrics extracted. Analyze results below." });
    },
    [toast]
  );

  const handleCSVImport = useCallback(
    (trades: TradeRecord[], metrics: ParsedMetrics) => {
      setTradeRecords(trades);
      setBacktestMetrics(metrics);
      setRawMetricsStr(metrics.raw);
      setPhase("analyze");
    },
    []
  );

  const handleReset = () => {
    resetMessages();
    setPhase("build");
    setCurrentCode("");
    setActiveVersionId(null);
    setBacktestMetrics(null);
    setRawMetricsStr(null);
    setTradeRecords([]);
  };

  const phases: { key: Phase; label: string; num: number }[] = [
    { key: "build", label: "Build EA", num: 1 },
    { key: "run", label: "Run in MT5", num: 2 },
    { key: "analyze", label: "Analyze Results", num: 3 },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Phase stepper */}
      <div className="border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-2">
          {phases.map((p, i) => (
            <React.Fragment key={p.key}>
              <button
                onClick={() => {
                  if (p.key === "build") setPhase("build");
                  else if (p.key === "run" && currentCode) setPhase("run");
                  else if (p.key === "analyze" && backtestMetrics) setPhase("analyze");
                }}
                className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded transition-colors ${
                  phase === p.key
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    phase === p.key
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {p.num}
                </span>
                {p.label}
              </button>
              {i < phases.length - 1 && (
                <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
              )}
            </React.Fragment>
          ))}
          <div className="ml-auto">
            <Button variant="ghost" size="sm" onClick={handleReset} className="text-xs h-7">
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {phase === "build" && (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={15} minSize={10} maxSize={25}>
              <div className="h-full border-r border-border bg-card">
                <div className="px-3 py-2 border-b border-border">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    EA Versions
                  </h3>
                </div>
                <StrategyVersionList
                  versions={versions}
                  activeId={activeVersionId}
                  onSelect={handleSelectVersion}
                  onDelete={handleDeleteVersion}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={45} minSize={25}>
              <StrategyChat
                messages={messages}
                isStreaming={isStreaming}
                onSend={handleSend}
                onAbort={handleAbort}
                playbookName={playbookName}
                hasPlaybook={selectedPlaybookId !== "none"}
                hasTradeData={false}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={40} minSize={20}>
              <CodeEditor code={currentCode} filename={currentFilename} />
            </ResizablePanel>
          </ResizablePanelGroup>
        )}

        {phase === "run" && (
          <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <FlaskConical className="h-8 w-8 text-primary" />
            </div>
            <div className="text-center max-w-lg space-y-2">
              <h2 className="text-lg font-semibold text-foreground">Run in MT5 Strategy Tester</h2>
              <p className="text-sm text-muted-foreground">
                Your EA has been generated. Follow these steps to backtest it:
              </p>
            </div>
            <div className="grid gap-3 max-w-lg w-full">
              <StepCard
                num={1}
                title="Download the EA"
                desc="Save the .mq5 file to your computer"
                action={
                  currentCode ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const blob = new Blob([currentCode], { type: "text/plain" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = currentFilename;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      Download {currentFilename}
                    </Button>
                  ) : null
                }
              />
              <StepCard num={2} title="Copy to MetaTrader 5" desc="Place the file in your MQL5/Experts/ folder, then compile it in MetaEditor (F7)" />
              <StepCard num={3} title="Run Strategy Tester" desc="Open Strategy Tester (Ctrl+R), select the EA, configure symbol, period, and date range, then run" />
              <StepCard num={4} title="Export Results" desc='Right-click the Backtest tab → "Save as Report (HTML)" or export the trade list as CSV' />
            </div>
            <div className="flex gap-3 mt-2 items-center flex-wrap justify-center">
              <Button variant="outline" onClick={() => setPhase("build")}>
                ← Back to Builder
              </Button>
              <ReportUpload onMetricsParsed={handleMetricsParsed} disabled={isStreaming} />
              <CSVImport onDataParsed={handleCSVImport} disabled={isStreaming} />
              <span className="text-xs text-muted-foreground">Upload HTML report or CSV trade log</span>
            </div>
          </div>
        )}

        {phase === "analyze" && backtestMetrics && (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Metrics grid */}
            <div className="border-b border-border p-3 bg-card shrink-0">
              <BacktestMetricsGrid metrics={backtestMetrics} />
              <div className="flex gap-2 mt-2 items-center flex-wrap">
                <ReportUpload onMetricsParsed={handleMetricsParsed} disabled={isStreaming} />
                <CSVImport onDataParsed={handleCSVImport} disabled={isStreaming} />
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setPhase("build")}>
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Refine EA
                </Button>
              </div>
            </div>

            {/* Tabbed analysis */}
            <Tabs defaultValue="ai" className="flex-1 flex flex-col min-h-0">
              <div className="border-b border-border px-3 bg-card shrink-0">
                <TabsList className="bg-transparent h-8">
                  <TabsTrigger value="ai" className="text-xs h-7">AI Analysis</TabsTrigger>
                  <TabsTrigger value="equity" className="text-xs h-7" disabled={tradeRecords.length === 0}>
                    Equity Curve
                  </TabsTrigger>
                  <TabsTrigger value="distribution" className="text-xs h-7" disabled={tradeRecords.length === 0}>
                    Distribution
                  </TabsTrigger>
                  <TabsTrigger value="montecarlo" className="text-xs h-7" disabled={tradeRecords.length === 0}>
                    Monte Carlo
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="ai" className="flex-1 min-h-0 mt-0">
                <StrategyChat
                  messages={messages}
                  isStreaming={isStreaming}
                  onSend={handleSend}
                  onAbort={handleAbort}
                  onBacktestMetrics={handleMetricsParsed}
                  playbookName={playbookName}
                  hasPlaybook={selectedPlaybookId !== "none"}
                  hasTradeData={false}
                />
              </TabsContent>

              <TabsContent value="equity" className="flex-1 min-h-0 mt-0 p-4 overflow-auto">
                <EquityCurveChart trades={tradeRecords} />
              </TabsContent>

              <TabsContent value="distribution" className="flex-1 min-h-0 mt-0 p-4 overflow-auto">
                <TradeDistributionCharts trades={tradeRecords} />
              </TabsContent>

              <TabsContent value="montecarlo" className="flex-1 min-h-0 mt-0 p-4 overflow-auto">
                <MonteCarloPanel trades={tradeRecords} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}

function StepCard({
  num,
  title,
  desc,
  action,
}: {
  num: number;
  title: string;
  desc: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 pt-3 pb-3 px-4">
        <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0 mt-0.5">
          {num}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
          {action && <div className="mt-2">{action}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
