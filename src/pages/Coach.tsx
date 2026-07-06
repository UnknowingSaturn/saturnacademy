import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { History, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useCoachPanel } from "@/contexts/CoachContext";
import { useCoachMessages, useCoachThreads, useCreateCoachThread, useSendCoachMessage } from "@/hooks/useCoach";
import { CoachThreadList } from "@/components/coach/CoachThreadList";
import { CoachConversation } from "@/components/coach/CoachConversation";
import { CoachComposer, type CoachComposerHandle } from "@/components/coach/CoachComposer";
import { CoachMark } from "@/components/coach/CoachMark";

/**
 * Full-page coach view. Desktop: collapsible left history rail. Mobile: history in a drawer.
 * URL-syncs ?t=<threadId> for shareable links between tabs.
 */
export default function CoachPage() {
  const [params, setParams] = useSearchParams();
  const urlThread = params.get("t");
  const { activeThreadId, setActiveThreadId, attached, clearAttached } = useCoachPanel();
  const { data: threads = [] } = useCoachThreads();
  const { data: messages = [], isFetching } = useCoachMessages(activeThreadId);
  const createThread = useCreateCoachThread();
  const send = useSendCoachMessage();

  const composerRef = useRef<CoachComposerHandle>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);

  useEffect(() => {
    if (urlThread && urlThread !== activeThreadId) setActiveThreadId(urlThread);
    else if (!urlThread && !activeThreadId && threads.length > 0) setActiveThreadId(threads[0].id);
  }, [urlThread, activeThreadId, threads, setActiveThreadId]);

  useEffect(() => {
    if (activeThreadId && params.get("t") !== activeThreadId) {
      setParams({ t: activeThreadId }, { replace: true });
    }
  }, [activeThreadId, params, setParams]);

  const handleNewThread = async () => {
    const t = await createThread.mutateAsync({});
    setActiveThreadId(t.id);
    setHistoryOpen(false);
  };

  const handleSend = async (text: string, atts: { storage_path: string }[]) => {
    let tid = activeThreadId;
    if (!tid) {
      const t = await createThread.mutateAsync({ title: text.slice(0, 60) || "New conversation" });
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

  const currentTitle = threads.find((t) => t.id === activeThreadId)?.title ?? "Trading Coach";

  const historyPanel = (
    <CoachThreadList
      threads={threads}
      activeId={activeThreadId}
      onSelect={(id) => { setActiveThreadId(id); setHistoryOpen(false); setRailOpen(false); }}
      onNew={handleNewThread}
    />
  );

  return (
    <div className="h-[calc(100vh-4rem)] flex bg-background overflow-hidden">
      {/* Desktop rail — collapsed by default so chat stays centered; opens on hover/click */}
      <aside
        className={`hidden md:flex shrink-0 border-r border-border transition-[width] duration-200 ${railOpen ? "w-72" : "w-14"}`}
        onMouseEnter={() => setRailOpen(true)}
        onMouseLeave={() => setRailOpen(false)}
      >
        {railOpen ? (
          <div className="w-full">{historyPanel}</div>
        ) : (
          <div className="w-full flex flex-col items-center py-3 gap-2">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleNewThread} title="New conversation">
              <Plus className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setRailOpen(true)} title="History">
              <History className="w-4 h-4" />
            </Button>
          </div>
        )}
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" aria-label="History">
                <History className="w-4 h-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72">{historyPanel}</SheetContent>
          </Sheet>

          <CoachMark size={26} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{currentTitle}</div>
            <div className="text-[10px] text-muted-foreground -mt-0.5">Trading Coach · cites your journal</div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleNewThread} className="gap-1.5 hidden sm:inline-flex">
            <Plus className="w-3.5 h-3.5" /> New
          </Button>
        </header>

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
    </div>
  );
}
