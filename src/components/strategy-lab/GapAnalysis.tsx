import * as React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { StrategyChat, type ChatMessage } from "./StrategyChat";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, XCircle, Zap, Shield, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strategy-lab`;

interface GapAnalysisProps {
  selectedPlaybookId: string;
  playbookName?: string;
}

interface GapItem {
  category: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

function computeGaps(playbook: any): { score: number; items: GapItem[] } {
  const items: GapItem[] = [];

  // Entry rules
  const entryRules = playbook.entry_zone_rules || {};
  const hasEntryRules = Object.keys(entryRules).length > 0 && JSON.stringify(entryRules) !== "{}";
  items.push({
    category: "Entry Rules",
    status: hasEntryRules ? "pass" : "fail",
    message: hasEntryRules ? "Entry zone rules defined" : "No entry zone rules defined",
  });

  // Confirmation rules
  const confirmations = playbook.confirmation_rules || [];
  items.push({
    category: "Confirmations",
    status: confirmations.length >= 2 ? "pass" : confirmations.length === 1 ? "warn" : "fail",
    message: confirmations.length > 0 ? `${confirmations.length} confirmation rule(s)` : "No confirmation rules",
  });

  // Invalidation rules
  const invalidations = playbook.invalidation_rules || [];
  items.push({
    category: "Invalidations",
    status: invalidations.length >= confirmations.length ? "pass" : invalidations.length > 0 ? "warn" : "fail",
    message: invalidations.length > 0 ? `${invalidations.length} invalidation rule(s)` : "No invalidation rules — entries lack clear stop conditions",
  });

  // Management rules
  const management = playbook.management_rules || [];
  items.push({
    category: "Trade Management",
    status: management.length >= 2 ? "pass" : management.length === 1 ? "warn" : "fail",
    message: management.length > 0 ? `${management.length} management rule(s)` : "No management rules for open positions",
  });

  // Failure modes
  const failures = playbook.failure_modes || [];
  items.push({
    category: "Failure Modes",
    status: failures.length >= 3 ? "pass" : failures.length > 0 ? "warn" : "fail",
    message: failures.length > 0 ? `${failures.length} failure mode(s) identified` : "No failure modes documented",
  });

  // Risk limits
  const hasRPerTrade = playbook.max_r_per_trade != null;
  const hasDailyLoss = playbook.max_daily_loss_r != null;
  const hasMaxTrades = playbook.max_trades_per_session != null;
  const riskCount = [hasRPerTrade, hasDailyLoss, hasMaxTrades].filter(Boolean).length;
  items.push({
    category: "Risk Limits",
    status: riskCount === 3 ? "pass" : riskCount > 0 ? "warn" : "fail",
    message: riskCount === 3 ? "All risk limits set" : `${3 - riskCount} risk limit(s) missing`,
  });

  // Session filter
  const sessions = playbook.session_filter || [];
  items.push({
    category: "Session Filter",
    status: sessions.length > 0 ? "pass" : "warn",
    message: sessions.length > 0 ? `Filtered to: ${sessions.join(", ")}` : "No session filter — trades allowed in all sessions",
  });

  // Symbol filter
  const symbols = playbook.symbol_filter || [];
  items.push({
    category: "Symbol Filter",
    status: symbols.length > 0 ? "pass" : "warn",
    message: symbols.length > 0 ? `Filtered to: ${symbols.join(", ")}` : "No symbol filter — all symbols allowed",
  });

  // Checklist
  const checklist = playbook.checklist_questions || [];
  items.push({
    category: "Pre-Trade Checklist",
    status: checklist.length >= 4 ? "pass" : checklist.length > 0 ? "warn" : "fail",
    message: checklist.length > 0 ? `${checklist.length} checklist question(s)` : "No pre-trade checklist questions",
  });

  // Description
  items.push({
    category: "Description",
    status: playbook.description ? "pass" : "warn",
    message: playbook.description ? "Strategy description provided" : "No description — document your edge and ideal conditions",
  });

  const passCount = items.filter(i => i.status === "pass").length;
  const score = Math.round((passCount / items.length) * 100);

  return { score, items };
}

const statusIcon = {
  pass: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  warn: <AlertTriangle className="h-4 w-4 text-yellow-500" />,
  fail: <XCircle className="h-4 w-4 text-red-500" />,
};

export function GapAnalysis({ selectedPlaybookId, playbookName }: GapAnalysisProps) {
  const { user } = useAuth();
  const { data: playbooks } = usePlaybooks();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [gaps, setGaps] = useState<{ score: number; items: GapItem[] } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const playbook = playbooks?.find(p => p.id === selectedPlaybookId);

  useEffect(() => {
    if (playbook) {
      setGaps(computeGaps(playbook));
    } else {
      setGaps(null);
    }
  }, [playbook]);

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
          mode: "gap_analysis",
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

      // Check for playbook updates
      if (assistantContent.includes("[PLAYBOOK_UPDATED]") || assistantContent.includes("[TOOL_RESULT:")) {
        queryClient.invalidateQueries({ queryKey: ["playbooks"] });
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
  }, [messages, isStreaming, selectedPlaybookId, queryClient]);

  if (selectedPlaybookId === "none") {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center space-y-2">
          <Shield className="h-12 w-12 mx-auto opacity-20" />
          <p>Select a playbook to run gap analysis</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Gap analysis header */}
      <div className="border-b border-border p-4 bg-card">
        {gaps ? (
          <div className="space-y-4">
            {/* Score */}
            <div className="flex items-center gap-4">
              <div className={cn(
                "w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold border-4",
                gaps.score >= 80 ? "border-green-500 text-green-500" :
                gaps.score >= 50 ? "border-yellow-500 text-yellow-500" :
                "border-red-500 text-red-500"
              )}>
                {gaps.score}%
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Playbook Completeness</h3>
                <p className="text-sm text-muted-foreground">
                  {gaps.items.filter(i => i.status === "pass").length}/{gaps.items.length} criteria passed
                </p>
              </div>
              <Button
                className="ml-auto"
                size="sm"
                onClick={() => handleSend("Run a deep gap analysis on my playbook. Check every rule category, cross-reference with my journal data, and fix any critical gaps you find.")}
                disabled={isStreaming}
              >
                <Zap className="h-4 w-4 mr-1" />
                Deep Analyze & Fix
              </Button>
            </div>

            {/* Gap cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              {gaps.items.map((item) => (
                <Card key={item.category} className={cn(
                  "border",
                  item.status === "pass" ? "border-green-500/20" :
                  item.status === "warn" ? "border-yellow-500/20" :
                  "border-red-500/20"
                )}>
                  <CardContent className="pt-3 pb-2 px-3">
                    <div className="flex items-center gap-2 mb-1">
                      {statusIcon[item.status]}
                      <span className="text-xs font-medium">{item.category}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{item.message}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading playbook...</span>
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
          hasPlaybook={true}
          hasTradeData={false}
        />
      </div>
    </div>
  );
}
