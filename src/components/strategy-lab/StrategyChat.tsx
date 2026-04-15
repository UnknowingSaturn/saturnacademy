import * as React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Loader2, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CodeViewer } from "./CodeViewer";
import { AppliedChangeCard, parseToolResults } from "./AppliedChangeCard";
import { ReportUpload } from "./ReportUpload";
import ReactMarkdown from "react-markdown";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface QuickAction {
  label: string;
  message: string;
}

interface StrategyChatProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSend: (message: string) => void;
  onAbort?: () => void;
  playbookName?: string;
  hasPlaybook: boolean;
  hasTradeData: boolean;
}

function getQuickActions(hasPlaybook: boolean, hasTradeData: boolean): QuickAction[] {
  if (!hasPlaybook) {
    return [
      { label: "Teach AMT", message: "Explain how I can use volume profile and auction market theory to find high-probability trade entries. Include practical examples with value areas, POC, and day types." },
      { label: "Design Strategy", message: "Help me design a new trading strategy based on auction market theory. Walk me through choosing day types, entry zones, confirmation rules, and management approach." },
      { label: "Generate EA", message: "Generate a basic MQL5 Expert Advisor template that uses volume profile for entry decisions. Include session time filters and risk management." },
      { label: "Analyze Performance", message: "Analyze my recent trading performance across all playbooks. What patterns do you see? Where am I losing edge?" },
    ];
  }
  if (!hasTradeData) {
    return [
      { label: "Analyze Gaps", message: "Analyze my playbook for gaps and missing rules. Check if every entry rule has a confirmation, every confirmation has an invalidation, if failure modes are comprehensive, if risk limits are set, and if checklist questions cover all categories." },
      { label: "Generate EA", message: "Generate a complete MQL5 Expert Advisor based on my selected playbook. Include session volume profile calculation, entry/exit logic matching my rules, and proper risk management." },
      { label: "Add Missing Rules", message: "Review my playbook and suggest missing rules I should add. Check for gaps in confirmation logic, invalidation criteria, trade management, and failure modes based on AMT best practices." },
      { label: "Refine Strategy", message: "Review my playbook rules and suggest improvements based on auction market theory. Focus on making entry criteria more precise and management rules more robust." },
    ];
  }
  return [
    { label: "Analyze Performance", message: "Analyze my recent trading performance for this playbook. What patterns do you see in my wins vs losses? Where am I losing edge? What AMT concepts explain my results?" },
    { label: "Refine Based on Results", message: "Based on my actual trade results, suggest specific playbook rule changes. Focus on the sessions and symbols where I'm underperforming. Apply the changes if I agree." },
    { label: "Generate EA", message: "Generate a complete MQL5 Expert Advisor based on my selected playbook. Include session volume profile calculation, entry/exit logic matching my rules, and proper risk management." },
    { label: "Analyze Gaps", message: "Analyze my playbook for gaps. Cross-reference my failure modes with actual journal mistakes. Check if my rules are complete and suggest fixes. Apply them if I approve." },
  ];
}

function MessageContent({ content }: { content: string }) {
  const { text, toolResults } = parseToolResults(content);
  const parts = text.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-3">
      {toolResults.map((result, i) => (
        <AppliedChangeCard key={`tool-${i}`} result={result} />
      ))}
      {parts.map((part, i) => {
        const codeMatch = part.match(/^```(\w+)?\n?([\s\S]*?)```$/);
        if (codeMatch) {
          const lang = codeMatch[1] || "text";
          const code = codeMatch[2].trim();
          return <CodeViewer key={i} code={code} language={lang} filename={lang === "mql5" ? "PlaybookTrader.mq5" : undefined} />;
        }
        if (!part.trim()) return null;
        return (
          <div key={i} className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1">
            <ReactMarkdown>{part}</ReactMarkdown>
          </div>
        );
      })}
    </div>
  );
}

export function StrategyChat({ messages, isStreaming, onSend, onAbort, playbookName, hasPlaybook, hasTradeData }: StrategyChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setInput("");
  }, [input, isStreaming, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const showQuickActions = messages.length === 0;
  const quickActions = getQuickActions(hasPlaybook, hasTradeData);

  return (
    <div className="flex flex-col h-full">
      <ScrollArea ref={scrollRef} className="flex-1 px-4">
        {showQuickActions && (
          <div className="flex flex-col items-center justify-center py-16 gap-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Strategy Lab</h2>
                <p className="text-sm text-muted-foreground">
                  {playbookName
                    ? `Working with "${playbookName}"`
                    : "Select a playbook or start a general AMT discussion"}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 max-w-lg w-full">
              {quickActions.map((action) => (
                <Button
                  key={action.label}
                  variant="outline"
                  className="h-auto py-3 px-4 text-left justify-start"
                  onClick={() => onSend(action.message)}
                >
                  <span className="text-sm">{action.label}</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-6 py-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-lg px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {msg.role === "user" ? (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <MessageContent content={msg.content} />
                )}
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-1">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}
          {isStreaming && messages.length > 0 && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="bg-muted rounded-lg px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-4">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about AMT, refine your strategy, or generate an EA..."
            className="min-h-[44px] max-h-[120px] resize-none"
            rows={1}
          />
          {onBacktestMetrics && (
            <ReportUpload onMetricsParsed={onBacktestMetrics} disabled={isStreaming} />
          )}
          {isStreaming ? (
            <Button
              onClick={onAbort}
              variant="destructive"
              size="icon"
              className="shrink-0 h-[44px] w-[44px]"
              title="Stop generating"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSend}
              disabled={!input.trim()}
              size="icon"
              className="shrink-0 h-[44px] w-[44px]"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
