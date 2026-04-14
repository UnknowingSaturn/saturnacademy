import * as React from "react";
import { Plus, MessageSquare, Trash2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

export interface Conversation {
  id: string;
  title: string;
  playbook_id: string | null;
  updated_at: string;
  messages?: Array<{ role: string; content: string }>;
}

interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onExport?: (id: string) => void;
}

export function ConversationList({ conversations, activeId, onSelect, onNew, onDelete, onExport }: ConversationListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <Button onClick={onNew} className="w-full gap-2" size="sm">
          <Plus className="h-4 w-4" />
          New Conversation
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {conversations.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              No conversations yet
            </p>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={cn(
                "group flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer text-sm transition-colors",
                activeId === conv.id
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted text-foreground"
              )}
              onClick={() => onSelect(conv.id)}
            >
              <MessageSquare className="h-4 w-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{conv.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(conv.updated_at), { addSuffix: true })}
                </p>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                {onExport && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      onExport(conv.id);
                    }}
                    title="Export as markdown"
                  >
                    <Download className="h-3 w-3 text-muted-foreground" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(conv.id);
                  }}
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
