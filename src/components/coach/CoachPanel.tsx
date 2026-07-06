import * as React from "react";
import { useEffect, useRef } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { History, ExternalLink, X, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCoachPanel } from "@/contexts/CoachContext";
import { useCoachMessages, useCoachThreads, useCreateCoachThread, useSendCoachMessage } from "@/hooks/useCoach";
import { CoachConversation } from "./CoachConversation";
import { CoachThreadList } from "./CoachThreadList";
import { CoachComposer, type CoachComposerHandle } from "./CoachComposer";
import { Badge } from "@/components/ui/badge";
import { CoachMark } from "./CoachMark";

export function CoachPanel() {
  const { open, closeCoach, activeThreadId, setActiveThreadId, attached, clearAttached } = useCoachPanel();
  const navigate = useNavigate();
  const composerRef = useRef<CoachComposerHandle>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  const { data: threads = [] } = useCoachThreads();
  const { data: messages = [], isFetching } = useCoachMessages(activeThreadId);
  const createThread = useCreateCoachThread();
  const send = useSendCoachMessage();

  useEffect(() => {
    if (open && !activeThreadId && threads.length > 0) setActiveThreadId(threads[0].id);
  }, [open, activeThreadId, threads, setActiveThreadId]);

  const currentTitle = threads.find((t) => t.id === activeThreadId)?.title ?? "Trading Coach";

  const handleNewThread = async () => {
    const t = await createThread.mutateAsync({
      title: "New conversation",
      context_trade_id: attached?.trade_id,
      context_route: attached?.route,
    });
    setActiveThreadId(t.id);
    setHistoryOpen(false);
  };

  const handleSend = async (text: string, atts: { storage_path: string }[]) => {
    let tid = activeThreadId;
    if (!tid) {
      const t = await createThread.mutateAsync({
        title: text.slice(0, 60) || "New conversation",
        context_trade_id: attached?.trade_id,
        context_route: attached?.route,
      });
      tid = t.id;
      setActiveThreadId(tid);
    }
    await send.mutateAsync({
      thread_id: tid,
      text,
      attachments: atts,
      context: attached ? { trade_id: attached.trade_id, label: attached.label, route: attached.route } : null,
    });
  };

  return (
    <Sheet open={open} onOpenChange={(v) => (v ? null : closeCoach())}>
      <SheetContent side="right" className="p-0 w-full sm:max-w-[640px] flex flex-col gap-0">
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
          <CoachMark size={24} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{currentTitle}</div>
            <div className="text-[10px] text-muted-foreground -mt-0.5">Trading Coach</div>
          </div>

          <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Conversation history" title="History">
                <History className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" side="bottom" className="w-80 p-0 h-[70vh] max-h-[520px]">
              <CoachThreadList
                threads={threads}
                activeId={activeThreadId}
                onSelect={(id) => { setActiveThreadId(id); setHistoryOpen(false); }}
                onNew={handleNewThread}
              />
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleNewThread}
            aria-label="New conversation"
            title="New conversation"
          >
            <Plus className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => { closeCoach(); navigate("/coach"); }}
            aria-label="Open full page"
            title="Open full page"
          >
            <ExternalLink className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={closeCoach}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col min-h-0">
          <CoachConversation
            messages={messages}
            streaming={send.isPending || (isFetching && messages.length === 0)}
            onSuggestion={(p) => composerRef.current?.setText(p)}
          />
          <CoachComposer
            ref={composerRef}
            threadId={activeThreadId ?? "pending"}
            disabled={send.isPending}
            onSend={handleSend}
            contextChip={
              attached ? (
                <span className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-md bg-primary/10 text-primary text-[11px]">
                  <Badge variant="secondary" className="h-4 px-1 text-[9px] bg-primary/20 text-primary border-0">CONTEXT</Badge>
                  <span className="truncate max-w-[220px]">{attached.label ?? attached.trade_id ?? attached.route}</span>
                  <button onClick={clearAttached} className="hover:bg-primary/15 rounded p-0.5" aria-label="Clear context">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ) : null
            }
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
