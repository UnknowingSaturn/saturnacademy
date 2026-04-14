import * as React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { StrategyChat, type ChatMessage } from "./StrategyChat";
import { CodeEditor } from "./CodeEditor";
import { StrategyVersionList, type StrategyVersion } from "./StrategyVersionList";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strategy-lab`;

interface CodeLabProps {
  selectedPlaybookId: string;
  playbookName?: string;
}

export function CodeLab({ selectedPlaybookId, playbookName }: CodeLabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentCode, setCurrentCode] = useState("");
  const [currentFilename, setCurrentFilename] = useState("Strategy.mq5");
  const [versions, setVersions] = useState<StrategyVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  const extractCode = (content: string): string | null => {
    const match = content.match(/```mql5\n([\s\S]*?)```/);
    return match ? match[1].trim() : null;
  };

  const saveStrategy = async (code: string, name: string) => {
    if (!user) return;
    const playbookId = selectedPlaybookId === "none" ? null : selectedPlaybookId;
    const existingVersion = versions.find(v => v.playbook_id === playbookId);
    const version = existingVersion ? existingVersion.version + 1 : 1;

    const { data } = await supabase
      .from("generated_strategies")
      .insert([{
        user_id: user.id,
        playbook_id: playbookId,
        name,
        version,
        mql5_code: code,
      }])
      .select("id")
      .single();

    if (data) {
      setActiveVersionId(data.id);
      loadVersions();
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
          mode: "code_generation",
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

      // Extract code from response and display in editor
      const code = extractCode(assistantContent);
      if (code) {
        setCurrentCode(code);
        const nameMatch = assistantContent.match(/(?:EA|Expert Advisor|strategy)[:\s]*["']?([^"'\n]+)/i);
        const name = nameMatch ? nameMatch[1].trim().slice(0, 50) : playbookName || "Generated EA";
        setCurrentFilename(`${name.replace(/[^a-zA-Z0-9]/g, "_")}.mq5`);
        await saveStrategy(code, name);
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
  }, [messages, isStreaming, selectedPlaybookId, user, playbookName]);

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      {/* Versions sidebar */}
      <ResizablePanel defaultSize={15} minSize={10} maxSize={25}>
        <div className="h-full border-r border-border bg-card">
          <div className="px-3 py-2 border-b border-border">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">EA Versions</h3>
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
      <ResizablePanel defaultSize={40} minSize={25}>
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
      <ResizablePanel defaultSize={45} minSize={25}>
        <CodeEditor code={currentCode} filename={currentFilename} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
