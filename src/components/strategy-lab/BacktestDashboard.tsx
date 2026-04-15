import * as React from "react";
import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { StrategyChat, type ChatMessage } from "./StrategyChat";
import { ReportUpload } from "./ReportUpload";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, TrendingUp, TrendingDown, Target, BarChart3, Activity } from "lucide-react";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strategy-lab`;

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
  expectedPayoff?: string;
  raw: string;
}

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
    expectedPayoff: extract(/Expected Payoff[:\s]*\*?\*?([^\n*]+)/i),
    raw,
  };
}

function MetricCard({ title, value, icon: Icon, variant }: { title: string; value?: string; icon: React.ElementType; variant?: "positive" | "negative" | "neutral" }) {
  const colorClass = variant === "positive" ? "text-green-500" : variant === "negative" ? "text-red-500" : "text-muted-foreground";
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{title}</p>
            <p className="text-lg font-semibold text-foreground">{value || "—"}</p>
          </div>
          <Icon className={`h-5 w-5 ${colorClass}`} />
        </div>
      </CardContent>
    </Card>
  );
}

export function BacktestDashboard({ selectedPlaybookId, playbookName }: BacktestDashboardProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [backtestMetrics, setBacktestMetrics] = useState<BacktestMetrics | null>(null);
  const [rawMetricsStr, setRawMetricsStr] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleMetricsParsed = useCallback((metrics: string) => {
    setRawMetricsStr(metrics);
    setBacktestMetrics(parseMetricsFromString(metrics));
    toast({ title: "Report parsed", description: "Metrics extracted. Ask the AI to analyze them." });
  }, [toast]);

  const handleAbort = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const handleSend = useCallback(async (input: string) => {
    if (isStreaming) return;

    const userMsg: ChatMessage = { role: "user", content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    let assistantContent = "";

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          messages: newMessages,
          playbook_id: selectedPlaybookId === "none" ? null : selectedPlaybookId,
          mode: "backtest_analysis",
          backtest_metrics: rawMetricsStr,
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

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) { assistantContent += delta; updateAssistant(assistantContent); }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      setMessages([...newMessages, { role: "assistant", content: assistantContent }]);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [messages, isStreaming, selectedPlaybookId, rawMetricsStr]);

  const pf = backtestMetrics?.profitFactor ? parseFloat(backtestMetrics.profitFactor) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Metrics header */}
      {backtestMetrics ? (
        <div className="border-b border-border p-4 bg-card">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <MetricCard title="Net Profit" value={backtestMetrics.totalNetProfit} icon={TrendingUp} variant={backtestMetrics.totalNetProfit?.includes("-") ? "negative" : "positive"} />
            <MetricCard title="Profit Factor" value={backtestMetrics.profitFactor} icon={Target} variant={pf && pf >= 1.5 ? "positive" : pf && pf < 1 ? "negative" : "neutral"} />
            <MetricCard title="Sharpe Ratio" value={backtestMetrics.sharpeRatio} icon={Activity} />
            <MetricCard title="Max Drawdown" value={backtestMetrics.maxDrawdown} icon={TrendingDown} variant="negative" />
            <MetricCard title="Total Trades" value={backtestMetrics.totalTrades} icon={BarChart3} />
            <MetricCard title="Recovery Factor" value={backtestMetrics.recoveryFactor} icon={TrendingUp} />
          </div>
        </div>
      ) : (
        <div className="border-b border-border p-8 bg-card flex flex-col items-center gap-3">
          <Upload className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">Upload an MT5 Strategy Tester HTML report to get started</p>
          <ReportUpload onMetricsParsed={handleMetricsParsed} disabled={isStreaming} />
        </div>
      )}

      {/* Chat */}
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
  );
}
