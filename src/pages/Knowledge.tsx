import { useState, useEffect, useRef } from "react";
import { useKnowledgeEntries, useKnowledgeEntry, useCreateKnowledgeEntry, useDeleteKnowledgeEntry, useReExtract, useKnowledgeChatHistory, useSendKnowledgeMessage } from "@/hooks/useKnowledge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Loader2, RefreshCw, Trash2, ExternalLink, Send, Brain, AlertCircle, Sparkles } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import type { KnowledgeEntry } from "@/types/knowledge";

export default function Knowledge() {
  const { data: entries = [], isLoading } = useKnowledgeEntries();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  const create = useCreateKnowledgeEntry();
  const del = useDeleteKnowledgeEntry();
  const reExtract = useReExtract();

  // Auto-select first entry
  useEffect(() => {
    if (!selectedId && entries.length > 0) setSelectedId(entries[0].id);
  }, [entries, selectedId]);

  const { data: selected } = useKnowledgeEntry(selectedId);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    try {
      const created = await create.mutateAsync(url.trim());
      setSelectedId(created.id);
      setUrl("");
    } catch {/* toast handled */}
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this entry?")) return;
    await del.mutateAsync(id);
    if (selectedId === id) setSelectedId(null);
  };

  return (
    <div className="h-[calc(100vh-3.5rem)] flex">
      {/* List */}
      <aside className="w-80 border-r border-border flex flex-col bg-card/30">
        <div className="p-4 border-b border-border">
          <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
            <Brain className="w-4 h-4" /> Knowledge
          </h2>
          <form onSubmit={handleAdd} className="flex gap-1.5">
            <Input
              type="url"
              placeholder="Paste article URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="text-sm h-9"
              disabled={create.isPending}
            />
            <Button type="submit" size="sm" disabled={create.isPending || !url.trim()}>
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </Button>
          </form>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
            {!isLoading && entries.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No entries yet. Paste a URL above to extract trading knowledge.
              </div>
            )}
            {entries.map((e) => (
              <button
                key={e.id}
                onClick={() => setSelectedId(e.id)}
                className={`w-full text-left p-2.5 rounded-md transition-colors ${
                  selectedId === e.id ? "bg-accent" : "hover:bg-accent/50"
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {e.source_title || e.source_url}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {e.status === "extracting" && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 gap-1">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" /> Extracting
                        </Badge>
                      )}
                      {e.status === "failed" && (
                        <Badge variant="destructive" className="text-[10px] h-4 px-1.5">Failed</Badge>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {format(parseISO(e.created_at), "MMM d")}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </aside>

      {/* Detail */}
      <main className="flex-1 overflow-hidden">
        {!selected ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Select an entry to view
          </div>
        ) : (
          <KnowledgeDetail
            entry={selected}
            onDelete={() => handleDelete(selected.id)}
            onReExtract={() => reExtract.mutate(selected.id)}
            reExtracting={reExtract.isPending}
          />
        )}
      </main>
    </div>
  );
}

function KnowledgeDetail({
  entry,
  onDelete,
  onReExtract,
  reExtracting,
}: {
  entry: KnowledgeEntry;
  onDelete: () => void;
  onReExtract: () => void;
  reExtracting: boolean;
}) {
  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight truncate">
            {entry.source_title || entry.source_url}
          </h1>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {entry.source_author && <span>{entry.source_author}</span>}
            {entry.source_published_at && (
              <span>· {format(parseISO(entry.source_published_at), "MMM d, yyyy")}</span>
            )}
            <a
              href={entry.source_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 hover:text-foreground"
            >
              Original <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="ghost" size="sm" onClick={onReExtract} disabled={reExtracting}>
            <RefreshCw className={`w-4 h-4 ${reExtracting ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {entry.status === "extracting" && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            <p className="text-sm">Extracting knowledge from this article…</p>
          </div>
        </div>
      )}

      {entry.status === "failed" && (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-md text-center">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive" />
            <p className="text-sm font-medium">Extraction failed</p>
            <p className="text-xs text-muted-foreground mt-1">{entry.error_message}</p>
            <Button size="sm" className="mt-3" onClick={onReExtract}>Retry</Button>
          </div>
        </div>
      )}

      {entry.status === "ready" && (
        <Tabs defaultValue="summary" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-6 mt-3 self-start">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="screenshots">Screenshots ({entry.screenshots?.length || 0})</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="flex-1 overflow-hidden mt-0">
            <ScrollArea className="h-full">
              <div className="px-6 py-4 max-w-3xl space-y-6">
                {entry.summary && (
                  <section>
                    <h3 className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-2">Summary</h3>
                    <p className="text-sm leading-relaxed">{entry.summary}</p>
                  </section>
                )}

                {entry.key_takeaways?.length > 0 && (
                  <section>
                    <h3 className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-2">Key Takeaways</h3>
                    <ul className="space-y-1.5">
                      {entry.key_takeaways.map((t, i) => (
                        <li key={i} className="text-sm leading-relaxed flex gap-2">
                          <span className="text-primary mt-0.5">•</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {entry.concepts?.length > 0 && (
                  <section>
                    <h3 className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-2">Concepts</h3>
                    <div className="space-y-3">
                      {entry.concepts.map((c, i) => (
                        <Card key={i} className="p-3">
                          <div className="text-sm font-semibold">{c.label}</div>
                          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{c.definition}</p>
                        </Card>
                      ))}
                    </div>
                  </section>
                )}

                {entry.tags?.length > 0 && (
                  <section>
                    <h3 className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-2">Tags</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {entry.tags.map((t) => (
                        <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="screenshots" className="flex-1 overflow-hidden mt-0">
            <ScrollArea className="h-full">
              <div className="px-6 py-4 max-w-3xl space-y-4">
                {entry.screenshots?.length === 0 && (
                  <p className="text-sm text-muted-foreground">No images found in this article.</p>
                )}
                {entry.screenshots?.map((s, i) => (
                  <figure key={i} className="space-y-2">
                    <img src={s.url} alt={s.caption} className="w-full rounded-md border border-border" loading="lazy" />
                    {s.caption && <figcaption className="text-xs text-muted-foreground">{s.caption}</figcaption>}
                  </figure>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="chat" className="flex-1 overflow-hidden mt-0">
            <KnowledgeChat entryId={entry.id} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function KnowledgeChat({ entryId }: { entryId: string }) {
  const { data: history = [] } = useKnowledgeChatHistory(entryId);
  const send = useSendKnowledgeMessage();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [history.length, send.isPending]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || send.isPending) return;
    const text = input.trim();
    setInput("");
    try {
      await send.mutateAsync({
        entry_id: entryId,
        messages: [...history.map(m => ({ role: m.role, content: m.content })), { role: "user", content: text }],
      });
    } catch {/* toasted */}
  };

  return (
    <div className="h-full flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="px-6 py-4 max-w-3xl space-y-4">
          {history.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-8">
              Ask anything about this article. The AI will answer based only on its content.
            </div>
          )}
          {history.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-line ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {send.isPending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-3 py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            </div>
          )}
        </div>
      </div>
      <form onSubmit={handleSend} className="border-t border-border p-4 flex gap-2">
        <Input
          placeholder="Ask about this article…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={send.isPending}
        />
        <Button type="submit" disabled={send.isPending || !input.trim()}>
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}
