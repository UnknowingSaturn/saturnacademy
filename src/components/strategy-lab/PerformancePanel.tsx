import * as React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { StrategyChat, type ChatMessage } from "./StrategyChat";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Target, BarChart3, Clock, Layers } from "lucide-react";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strategy-lab`;

interface PerformancePanelProps {
  selectedPlaybookId: string;
  playbookName?: string;
}

interface PerformanceStats {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  avgR: number;
  bestSymbol: string | null;
  worstSymbol: string | null;
  bestSession: string | null;
  avgDuration: string;
  bySession: Record<string, { wins: number; total: number; pnl: number }>;
  bySymbol: Record<string, { wins: number; total: number; pnl: number }>;
}

export function PerformancePanel({ selectedPlaybookId, playbookName }: PerformancePanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [stats, setStats] = useState<PerformanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!user) return;
    loadStats();
  }, [user, selectedPlaybookId]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const query = supabase
        .from("trades")
        .select("symbol, direction, session, net_pnl, r_multiple_actual, entry_time, exit_time, duration_seconds, is_open, playbook_id")
        .eq("is_open", false)
        .order("exit_time", { ascending: false })
        .limit(200);

      if (selectedPlaybookId !== "none") {
        query.eq("playbook_id", selectedPlaybookId);
      }

      const { data: trades } = await query;
      if (!trades || trades.length === 0) {
        setStats(null);
        setLoading(false);
        return;
      }

      const wins = trades.filter((t) => (t.net_pnl ?? 0) > 0).length;
      const totalPnl = trades.reduce((s, t) => s + (t.net_pnl ?? 0), 0);
      const rTrades = trades.filter((t) => t.r_multiple_actual != null);
      const avgR = rTrades.length > 0 ? rTrades.reduce((s, t) => s + (t.r_multiple_actual ?? 0), 0) / rTrades.length : 0;

      const bySession: Record<string, { wins: number; total: number; pnl: number }> = {};
      const bySymbol: Record<string, { wins: number; total: number; pnl: number }> = {};

      for (const t of trades) {
        const s = t.session || "unknown";
        if (!bySession[s]) bySession[s] = { wins: 0, total: 0, pnl: 0 };
        bySession[s].total++;
        bySession[s].pnl += t.net_pnl ?? 0;
        if ((t.net_pnl ?? 0) > 0) bySession[s].wins++;

        if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { wins: 0, total: 0, pnl: 0 };
        bySymbol[t.symbol].total++;
        bySymbol[t.symbol].pnl += t.net_pnl ?? 0;
        if ((t.net_pnl ?? 0) > 0) bySymbol[t.symbol].wins++;
      }

      const bestSymbol = Object.entries(bySymbol).sort((a, b) => b[1].pnl - a[1].pnl)[0]?.[0] || null;
      const worstSymbol = Object.entries(bySymbol).sort((a, b) => a[1].pnl - b[1].pnl)[0]?.[0] || null;
      const bestSession = Object.entries(bySession).sort((a, b) => (b[1].wins / b[1].total) - (a[1].wins / a[1].total))[0]?.[0] || null;

      const avgDurationSec = trades.filter(t => t.duration_seconds).reduce((s, t) => s + (t.duration_seconds ?? 0), 0) / Math.max(1, trades.filter(t => t.duration_seconds).length);
      const hours = Math.floor(avgDurationSec / 3600);
      const minutes = Math.floor((avgDurationSec % 3600) / 60);
      const avgDuration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

      setStats({
        totalTrades: trades.length,
        winRate: (wins / trades.length) * 100,
        totalPnl,
        avgR,
        bestSymbol,
        worstSymbol,
        bestSession,
        avgDuration,
        bySession,
        bySymbol,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

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
          mode: "performance_analysis",
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
  }, [messages, isStreaming, selectedPlaybookId]);

  return (
    <div className="flex flex-col h-full">
      {/* Stats header */}
      <div className="border-b border-border p-4 bg-card">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading performance data...</p>
        ) : !stats ? (
          <p className="text-sm text-muted-foreground">No trades found{selectedPlaybookId !== "none" ? " for this playbook" : ""}. Start trading to see performance analysis.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <Card><CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground">Win Rate</p>
                <p className="text-lg font-semibold">{stats.winRate.toFixed(1)}%</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground">Total P&L</p>
                <p className={`text-lg font-semibold ${stats.totalPnl >= 0 ? "text-green-500" : "text-red-500"}`}>{stats.totalPnl.toFixed(2)}</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground">Avg R</p>
                <p className={`text-lg font-semibold ${stats.avgR >= 0 ? "text-green-500" : "text-red-500"}`}>{stats.avgR.toFixed(2)}R</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground">Total Trades</p>
                <p className="text-lg font-semibold">{stats.totalTrades}</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground">Best Symbol</p>
                <p className="text-lg font-semibold text-green-500">{stats.bestSymbol || "—"}</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 px-4">
                <p className="text-xs text-muted-foreground">Avg Duration</p>
                <p className="text-lg font-semibold">{stats.avgDuration}</p>
              </CardContent></Card>
            </div>

            {/* Session & Symbol breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">By Session</p>
                  <div className="space-y-1.5">
                    {Object.entries(stats.bySession).map(([session, data]) => (
                      <div key={session} className="flex items-center justify-between text-sm">
                        <span className="capitalize">{session.replace(/_/g, " ")}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{data.total} trades</span>
                          <span className={data.pnl >= 0 ? "text-green-500" : "text-red-500"}>{(data.wins / data.total * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">By Symbol</p>
                  <div className="space-y-1.5">
                    {Object.entries(stats.bySymbol).sort((a, b) => b[1].pnl - a[1].pnl).slice(0, 8).map(([symbol, data]) => (
                      <div key={symbol} className="flex items-center justify-between text-sm">
                        <span>{symbol}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{data.total} trades</span>
                          <span className={data.pnl >= 0 ? "text-green-500" : "text-red-500"}>{data.pnl.toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>

      {/* Chat */}
      <div className="flex-1 min-h-0">
        <StrategyChat
          messages={messages}
          isStreaming={isStreaming}
          onSend={handleSend}
          onAbort={handleAbort}
          playbookName={playbookName}
          hasPlaybook={selectedPlaybookId !== "none"}
          hasTradeData={!!stats}
        />
      </div>
    </div>
  );
}
