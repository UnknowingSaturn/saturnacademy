import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MessageSquare, Send } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface QuickNoteInputProps {
  tradeId: string;
}

export function QuickNoteInput({ tradeId }: QuickNoteInputProps) {
  const [note, setNote] = useState("");
  const queryClient = useQueryClient();

  const createComment = useMutation({
    mutationFn: async (content: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("trade_comments").insert({
        trade_id: tradeId,
        user_id: user.id,
        content,
      });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trade-comments", tradeId] });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!note.trim()) return;
    
    try {
      await createComment.mutateAsync(note.trim());
      setNote("");
      toast.success("Note added");
    } catch (error) {
      toast.error("Failed to add note");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <div className="relative flex-1">
        <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a quick note..."
          className="pl-9 h-9 text-sm bg-muted/50 border-border/50"
        />
      </div>
      <Button 
        type="submit" 
        size="sm" 
        variant="ghost"
        disabled={!note.trim() || createComment.isPending}
        className="h-9 w-9 p-0"
      >
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
}
