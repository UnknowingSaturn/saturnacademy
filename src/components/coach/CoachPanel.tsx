import * as React from "react";
import { useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PanelLeftClose, PanelLeftOpen, ExternalLink, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCoachPanel } from "@/contexts/CoachContext";
import { useCoachMessages, useCoachThreads, useCreateCoachThread, useSendCoachMessage } from "@/hooks/useCoach";
import { CoachConversation } from "./CoachConversation";
import { CoachThreadList } from "./CoachThreadList";
import { CoachComposer } from "./CoachComposer";
import { Badge } from "@/components/ui/badge";

export function CoachPanel() {
  const { open, closeCoach, activeThreadId, setActiveThreadId, attached, clearAttached } = useCoachPanel();
  const [showSidebar, setShowSidebar] = React.useState(true);
  const navigate = useNavigate();

  const { data: threads = [] } = useCoachThreads();
  const { data: messages = [], isFetching } = useCoachMessages(activeThreadId);
  const createThread = useCreateCoachThread();
  const send = useSendCoachMessage();

  // On first open with no active thread, pick most recent (or create empty later on send).
  useEffect(() => {
    if (open && !activeThreadId && threads.length > 0) {
      setActiveThreadId(threads[0].id);
    }
  }, [open, activeThreadId, threads, setActiveThreadId]);

  const handleNewThread = async () => {
    const t = await createThread.mutateAsync({
      title: "New conversation",
      context_trade_id: attached?.trade_id,
      context_route: attached?.route,
    });
    setActiveThreadId(t.id);
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
    // Compose message text with attached context prefix so the model sees it.
    let composed = text;
    if (attached?.trade_id) {
      composed = `[Context: trade ${attached.trade_id}${attached.label ? ` — ${attached.label}` : ""}]\n\n${composed}`;
    }
    await send.mutateAsync({ thread_id: tid, text: composed, attachments: atts });
  };

  return (
    <Sheet open={open} onOpenChange={(v) => (v ? null : closeCoach())}>
      <SheetContent
        side="right"
        className="p-0 w-full sm:max-w-[720px] flex flex-col gap-0"
      >
        <SheetHeader className="px-3 py-2 border-b border-border flex-row items-center gap-2 space-y-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setShowSidebar((s) => !s)}
            aria-label={showSidebar ? "Hide history" : "Show history"}
          >
            {showSidebar ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
          </Button>
          <SheetTitle className="flex-1 text-sm truncate text-left">
            {threads.find((t) => t.id === activeThreadId)?.title ?? "Trading Coach"}
          </SheetTitle>
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
        </SheetHeader>

        {attached && (
          <div className="px-3 py-1.5 border-b border-border flex items-center gap-2 bg-muted/40">
            <Badge variant="secondary" className="text-[10px]">Attached</Badge>
            <span className="text-xs truncate flex-1">{attached.label ?? attached.trade_id ?? attached.route}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={clearAttached} aria-label="Clear context">
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}

        <div className="flex-1 flex min-h-0">
          {showSidebar && (
            <div className="w-56 border-r border-border shrink-0">
              <CoachThreadList
                threads={threads}
                activeId={activeThreadId}
                onSelect={(id) => setActiveThreadId(id)}
                onNew={handleNewThread}
                compact
              />
            </div>
          )}
          <div className="flex-1 flex flex-col min-w-0">
            <CoachConversation messages={messages} streaming={send.isPending || (isFetching && messages.length === 0)} />
            <CoachComposer
              threadId={activeThreadId ?? "pending"}
              disabled={send.isPending}
              onSend={handleSend}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
