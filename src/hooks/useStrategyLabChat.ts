import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { ChatMessage } from "@/components/strategy-lab/StrategyChat";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strategy-lab`;

interface UseStrategyLabChatOptions {
  mode: string;
  selectedPlaybookId: string;
  extraBody?: Record<string, unknown>;
  onContentComplete?: (content: string) => void;
  onPlaybookUpdated?: () => void;
}

export function useStrategyLabChat({
  mode,
  selectedPlaybookId,
  extraBody,
  onContentComplete,
  onPlaybookUpdated,
}: UseStrategyLabChatOptions) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleAbort = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const resetMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const handleSend = useCallback(
    async (input: string) => {
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
            mode,
            ...extraBody,
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
            } catch {
              /* ignore */
            }
          }
        }

        if (
          assistantContent.includes("[PLAYBOOK_UPDATED]") ||
          assistantContent.includes("[TOOL_RESULT:")
        ) {
          onPlaybookUpdated?.();
        }

        setMessages([...newMessages, { role: "assistant", content: assistantContent }]);
        onContentComplete?.(assistantContent);
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        const msg = e instanceof Error ? e.message : "Unknown error";
        toast({ title: "Error", description: msg, variant: "destructive" });
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [messages, isStreaming, selectedPlaybookId, mode, extraBody, onContentComplete, onPlaybookUpdated, toast]
  );

  return {
    messages,
    setMessages,
    isStreaming,
    handleSend,
    handleAbort,
    resetMessages,
  };
}
