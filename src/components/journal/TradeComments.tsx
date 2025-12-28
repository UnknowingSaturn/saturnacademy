import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TradeComment } from "@/types/trading";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Send, Image as ImageIcon, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TradeCommentsProps {
  tradeId: string;
}

export function TradeComments({ tradeId }: TradeCommentsProps) {
  const [newComment, setNewComment] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ["trade-comments", tradeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trade_comments")
        .select("*")
        .eq("trade_id", tradeId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data as TradeComment[];
    },
  });

  const addComment = useMutation({
    mutationFn: async ({ content, screenshotUrl }: { content: string; screenshotUrl?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("trade_comments").insert({
        trade_id: tradeId,
        user_id: user.id,
        content,
        screenshot_url: screenshotUrl || null,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trade-comments", tradeId] });
      setNewComment("");
    },
    onError: (error) => {
      toast({ title: "Failed to add comment", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!newComment.trim()) return;
    addComment.mutate({ content: newComment.trim() });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const fileExt = file.name.split(".").pop();
      const fileName = `${user.id}/${tradeId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("trade-screenshots")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("trade-screenshots")
        .getPublicUrl(fileName);

      addComment.mutate({ content: "📸 Screenshot", screenshotUrl: publicUrl });
    } catch (error: any) {
      toast({ title: "Failed to upload image", description: error.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Comments List */}
      <div className="space-y-4">
        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No comments yet. Add your first comment about this trade.
          </p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="flex gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">U</AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">You</span>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(comment.created_at), "MMM d, h:mm a")}
                  </span>
                </div>
                <p className="text-sm">{comment.content}</p>
                {comment.screenshot_url && (
                  <div className="mt-2">
                    <img
                      src={comment.screenshot_url}
                      alt="Screenshot"
                      className="max-w-sm rounded-lg border border-border cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => window.open(comment.screenshot_url!, "_blank")}
                    />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Comment */}
      <div className="flex gap-2">
        <Textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add a comment..."
          rows={2}
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleSubmit();
            }
          }}
        />
        <div className="flex flex-col gap-1">
          <Button
            size="icon"
            onClick={handleSubmit}
            disabled={!newComment.trim() || addComment.isPending}
          >
            {addComment.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
          <label>
            <Button
              size="icon"
              variant="outline"
              disabled={isUploading}
              asChild
            >
              <span className="cursor-pointer">
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
              </span>
            </Button>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageUpload}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
