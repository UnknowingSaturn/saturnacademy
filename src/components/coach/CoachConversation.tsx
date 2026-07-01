import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sparkles, User, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CoachMessage } from "@/types/coach";

interface Props {
  messages: CoachMessage[];
  streaming?: boolean;
}

/** Extract plain text from the polymorphic `parts` column. */
function toText(m: CoachMessage): string {
  const p: any = m.parts;
  if (typeof p === "string") return p;
  if (Array.isArray(p)) {
    return p.map((seg) => (typeof seg === "string" ? seg : seg?.text ?? "")).join("");
  }
  if (p && typeof p === "object" && typeof p.text === "string") return p.text;
  return "";
}

export function CoachConversation({ messages, streaming }: Props) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streaming]);

  if (messages.length === 0 && !streaming) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 text-muted-foreground">
        <Sparkles className="w-8 h-8 mb-2 text-primary" />
        <h3 className="text-base font-semibold text-foreground">How can I help?</h3>
        <p className="text-sm max-w-sm mt-1">
          Ask about your trades, upload a chart screenshot for review, or say
          "what went wrong on GBPUSD this week?"
        </p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      {messages.map((m) => {
        if (m.role === "tool" || m.role === "system") return null;
        const isUser = m.role === "user";
        const text = toText(m);
        return (
          <div key={m.id} className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}>
            {!isUser && (
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
            )}
            <div className={cn(
              "max-w-[85%] rounded-lg px-3 py-2 text-sm",
              isUser ? "bg-primary text-primary-foreground" : "bg-muted",
            )}>
              {m.attachments && m.attachments.length > 0 && (
                <div className="mb-2 grid grid-cols-2 gap-1">
                  {m.attachments.map((a, i) =>
                    a.signed_url ? (
                      <img
                        key={i}
                        src={a.signed_url}
                        alt="Attachment"
                        className="rounded border border-border max-h-40 object-cover"
                      />
                    ) : null,
                  )}
                </div>
              )}
              <div className={cn(
                "prose prose-sm dark:prose-invert max-w-none",
                isUser && "prose-invert",
              )}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{text || " "}</ReactMarkdown>
              </div>
              {m.tool_calls && m.tool_calls.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50 text-[10px] text-muted-foreground flex flex-wrap gap-1">
                  {m.tool_calls.map((tc, i) => (
                    <span key={i} className="inline-flex items-center gap-0.5">
                      <Wrench className="w-2.5 h-2.5" /> {tc.name}{!tc.ok && " ✕"}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {isUser && (
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User className="w-4 h-4" />
              </div>
            )}
          </div>
        );
      })}
      {streaming && (
        <div className="flex gap-2 justify-start">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary animate-pulse" />
          </div>
          <div className="bg-muted rounded-lg px-3 py-2 text-sm text-muted-foreground">
            Thinking…
          </div>
        </div>
      )}
    </div>
  );
}
