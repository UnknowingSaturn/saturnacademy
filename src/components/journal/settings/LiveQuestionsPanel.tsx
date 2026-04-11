import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useUserSettings, useUpdateUserSettings } from "@/hooks/useUserSettings";
import { LiveTradeQuestion, DEFAULT_LIVE_TRADE_QUESTIONS } from "@/types/settings";

export function LiveQuestionsPanel() {
  const { data: settings } = useUserSettings();
  const updateSettings = useUpdateUserSettings();
  
  const questions: LiveTradeQuestion[] = settings?.live_trade_questions || DEFAULT_LIVE_TRADE_QUESTIONS;
  
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<LiveTradeQuestion['type']>("text");
  const [newOptions, setNewOptions] = useState("");

  const saveQuestions = (updated: LiveTradeQuestion[]) => {
    updateSettings.mutate({ live_trade_questions: updated } as any);
  };

  const addQuestion = () => {
    if (!newLabel.trim()) {
      toast.error("Enter a question label");
      return;
    }
    const id = newLabel.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30) + '_' + Date.now();
    const q: LiveTradeQuestion = {
      id,
      type: newType,
      label: newLabel.trim(),
    };
    if (newType === 'select' && newOptions.trim()) {
      q.options = newOptions.split(',').map(o => o.trim()).filter(Boolean);
    }
    saveQuestions([...questions, q]);
    setNewLabel("");
    setNewOptions("");
    toast.success("Question added");
  };

  const removeQuestion = (id: string) => {
    saveQuestions(questions.filter(q => q.id !== id));
    toast.success("Question removed");
  };

  const resetToDefaults = () => {
    saveQuestions(DEFAULT_LIVE_TRADE_QUESTIONS);
    toast.success("Reset to defaults");
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">Live Trade Questions</h3>
        <p className="text-xs text-muted-foreground">
          These questions appear on the Live Trades page when documenting open positions.
        </p>
      </div>

      <div className="space-y-2">
        {questions.map((q) => (
          <Card key={q.id} className="border-border/50">
            <CardContent className="p-3 flex items-center gap-3">
              <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{q.label}</span>
                  <Badge variant="secondary" className="text-xs shrink-0">{q.type}</Badge>
                </div>
                {q.options && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {q.options.map(o => (
                      <Badge key={o} variant="outline" className="text-xs">{o}</Badge>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                onClick={() => removeQuestion(q.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-dashed border-border/50">
        <CardContent className="p-4 space-y-3">
          <Label className="text-xs font-medium">Add Question</Label>
          <div className="flex gap-2">
            <Input
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder="Question text..."
              className="flex-1"
            />
            <Select value={newType} onValueChange={v => setNewType(v as LiveTradeQuestion['type'])}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="select">Select</SelectItem>
                <SelectItem value="rating">Rating</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {newType === 'select' && (
            <Input
              value={newOptions}
              onChange={e => setNewOptions(e.target.value)}
              placeholder="Options (comma-separated): Focused, Calm, Anxious"
            />
          )}
          <Button size="sm" onClick={addQuestion} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </CardContent>
      </Card>

      <Button variant="outline" size="sm" onClick={resetToDefaults}>
        Reset to Defaults
      </Button>
    </div>
  );
}
