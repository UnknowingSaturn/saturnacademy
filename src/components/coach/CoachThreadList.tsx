import * as React from "react";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
  compact?: boolean;
}

export function CoachThreadList({ threads, activeId, onSelect, onNew, compact }: Props) {
  const rename = useRenameCoachThread();
  const del = useDeleteCoachThread();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const commitRename = async (id: string) => {
    const next = draft.trim();
    setEditingId(null);
    if (!next) return;
    await rename.mutateAsync({ id, title: next });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border">
        <Button size="sm" className="w-full justify-start" onClick={onNew}>
          <Plus className="w-4 h-4" /> New conversation
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
        {threads.length === 0 && (
          <div className="text-xs text-muted-foreground p-4 text-center">
            No conversations yet.
          </div>
        )}
        {threads.map((t) => {
          const active = t.id === activeId;
          const isEditing = editingId === t.id;
          return (
            <div
              key={t.id}
              className={cn(
                "group relative rounded-md px-2 py-1.5 cursor-pointer hover:bg-accent",
                active && "bg-accent",
              )}
              onClick={() => !isEditing && onSelect(t.id)}
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
                <>
                  <div className="text-sm truncate pr-12">{t.title}</div>
                  {!compact && (
                    <div className="text-[10px] text-muted-foreground">
                      {t.last_message_at
                        ? `${formatDistanceToNow(new Date(t.last_message_at))} ago`
                        : "empty"}
                      {t.message_count > 0 && ` · ${t.message_count} msg`}
                    </div>
                  )}
                  <div className="absolute right-1 top-1 flex opacity-0 group-hover:opacity-100 transition">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => { e.stopPropagation(); setEditingId(t.id); setDraft(t.title); }}
                      aria-label="Rename thread"
                    >
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Delete thread"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
                          <AlertDialogDescription>
                            "{t.title}" and its messages will be permanently removed.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => del.mutate(t.id)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
