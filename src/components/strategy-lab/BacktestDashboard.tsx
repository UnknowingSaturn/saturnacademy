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
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  TrendingUp,
  TrendingDown,
  Target,
  BarChart3,
  Activity,
  Download,
  RotateCcw,
  FlaskConical,
  ArrowRight,
} from "lucide-react";

interface BacktestDashboardProps {
  selectedPlaybookId: string;
  playbookName?: string;
}

interface BacktestMetrics {
  totalNetProfit?: string;
  profitFactor?: string;
  sharpeRatio?: string;
  maxDrawdown?: string;
  totalTrades?: string;
  winRate?: string;
  recoveryFactor?: string;
  raw: string;
}

type Phase = "build" | "run" | "analyze";

function parseMetricsFromString(raw: string): BacktestMetrics {
  const extract = (pattern: RegExp) => {
    const m = raw.match(pattern);
    return m ? m[1]?.trim() : undefined;
  };
  return {
    totalNetProfit: extract(/Total Net Profit[:\s]*\*?\*?([^\n*]+)/i),
    profitFactor: extract(/Profit Factor[:\s]*\*?\*?([^\n*]+)/i),
    sharpeRatio: extract(/Sharpe Ratio[:\s]*\*?\*?([^\n*]+)/i),
    maxDrawdown: extract(/(?:Maximal|Max) Drawdown[:\s]*\*?\*?([^\n*]+)/i),
    totalTrades: extract(/Total Trades[:\s]*\*?\*?([^\n*]+)/i),
    winRate: extract(/Win Rate[:\s]*\*?\*?([^\n*]+)/i),
    recoveryFactor: extract(/Recovery Factor[:\s]*\*?\*?([^\n*]+)/i),
    raw,
  };
}

function SmallMetricCard({
  title,
  value,
  icon: Icon,
  variant,
}: {
  title: string;
  value?: string;
  icon: React.ElementType;
  variant?: "positive" | "negative" | "neutral";
}) {
  const colorClass =
    variant === "positive"
      ? "text-green-500"
      : variant === "negative"
        ? "text-red-500"
        : "text-muted-foreground";
  return (
    <Card>
      <CardContent className="pt-3 pb-2 px-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-muted-foreground">{title}</p>
            <p className="text-sm font-semibold text-foreground">{value || "—"}</p>
          </div>
          <Icon className={`h-4 w-4 ${colorClass}`} />
        </div>
      </CardContent>
    </Card>
  );
}

export function BacktestDashboard({ selectedPlaybookId, playbookName }: BacktestDashboardProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("build");
  const [currentCode, setCurrentCode] = useState("");
  const [currentFilename, setCurrentFilename] = useState("Strategy.mq5");
  const [versions, setVersions] = useState<StrategyVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [backtestMetrics, setBacktestMetrics] = useState<BacktestMetrics | null>(null);
  const [rawMetricsStr, setRawMetricsStr] = useState<string | null>(null);

  // Shared streaming hook
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

      // Auto-advance to "run" phase
      setPhase("run");

      // Save to DB
      if (!user) return;
      const playbookId = selectedPlaybookId === "none" ? null : selectedPlaybookId;
      const existingVersion = versions.find((v) => v.playbook_id === playbookId);
      const version = existingVersion ? existingVersion.version + 1 : 1;

      const { data } = await supabase
        .from("generated_strategies")
        .insert([
          {
            user_id: user.id,
            playbook_id: playbookId,
            name,
            version,
            mql5_code: code,
          },
        ])
        .select("id")
        .single();

      if (data) {
        setActiveVersionId(data.id);
        loadVersions();
      }
    },
    [user, selectedPlaybookId, playbookName, versions]
  );

  const {
    messages,
    isStreaming,
    handleSend,
    handleAbort,
    resetMessages,
  } = useStrategyLabChat({
    mode: rawMetricsStr ? "backtest_analysis" : "code_generation",
    selectedPlaybookId,
    extraBody,
    onContentComplete: extractAndSaveCode,
  });

  // Load EA versions
  useEffect(() => {
    if (user) loadVersions();
  }, [user, selectedPlaybookId]);

  const loadVersions = async () => {
    const query = supabase
      .from("generated_strategies")
      .select("id, name, version, created_at, playbook_id")
      .order("created_at", { ascending: false })
      .limit(50);

    if (selectedPlaybookId !== "none") {
      query.eq("playbook_id", selectedPlaybookId);
    }

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
      toast({
        title: "Report parsed",
        description: "Metrics extracted. Ask the AI to analyze them or refine the EA.",
      });
    },
    [toast]
  );

  const handleReset = () => {
    resetMessages();
    setPhase("build");
    setCurrentCode("");
    setActiveVersionId(null);
    setBacktestMetrics(null);
    setRawMetricsStr(null);
  };

  const pf = backtestMetrics?.profitFactor
    ? parseFloat(backtestMetrics.profitFactor)
    : null;

  // Phase indicator
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
            {/* Versions sidebar */}
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

            {/* Chat */}
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

            {/* Code editor */}
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
              <h2 className="text-lg font-semibold text-foreground">
                Run in MT5 Strategy Tester
              </h2>
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
              <StepCard
                num={2}
                title="Copy to MetaTrader 5"
                desc="Place the file in your MQL5/Experts/ folder, then compile it in MetaEditor (F7)"
              />
              <StepCard
                num={3}
                title="Run Strategy Tester"
                desc="Open Strategy Tester (Ctrl+R), select the EA, configure symbol, period, and date range, then run"
              />
              <StepCard
                num={4}
                title="Export HTML Report"
                desc='Right-click the Backtest tab → "Save as Report (HTML)"'
              />
            </div>

            <div className="flex gap-3 mt-2">
              <Button variant="outline" onClick={() => setPhase("build")}>
                ← Back to Builder
              </Button>
              <div className="flex items-center gap-2">
                <ReportUpload onMetricsParsed={handleMetricsParsed} disabled={isStreaming} />
                <span className="text-xs text-muted-foreground">Upload HTML report to continue</span>
              </div>
            </div>
          </div>
        )}

        {phase === "analyze" && (
          <div className="flex flex-col h-full">
            {/* Metrics cards */}
            {backtestMetrics && (
              <div className="border-b border-border p-3 bg-card">
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  <SmallMetricCard
                    title="Net Profit"
                    value={backtestMetrics.totalNetProfit}
                    icon={TrendingUp}
                    variant={
                      backtestMetrics.totalNetProfit?.includes("-")
                        ? "negative"
                        : "positive"
                    }
                  />
                  <SmallMetricCard
                    title="Profit Factor"
                    value={backtestMetrics.profitFactor}
                    icon={Target}
                    variant={
                      pf && pf >= 1.5
                        ? "positive"
                        : pf && pf < 1
                          ? "negative"
                          : "neutral"
                    }
                  />
                  <SmallMetricCard
                    title="Sharpe Ratio"
                    value={backtestMetrics.sharpeRatio}
                    icon={Activity}
                  />
                  <SmallMetricCard
                    title="Max Drawdown"
                    value={backtestMetrics.maxDrawdown}
                    icon={TrendingDown}
                    variant="negative"
                  />
                  <SmallMetricCard
                    title="Total Trades"
                    value={backtestMetrics.totalTrades}
                    icon={BarChart3}
                  />
                  <SmallMetricCard
                    title="Recovery Factor"
                    value={backtestMetrics.recoveryFactor}
                    icon={TrendingUp}
                  />
                </div>
                <div className="flex gap-2 mt-2">
                  <Badge variant="outline" className="text-[10px]">
                    <Upload className="h-3 w-3 mr-1" />
                    Upload new report
                    <span className="ml-1">
                      <ReportUpload
                        onMetricsParsed={handleMetricsParsed}
                        disabled={isStreaming}
                      />
                    </span>
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-6"
                    onClick={() => setPhase("build")}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Refine EA
                  </Button>
                </div>
              </div>
            )}

            {/* Chat for analysis */}
            <div className="flex-1 min-h-0">
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
            </div>
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
