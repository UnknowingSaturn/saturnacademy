import * as React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Sparkles, Square, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CodeViewer } from "./CodeViewer";
import { AppliedChangeCard, parseToolResults } from "./AppliedChangeCard";
import { ReportUpload } from "./ReportUpload";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface QuickAction {
  category: string;
  label: string;
  message: string;
}

interface StrategyChatProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSend: (message: string) => void;
  onAbort?: () => void;
  onBacktestMetrics?: (metrics: string) => void;
  playbookName?: string;
  hasPlaybook: boolean;
  hasTradeData: boolean;
}

function getQuickActions(hasPlaybook: boolean, hasTradeData: boolean): QuickAction[] {
  if (!hasPlaybook) {
    return [
      { category: "Theory", label: "Teach me AMT and how to apply volume profile to entries", message: "Explain how I can use volume profile and auction market theory to find high-probability trade entries. Include practical examples with value areas, POC, and day types." },
      { category: "Design", label: "Help me design a new AMT-based strategy", message: "Help me design a new trading strategy based on auction market theory. Walk me through choosing day types, entry zones, confirmation rules, and management approach." },
      { category: "Edge Audit", label: "Run a scalp edge report on my trades", message: "Run a scalp edge report on my last 6 months of trades. Highlight the top GO setups, the worst SKIP cells, and the suggested next tag to focus on." },
      { category: "Performance", label: "Analyze my recent trading performance", message: "Analyze my recent trading performance across all playbooks. What patterns do you see? Where am I losing edge?" },
    ];
  }
  if (!hasTradeData) {
    return [
      { category: "Gaps", label: "Find gaps and missing rules in my playbook", message: "Analyze my playbook for gaps and missing rules. Check if every entry rule has a confirmation, every confirmation has an invalidation, if failure modes are comprehensive, if risk limits are set, and if checklist questions cover all categories." },
      { category: "Execution", label: "Generate a complete MQL5 EA for this playbook", message: "Generate a complete MQL5 Expert Advisor based on my selected playbook. Include session volume profile calculation, entry/exit logic matching my rules, and proper risk management." },
      { category: "Refine", label: "Suggest missing rules I should add", message: "Review my playbook and suggest missing rules I should add. Check for gaps in confirmation logic, invalidation criteria, trade management, and failure modes based on AMT best practices." },
      { category: "Strategy", label: "Refine my entry and management rules", message: "Review my playbook rules and suggest improvements based on auction market theory. Focus on making entry criteria more precise and management rules more robust." },
    ];
  }
  return [
    { category: "Performance", label: "Analyze wins vs losses in this playbook", message: "Analyze my recent trading performance for this playbook. What patterns do you see in my wins vs losses? Where am I losing edge? What AMT concepts explain my results?" },
    { category: "Edge Audit", label: "Run a scalp edge report on this playbook", message: "Run a scalp edge report scoped to this playbook. Show the top GO context cells, the worst SKIP cells, and the suggested next tag to focus on." },
    { category: "Execution", label: "Generate a complete MQL5 EA from this playbook", message: "Generate a complete MQL5 Expert Advisor based on my selected playbook. Include session volume profile calculation, entry/exit logic matching my rules, and proper risk management." },
    { category: "Gaps", label: "Cross-check failure modes vs journal mistakes", message: "Analyze my playbook for gaps. Cross-reference my failure modes with actual journal mistakes. Check if my rules are complete and suggest fixes. Apply them if I approve." },
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
          <div
            key={i}
            className={cn(
              "prose prose-sm dark:prose-invert max-w-none text-foreground/90 leading-relaxed",
              "prose-p:my-3 prose-p:leading-[1.7]",
              "prose-h1:font-serif prose-h1:text-2xl prose-h1:mt-6 prose-h1:mb-2 prose-h1:tracking-tight",
              "prose-h2:font-serif prose-h2:text-xl prose-h2:mt-6 prose-h2:mb-2 prose-h2:tracking-tight",
              "prose-h3:text-[11px] prose-h3:font-bold prose-h3:uppercase prose-h3:tracking-[0.2em] prose-h3:text-primary prose-h3:mt-5 prose-h3:mb-1",
              "prose-h4:text-sm prose-h4:font-semibold prose-h4:text-foreground prose-h4:mt-4 prose-h4:mb-1",
              "prose-strong:text-foreground prose-strong:font-semibold",
              "prose-em:text-foreground/80",
              "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
              "prose-ul:my-3 prose-ol:my-3 prose-li:my-1.5 prose-li:leading-[1.65] marker:text-primary/60",
              "prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-mono prose-code:text-foreground prose-code:before:content-[''] prose-code:after:content-['']",
              "prose-blockquote:border-l-2 prose-blockquote:border-primary/40 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-foreground/80 prose-blockquote:not-italic",
              "prose-hr:my-6 prose-hr:border-border/60",
              "prose-table:text-xs prose-th:font-semibold prose-th:bg-muted/30 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-td:px-3 prose-td:py-2 prose-tr:border-b prose-tr:border-border/50",
              "prose-pre:bg-black/40 prose-pre:border prose-pre:border-border"
            )}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{part}</ReactMarkdown>
          </div>
        );
      })}
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex gap-4">
      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
        <Layers className="h-4 w-4 text-foreground" />
      </div>
      <div className="flex items-center gap-2 pt-2 text-xs font-medium uppercase tracking-widest">
        <span className="animate-pulse text-primary">Analyzing</span>
        <span className="flex gap-1">
          <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0s" }} />
          <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0.2s" }} />
          <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0.4s" }} />
        </span>
      </div>
    </div>
  );
}

export function StrategyChat({ messages, isStreaming, onSend, onAbort, onBacktestMetrics, playbookName, hasPlaybook, hasTradeData }: StrategyChatProps) {
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
  const lastIsAssistant = messages[messages.length - 1]?.role === "assistant";
  const showThinking = isStreaming && (!lastIsAssistant || !messages[messages.length - 1]?.content?.trim());

  return (
    <div className="flex flex-col h-full bg-background">
      <ScrollArea ref={scrollRef} className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {showQuickActions ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-6">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-[0_0_30px_-5px_hsl(var(--primary)/0.3)]">
                <Sparkles className="h-7 w-7 text-primary" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">Strategy Lab Intelligence</h2>
                <p className="text-muted-foreground max-w-sm mx-auto">
                  {playbookName
                    ? `Working with "${playbookName}". Refine rules, audit edge, or generate an EA.`
                    : "Analyze market structures, audit your scalp edge, or generate trade execution scripts."}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg mt-2">
                {quickActions.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => onSend(action.message)}
                    className="p-4 rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-accent transition-all text-left"
                  >
                    <p className="text-[10px] font-semibold text-primary mb-1 uppercase tracking-wider">
                      {action.category}
                    </p>
                    <p className="text-sm text-foreground leading-snug">{action.label}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {messages.map((msg, i) => (
                <div key={i}>
                  {msg.role === "user" ? (
                    <div className="flex justify-end">
                      <div className="max-w-[80%] bg-primary/5 border border-primary/20 rounded-2xl rounded-tr-none px-4 py-3">
                        <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                          {msg.content}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <Layers className="h-4 w-4 text-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="rounded-xl border border-border/60 bg-card/40 backdrop-blur px-5 py-4 shadow-sm">
                          <MessageContent content={msg.content} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {showThinking && <ThinkingDots />}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="px-6 pb-6 pt-2">
        <div className="max-w-3xl mx-auto">
          <div
            className={cn(
              "relative flex flex-col bg-muted/40 border border-border rounded-2xl transition-all shadow-lg",
              "focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50"
            )}
          >
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Strategy Lab..."
              className="w-full bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 text-sm p-4 min-h-[88px] resize-none text-foreground placeholder:text-muted-foreground shadow-none"
              rows={1}
            />
            <div className="flex items-center justify-between p-2 border-t border-border/50 bg-background/40 rounded-b-2xl">
              <div className="flex items-center gap-1">
                {onBacktestMetrics && (
                  <ReportUpload onMetricsParsed={onBacktestMetrics} disabled={isStreaming} />
                )}
              </div>
              <div className="flex items-center gap-2">
                {isStreaming ? (
                  <Button
                    onClick={onAbort}
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-[10px] font-bold uppercase tracking-widest border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Square className="h-3 w-3 mr-1.5" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    onClick={handleSend}
                    disabled={!input.trim()}
                    size="sm"
                    className="h-8 px-3 gap-1.5 bg-primary text-primary-foreground hover:opacity-90 shadow-[0_0_15px_-3px_hsl(var(--primary))]"
                  >
                    <span className="text-[11px] font-bold uppercase tracking-wider">Send</span>
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
          <p className="mt-3 text-[10px] text-center text-muted-foreground uppercase tracking-widest">
            Enter to send · Shift + Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
