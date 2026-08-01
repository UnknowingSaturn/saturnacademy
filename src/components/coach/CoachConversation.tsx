import * as React from "react";
import { ChevronDown, Wrench, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { CoachMessage } from "@/types/coach";
import { CoachMark } from "./CoachMark";
import { CoachEmptyState } from "./CoachEmptyState";
import { AssistantBody } from "./CoachMarkdown";

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

const UUID_SPLIT = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const UUID_TEST = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(d)) return "";
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function ToolCallStrip({ tools }: { tools: CoachMessage["tool_calls"] }) {
  if (!tools || tools.length === 0) return null;
  const failed = tools.filter((t) => !t.ok).length;
  const names = Array.from(new Set(tools.map((t) => t.name))).slice(0, 3).join(", ");
  return (
    <Collapsible>
      <CollapsibleTrigger className="mt-2.5 inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition group">
        {failed > 0 ? (
          <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
        ) : (
          <Check className="w-3.5 h-3.5 text-profit" />
        )}
        <span>
          {tools.length} tool call{tools.length > 1 ? "s" : ""}
          {failed > 0 ? ` · ${failed} failed` : ""}
        </span>
        <span className="hidden sm:inline font-mono text-[10px] text-muted-foreground/70 truncate max-w-[180px]">{names}</span>
        <ChevronDown className="w-3 h-3 transition group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 space-y-1 rounded-md border border-border/60 bg-muted/40 p-2 text-[11px] font-mono">
          {tools.map((tc, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={cn("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0", tc.ok ? "bg-profit" : "bg-destructive")} />
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
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {m.attachments.map((a, i) =>
                        a.signed_url ? (
                          <a key={i} href={a.signed_url} target="_blank" rel="noreferrer" className="group">
                            <img
                              src={a.signed_url}
                              alt=""
                              className="h-20 w-28 rounded-lg border border-border object-cover transition-transform group-hover:scale-[1.03]"
                            />
                          </a>
                        ) : null,
                      )}
                    </div>
                  )}
                  {body.trim() && (
                    <div className="rounded-2xl rounded-tr-md bg-primary text-primary-foreground px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                      {body.split(UUID_SPLIT).map((seg, i) =>
                        UUID_TEST.test(seg) ? (
                          <span key={i} className="font-mono text-xs bg-primary-foreground/15 px-1 rounded">
                            {seg.slice(0, 8)}…
                          </span>
                        ) : (
                          <React.Fragment key={i}>{seg}</React.Fragment>
                        ),
                      )}
                    </div>
                  )}
                  <span className="text-[10px] text-muted-foreground/70 px-1">{relTime(m.created_at)}</span>
                </div>
              </div>
            );
          }

          // Assistant — no bubble, text on surface.
          return (
            <div key={m.id} className="flex gap-3">
              <CoachMark size={28} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <AssistantBody text={body || " "} />
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
