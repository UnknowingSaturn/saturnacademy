import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { useQueryClient } from "@tanstack/react-query";
import { useStrategyLabChat } from "@/hooks/useStrategyLabChat";
import { StrategyChat, type ChatMessage } from "@/components/strategy-lab/StrategyChat";
import { ConversationList, type Conversation } from "@/components/strategy-lab/ConversationList";
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
import { Sparkles, PanelLeftClose, PanelLeft, MessageSquare, FlaskConical, TrendingUp, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function StrategyLab() {
  const { user } = useAuth();
  const { data: playbooks } = usePlaybooks();
  const queryClient = useQueryClient();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string>("none");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("chat");

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
      setActiveConversationId(newId);
      return newId;
    }
  }, [selectedPlaybookId, user]);

  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from("strategy_conversations")
      .select("id, title, playbook_id, updated_at")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data);
  }, []);

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
      // Save conversation after stream completes
      const currentMsgs = [...(messagesRef.current), { role: "assistant" as const, content }];
      await saveConversation(currentMsgs, activeConversationIdRef.current);
      loadConversations();
    }, [saveConversation, loadConversations]),
    onPlaybookUpdated: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ["playbooks"] });
    }, [queryClient]),
  });

  // Refs to access latest values in callbacks
  const messagesRef = React.useRef(messages);
  messagesRef.current = messages;
  const activeConversationIdRef = React.useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;

  // Wrap hookSend to also save on abort
  const handleSend = useCallback(async (input: string) => {
    await hookSend(input);
  }, [hookSend]);

  useEffect(() => {
    if (!user) return;
    loadConversations();
  }, [user, loadConversations]);

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

  const handleNewConversation = () => {
    setActiveConversationId(null);
    setMessages([]);
    setSelectedPlaybookId("none");
  };

  const handleDeleteConversation = async (id: string) => {
    await supabase.from("strategy_conversations").delete().eq("id", id);
    if (activeConversationId === id) {
      setActiveConversationId(null);
      setMessages([]);
    }
    loadConversations();
  };

  const handleExportConversation = async (id: string) => {
    const { data } = await supabase
      .from("strategy_conversations")
      .select("title, messages")
      .eq("id", id)
      .single();
    if (!data) return;

    const msgs = data.messages as unknown as ChatMessage[];
    const md = `# ${data.title}\n\n${msgs
      .map((m) => `## ${m.role === "user" ? "You" : "Strategy Lab AI"}\n\n${m.content}`)
      .join("\n\n---\n\n")}`;

    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.title.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [hasTradeData, setHasTradeData] = useState(false);

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

  const showSidebar = activeTab === "chat" && sidebarOpen;

  return (
    <div className="flex h-[calc(100vh-3rem)] overflow-hidden">
      {/* Conversation sidebar — only for Chat tab */}
      {activeTab === "chat" && (
        <div
          className={cn(
            "border-r border-border bg-card transition-all duration-200 shrink-0",
            showSidebar ? "w-64" : "w-0 overflow-hidden"
          )}
        >
          <ConversationList
            conversations={conversations}
            activeId={activeConversationId}
            onSelect={setActiveConversationId}
            onNew={handleNewConversation}
            onDelete={handleDeleteConversation}
            onExport={handleExportConversation}
          />
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header with tabs */}
        <div className="border-b border-border bg-card">
          <div className="flex items-center gap-3 px-4 py-2">
            {activeTab === "chat" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
              </Button>
            )}

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

          {/* Tab bar */}
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

        {/* Tab content */}
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
    </div>
  );
}
