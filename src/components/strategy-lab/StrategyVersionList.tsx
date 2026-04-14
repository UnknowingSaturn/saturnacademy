import * as React from "react";
import { FileCode, Trash2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

export interface StrategyVersion {
  id: string;
  name: string;
  version: number;
  created_at: string;
  playbook_id?: string | null;
}

interface StrategyVersionListProps {
  versions: StrategyVersion[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function StrategyVersionList({ versions, activeId, onSelect, onDelete }: StrategyVersionListProps) {
  if (versions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-xs text-center px-4">Generated EAs will appear here</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-1">
        {versions.map((v) => (
          <div
            key={v.id}
            className={cn(
              "group flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer text-sm transition-colors",
              activeId === v.id ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"
            )}
            onClick={() => onSelect(v.id)}
          >
            <FileCode className="h-4 w-4 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="truncate font-medium">{v.name}</p>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
              </div>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">v{v.version}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(v.id);
              }}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
