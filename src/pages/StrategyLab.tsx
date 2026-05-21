import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { useQueryClient } from "@tanstack/react-query";
import { useStrategyLabChat } from "@/hooks/useStrategyLabChat";
import { StrategyChat, type ChatMessage } from "@/components/strategy-lab/StrategyChat";
import { STRATEGY_CONVERSATIONS_KEY } from "@/components/strategy-lab/StrategyLabConversationsGroup";
import { BacktestDashboard } from "@/components/strategy-lab/BacktestDashboard";
import { PerformancePanel } from "@/components/strategy-lab/PerformancePanel";
import { GapAnalysis } from "@/components/strategy-lab/GapAnalysis";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, MessageSquare, FlaskConical, TrendingUp, Shield } from "lucide-react";

export default function StrategyLab() {
  const { user } = useAuth();
  const { data: playbooks } = usePlaybooks();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeConversationId = searchParams.get("c");

  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string>("none");
  const [activeTab, setActiveTab] = useState("chat");
  const [hasTradeData, setHasTradeData] = useState(false);

  const selectedPlaybook = playbooks?.find((p) => p.id === selectedPlaybookId);

  // Conversation persistence helpers
  const saveConversation = useCallback(async (msgs: ChatMessage[], convId: string | null): Promise<string> => {
    const playbookId = selectedPlaybookId === "none" ? null : selectedPlaybookId;
    const firstUserMsg = msgs.find((m) => m.role === "user");
    const title = firstUserMsg?.content.slice(0, 60) || "New Conversation";

    if (convId) {
      await supabase
        .from("strategy_conversations")
        .update({ messages: JSON.parse(JSON.stringify(msgs)), playbook_id: playbookId, title })
        .eq("id", convId);
      return convId;
    } else {
      const { data } = await supabase
        .from("strategy_conversations")
        .insert([{
          user_id: user!.id,
          title,
          playbook_id: playbookId,
          messages: JSON.parse(JSON.stringify(msgs)),
        }])
        .select("id")
        .single();
      const newId = data!.id;
      setSearchParams({ c: newId }, { replace: true });
      return newId;
    }
  }, [selectedPlaybookId, user, setSearchParams]);

  // Use the shared SSE streaming hook
  const {
    messages,
    setMessages,
    isStreaming,
    handleSend: hookSend,
    handleAbort,
  } = useStrategyLabChat({
    mode: "chat",
    selectedPlaybookId,
    onContentComplete: useCallback(async (content: string) => {
      const currentMsgs = [...(messagesRef.current), { role: "assistant" as const, content }];
      await saveConversation(currentMsgs, activeConversationIdRef.current);
      queryClient.invalidateQueries({ queryKey: STRATEGY_CONVERSATIONS_KEY });
    }, [saveConversation, queryClient]),
    onPlaybookUpdated: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ["playbooks"] });
    }, [queryClient]),
  });

  // Refs to access latest values in callbacks
  const messagesRef = React.useRef(messages);
  messagesRef.current = messages;
  const activeConversationIdRef = React.useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;

  const handleSend = useCallback(async (input: string) => {
    await hookSend(input);
  }, [hookSend]);

  // Load a conversation when ?c changes
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }
    const loadMessages = async () => {
      const { data } = await supabase
        .from("strategy_conversations")
        .select("messages, playbook_id")
        .eq("id", activeConversationId)
        .single();
      if (data) {
        setMessages((data.messages as unknown as ChatMessage[]) || []);
        if (data.playbook_id) setSelectedPlaybookId(data.playbook_id);
      }
    };
    loadMessages();
  }, [activeConversationId, setMessages]);

  useEffect(() => {
    if (!user) return;
    const checkTradeData = async () => {
      const query = supabase
        .from("trades")
        .select("id", { count: "exact", head: true })
        .eq("is_open", false);
      if (selectedPlaybookId !== "none") {
        query.eq("playbook_id", selectedPlaybookId);
      }
      const { count } = await query;
      setHasTradeData((count ?? 0) > 0);
    };
    checkTradeData();
  }, [user, selectedPlaybookId]);

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] overflow-hidden">
      {/* Header with tabs */}
      <div className="border-b border-border bg-card">
        <div className="flex items-center gap-3 px-4 py-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="font-semibold text-foreground">Strategy Lab</h1>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <Select value={selectedPlaybookId} onValueChange={setSelectedPlaybookId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select playbook" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No playbook</SelectItem>
                {playbooks?.map((pb) => (
                  <SelectItem key={pb.id} value={pb.id}>
                    {pb.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="px-4">
          <TabsList className="h-9">
            <TabsTrigger value="chat" className="gap-1.5 text-xs">
              <MessageSquare className="h-3.5 w-3.5" />
              Chat
            </TabsTrigger>
            <TabsTrigger value="backtester" className="gap-1.5 text-xs">
              <FlaskConical className="h-3.5 w-3.5" />
              Backtester
            </TabsTrigger>
            <TabsTrigger value="performance" className="gap-1.5 text-xs">
              <TrendingUp className="h-3.5 w-3.5" />
              Performance
            </TabsTrigger>
            <TabsTrigger value="gaps" className="gap-1.5 text-xs">
              <Shield className="h-3.5 w-3.5" />
              Gap Analysis
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 min-h-0">
        {activeTab === "chat" && (
          <StrategyChat
            messages={messages}
            isStreaming={isStreaming}
            onSend={handleSend}
            onAbort={handleAbort}
            playbookName={selectedPlaybook?.name}
            hasPlaybook={selectedPlaybookId !== "none"}
            hasTradeData={hasTradeData}
          />
        )}

        {activeTab === "backtester" && (
          <BacktestDashboard
            selectedPlaybookId={selectedPlaybookId}
            playbookName={selectedPlaybook?.name}
          />
        )}

        {activeTab === "performance" && (
          <PerformancePanel
            selectedPlaybookId={selectedPlaybookId}
            playbookName={selectedPlaybook?.name}
          />
        )}

        {activeTab === "gaps" && (
          <GapAnalysis
            selectedPlaybookId={selectedPlaybookId}
            playbookName={selectedPlaybook?.name}
          />
        )}
      </div>
    </div>
  );
}
