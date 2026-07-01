import * as React from "react";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useCoachPanel } from "@/contexts/CoachContext";
import { useCoachMessages, useCoachThreads, useCreateCoachThread, useSendCoachMessage } from "@/hooks/useCoach";
import { CoachThreadList } from "@/components/coach/CoachThreadList";
import { CoachConversation } from "@/components/coach/CoachConversation";
import { CoachComposer } from "@/components/coach/CoachComposer";

/**
 * Dedicated full-page coach view (/coach). Uses ?t=<threadId> in the URL so
 * conversations are shareable between browser tabs. Mirrors the panel state
 * so the FAB and page stay in sync.
 */
export default function CoachPage() {
  const [params, setParams] = useSearchParams();
  const urlThread = params.get("t");
  const { activeThreadId, setActiveThreadId } = useCoachPanel();
  const { data: threads = [] } = useCoachThreads();
  const { data: messages = [], isFetching } = useCoachMessages(activeThreadId);
  const createThread = useCreateCoachThread();
  const send = useSendCoachMessage();

  // Hydrate active thread from URL, or pick most recent.
  useEffect(() => {
    if (urlThread && urlThread !== activeThreadId) setActiveThreadId(urlThread);
    else if (!urlThread && !activeThreadId && threads.length > 0) {
      setActiveThreadId(threads[0].id);
    }
  }, [urlThread, activeThreadId, threads, setActiveThreadId]);

  // Reflect active thread to URL.
  useEffect(() => {
    if (activeThreadId && params.get("t") !== activeThreadId) {
      setParams({ t: activeThreadId }, { replace: true });
    }
  }, [activeThreadId, params, setParams]);

  const handleNewThread = async () => {
    const t = await createThread.mutateAsync({});
    setActiveThreadId(t.id);
  };

  const handleSend = async (text: string, atts: { storage_path: string }[]) => {
    let tid = activeThreadId;
    if (!tid) {
      const t = await createThread.mutateAsync({ title: text.slice(0, 60) || "New conversation" });
      tid = t.id;
      setActiveThreadId(tid);
    }
    await send.mutateAsync({ thread_id: tid, text, attachments: atts });
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex border border-border rounded-lg overflow-hidden bg-background">
      <div className="w-64 border-r border-border shrink-0">
        <CoachThreadList
          threads={threads}
          activeId={activeThreadId}
          onSelect={(id) => setActiveThreadId(id)}
          onNew={handleNewThread}
        />
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-2 border-b border-border text-sm font-medium truncate">
          {threads.find((t) => t.id === activeThreadId)?.title ?? "Trading Coach"}
        </div>
        <CoachConversation
          messages={messages}
          streaming={send.isPending || (isFetching && messages.length === 0)}
        />
        <CoachComposer
          threadId={activeThreadId ?? "pending"}
          disabled={send.isPending}
          onSend={handleSend}
        />
      </div>
    </div>
  );
}
