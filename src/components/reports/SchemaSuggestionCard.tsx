import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, Plus, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { CitedTradeChip } from "./CitedTradeChip";
import type { SchemaSuggestion } from "@/types/reports";

interface Props {
  suggestion: SchemaSuggestion;
}

export function SchemaSuggestionCard({ suggestion }: Props) {
  const { user } = useAuth();
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);

  const addToJournal = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const q = suggestion.proposed_question;
      // Check if a live-question row with this key already exists
      const { data: existing } = await (supabase as any)
        .from("custom_field_definitions")
        .select("id")
        .eq("user_id", user.id)
        .eq("scope", "live_question")
        .eq("key", q.id)
        .maybeSingle();
      if (existing) {
        setAdded(true);
        toast.info("This question already exists in your journal.");
        return;
      }
      // Compute next sort_order
      const { data: rows } = await (supabase as any)
        .from("custom_field_definitions")
        .select("sort_order")
        .eq("user_id", user.id)
        .eq("scope", "live_question")
        .order("sort_order", { ascending: false })
        .limit(1);
      const nextSort = rows && rows[0] ? (rows[0].sort_order ?? 0) + 1 : 0;
      const { error } = await (supabase as any)
        .from("custom_field_definitions")
        .insert({
          user_id: user.id,
          scope: "live_question",
          key: q.id,
          label: q.label,
          type: q.type,
          options: q.options ?? [],
          sort_order: nextSort,
          is_active: true,
        });
      if (error) throw error;
      setAdded(true);
      toast.success(`Added "${q.label}" to your live trade questions.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add question");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm">Suggested journal field</CardTitle>
          </div>
          <Badge variant="outline" className="text-xs">{suggestion.proposed_widget}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="font-mono text-sm font-semibold">{suggestion.proposed_question.label}</div>
          <p className="text-sm text-muted-foreground mt-1">{suggestion.reason}</p>
        </div>
        {suggestion.example_trade_ids.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Examples:{" "}
            {suggestion.example_trade_ids.slice(0, 5).map(id => (
              <CitedTradeChip key={id} tradeId={id} />
            ))}
          </div>
        )}
        <Button
          size="sm"
          variant={added ? "secondary" : "default"}
          disabled={added || busy}
          onClick={addToJournal}
        >
          {added ? <><Check className="w-3 h-3 mr-1" /> Added</> : <><Plus className="w-3 h-3 mr-1" /> Add to my journal</>}
        </Button>
      </CardContent>
    </Card>
  );
}
