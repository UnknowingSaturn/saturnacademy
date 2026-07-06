import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, Wrench, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { CoachMessage } from "@/types/coach";
import { CoachMark } from "./CoachMark";
import { CoachEmptyState } from "./CoachEmptyState";

interface Props {
  messages: CoachMessage[];
  streaming?: boolean;
  onSuggestion?: (prompt: string) => void;
}

function toText(m: CoachMessage): string {
  const p: any = m.parts;
  if (typeof p === "string") return p;
  if (Array.isArray(p)) return p.map((seg) => (typeof seg === "string" ? seg : seg?.text ?? "")).join("");
  if (p && typeof p === "object" && typeof p.text === "string") return p.text;
  return "";
}

/** Strip the [Context: ...] prefix we add server-side so the UI stays clean. */
function stripContextPrefix(text: string): { context: string | null; body: string } {
  const m = text.match(/^\[Context:[^\]]+\]\n\n?/);
  if (!m) return { context: null, body: text };
  return { context: m[0].replace(/^\[Context:\s*/, "").replace(/\]\n\n?$/, ""), body: text.slice(m[0].length) };
}

function ToolCallStrip({ tools }: { tools: CoachMessage["tool_calls"] }) {
  if (!tools || tools.length === 0) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition group">
        <Wrench className="w-3 h-3" />
        <span>{tools.length} tool call{tools.length > 1 ? "s" : ""}</span>
        <ChevronDown className="w-3 h-3 transition group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 space-y-1 rounded-md border border-border/60 bg-muted/40 p-2 text-[11px] font-mono">
          {tools.map((tc, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={cn("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0", tc.ok ? "bg-[hsl(var(--profit))]" : "bg-destructive")} />
              <div className="min-w-0 flex-1">
                <div className="text-foreground/90">{tc.name}</div>
                {tc.error && <div className="text-destructive truncate">{tc.error}</div>}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CoachConversation({ messages, streaming, onSuggestion }: Props) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streaming]);

  if (messages.length === 0 && !streaming) {
    return <CoachEmptyState onPick={(p) => onSuggestion?.(p)} />;
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {messages.map((m) => {
          if (m.role === "tool" || m.role === "system") return null;
          const isUser = m.role === "user";
          const raw = toText(m);
          const { context, body } = isUser ? stripContextPrefix(raw) : { context: null, body: raw };

          if (isUser) {
            return (
              <div key={m.id} className="flex gap-3 justify-end">
                <div className="max-w-[85%] flex flex-col items-end gap-1.5">
                  {context && (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 py-0.5 rounded bg-muted/60">
                      {context}
                    </span>
                  )}
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="grid grid-cols-2 gap-1.5">
                      {m.attachments.map((a, i) =>
                        a.signed_url ? (
                          <a key={i} href={a.signed_url} target="_blank" rel="noreferrer">
                            <img src={a.signed_url} alt="" className="rounded-lg border border-border max-h-48 object-cover" />
                          </a>
                        ) : null,
                      )}
                    </div>
                  )}
                  {body.trim() && (
                    <div className="rounded-2xl rounded-tr-md bg-primary text-primary-foreground px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                      {body}
                    </div>
                  )}
                </div>
                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              </div>
            );
          }

          // Assistant — no bubble, text on surface.
          return (
            <div key={m.id} className="flex gap-3">
              <CoachMark size={28} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-pre:my-2 prose-headings:mt-3 prose-headings:mb-2">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{body || " "}</ReactMarkdown>
                </div>
                <ToolCallStrip tools={m.tool_calls} />
              </div>
            </div>
          );
        })}

        {streaming && (
          <div className="flex gap-3">
            <CoachMark size={28} className="mt-0.5 animate-pulse" />
            <div className="flex items-center gap-1.5 h-7">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
