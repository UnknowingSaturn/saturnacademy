import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { useToast } from "@/hooks/use-toast";
import { StrategyChat, type ChatMessage } from "@/components/strategy-lab/StrategyChat";
import { ConversationList, type Conversation } from "@/components/strategy-lab/ConversationList";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, PanelLeftClose, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strategy-lab`;

export default function StrategyLab() {
  const { user } = useAuth();
  const { playbooks } = usePlaybooks();
  const { toast } = useToast();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string>("none");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const selectedPlaybook = playbooks?.find((p) => p.id === selectedPlaybookId);

  // Load conversations
  useEffect(() => {
    if (!user) return;
    loadConversations();
  }, [user]);

  const loadConversations = async () => {
    const { data } = await supabase
      .from("strategy_conversations")
      .select("id, title, playbook_id, updated_at")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data);
  };

  // Load active conversation messages
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }
    loadMessages(activeConversationId);
  }, [activeConversationId]);

  const loadMessages = async (id: string) => {
    const { data } = await supabase
      .from("strategy_conversations")
      .select("messages, playbook_id")
      .eq("id", id)
      .single();
    if (data) {
      setMessages((data.messages as unknown as ChatMessage[]) || []);
      if (data.playbook_id) setSelectedPlaybookId(data.playbook_id);
    }
  };

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

  const saveConversation = async (msgs: ChatMessage[], convId: string | null): Promise<string> => {
    const playbookId = selectedPlaybookId === "none" ? null : selectedPlaybookId;
    // Generate title from first user message
    const firstUserMsg = msgs.find((m) => m.role === "user");
    const title = firstUserMsg?.content.slice(0, 60) || "New Conversation";

    if (convId) {
      await supabase
        .from("strategy_conversations")
        .update({ messages: msgs as unknown as Record<string, unknown>[], playbook_id: playbookId, title })
        .eq("id", convId);
      return convId;
    } else {
      const { data } = await supabase
        .from("strategy_conversations")
        .insert({
          user_id: user!.id,
          title,
          playbook_id: playbookId,
          messages: msgs as unknown as Record<string, unknown>[],
        })
        .select("id")
        .single();
      const newId = data!.id;
      setActiveConversationId(newId);
      return newId;
    }
  };

  const handleSend = useCallback(
    async (input: string) => {
      if (isStreaming) return;

      const userMsg: ChatMessage = { role: "user", content: input };
      const newMessages = [...messages, userMsg];
      setMessages(newMessages);
      setIsStreaming(true);

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
            conversation_id: activeConversationId,
          }),
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
            if (jsonStr === "[DONE]") {
              streamDone = true;
              break;
            }

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

        // Flush remaining buffer
        if (buffer.trim()) {
          for (let raw of buffer.split("\n")) {
            if (!raw) continue;
            if (raw.endsWith("\r")) raw = raw.slice(0, -1);
            if (!raw.startsWith("data: ")) continue;
            const jsonStr = raw.slice(6).trim();
            if (jsonStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                assistantContent += delta;
                updateAssistant(assistantContent);
              }
            } catch { /* ignore */ }
          }
        }

        // Save conversation
        const finalMessages = [...newMessages, { role: "assistant" as const, content: assistantContent }];
        await saveConversation(finalMessages, activeConversationId);
        loadConversations();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        toast({ title: "Error", description: msg, variant: "destructive" });
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, isStreaming, selectedPlaybookId, activeConversationId, user]
  );

  return (
    <div className="flex h-[calc(100vh-3rem)] overflow-hidden">
      {/* Conversation sidebar */}
      <div
        className={cn(
          "border-r border-border bg-card transition-all duration-200 shrink-0",
          sidebarOpen ? "w-64" : "w-0 overflow-hidden"
        )}
      >
        <ConversationList
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={setActiveConversationId}
          onNew={handleNewConversation}
          onDelete={handleDeleteConversation}
        />
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </Button>

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

        {/* Chat */}
        <StrategyChat
          messages={messages}
          isStreaming={isStreaming}
          onSend={handleSend}
          playbookName={selectedPlaybook?.name}
        />
      </div>
    </div>
  );
}
