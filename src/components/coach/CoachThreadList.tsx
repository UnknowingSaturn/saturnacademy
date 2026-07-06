import * as React from "react";
import { useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { CoachThread } from "@/types/coach";
import { useDeleteCoachThread, useRenameCoachThread } from "@/hooks/useCoach";
import { formatDistanceToNow } from "date-fns";

interface Props {
  threads: CoachThread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  showSearch?: boolean;
}

export function CoachThreadList({ threads, activeId, onSelect, onNew, showSearch = true }: Props) {
  const rename = useRenameCoachThread();
  const del = useDeleteCoachThread();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => t.title.toLowerCase().includes(q));
  }, [threads, query]);

  const commitRename = async (id: string) => {
    const next = draft.trim();
    setEditingId(null);
    if (!next) return;
    await rename.mutateAsync({ id, title: next });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-2 space-y-2 border-b border-border">
        <Button size="sm" className="w-full justify-start gap-2" onClick={onNew}>
          <Plus className="w-4 h-4" /> New conversation
        </Button>
        {showSearch && threads.length > 4 && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="h-8 pl-8 text-xs"
            />
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {filtered.length === 0 && (
          <div className="text-xs text-muted-foreground p-6 text-center">
            {query ? "No matches." : "No conversations yet."}
          </div>
        )}
        {filtered.map((t) => {
          const active = t.id === activeId;
          const isEditing = editingId === t.id;
          return (
            <div
              key={t.id}
              className={cn(
                "group relative rounded-lg px-2.5 py-2 hover:bg-accent/60 transition",
                active && "bg-accent",
              )}
            >
              {isEditing ? (
                <Input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(t.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="h-7 text-sm"
                />
              ) : (
                <div className="flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => onSelect(t.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="text-sm truncate font-medium text-foreground/90">{t.title}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {t.last_message_at
                        ? `${formatDistanceToNow(new Date(t.last_message_at))} ago`
                        : "empty"}
                      {t.message_count > 0 && ` · ${t.message_count} msg`}
                    </div>
                  </button>
                  <div className="flex opacity-0 group-hover:opacity-100 transition shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => { setEditingId(t.id); setDraft(t.title); }}
                      aria-label="Rename thread"
                    >
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Delete thread">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
                          <AlertDialogDescription>
                            "{t.title}" and its messages will be permanently removed.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => del.mutate(t.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
