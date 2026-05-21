import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, MessageSquare, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ConversationRow {
  id: string;
  title: string;
  updated_at: string;
}

export const STRATEGY_CONVERSATIONS_KEY = ["strategy_conversations"] as const;

export function StrategyLabConversationsGroup() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeId = searchParams.get("c");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: conversations = [] } = useQuery({
    queryKey: STRATEGY_CONVERSATIONS_KEY,
    queryFn: async (): Promise<ConversationRow[]> => {
      const { data, error } = await supabase
        .from("strategy_conversations")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleSelect = (id: string) => {
    navigate(`/strategy-lab?c=${id}`);
  };

  const handleNew = () => {
    navigate("/strategy-lab");
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const { error } = await supabase.from("strategy_conversations").delete().eq("id", id);
    if (error) {
      toast({ title: "Couldn't delete", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: STRATEGY_CONVERSATIONS_KEY });
    if (activeId === id) navigate("/strategy-lab");
  };

  if (collapsed) {
    return (
      <SidebarGroup className="mt-2">
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={handleNew} tooltip="New conversation">
                <Plus className="w-5 h-5" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <SidebarGroup className="mt-2">
      <div className="flex items-center justify-between px-2">
        <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground">
          Conversations
        </SidebarGroupLabel>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={handleNew}
          title="New conversation"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <SidebarGroupContent>
        <div className="px-2 pb-2 max-h-[40vh] overflow-y-auto space-y-0.5">
          {conversations.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 py-3">No conversations yet</p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => handleSelect(c.id)}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer text-xs transition-colors",
                  activeId === c.id
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60"
                )}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span className="flex-1 truncate">{c.title}</span>
                <button
                  onClick={(e) => handleDelete(e, c.id)}
                  className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80"
                  title="Delete conversation"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
