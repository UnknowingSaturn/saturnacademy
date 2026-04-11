import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, GripVertical, Pencil, X, Image, Hash, CheckSquare } from "lucide-react";
import { toast } from "sonner";
import { useUserSettings, useUpdateUserSettings } from "@/hooks/useUserSettings";
import { LiveTradeQuestion, DEFAULT_LIVE_TRADE_QUESTIONS } from "@/types/settings";

const QUESTION_TYPES: { value: LiveTradeQuestion['type']; label: string; icon?: React.ReactNode }[] = [
  { value: 'text', label: 'Text' },
  { value: 'select', label: 'Select' },
  { value: 'rating', label: 'Rating' },
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'number', label: 'Number' },
];

export function LiveQuestionsPanel() {
  const { data: settings } = useUserSettings();
  const updateSettings = useUpdateUserSettings();
  
  const questions: LiveTradeQuestion[] = settings?.live_trade_questions || DEFAULT_LIVE_TRADE_QUESTIONS;
  
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<LiveTradeQuestion['type']>("text");
  const [newOptions, setNewOptions] = useState("");
  const [newMaxItems, setNewMaxItems] = useState(5);
  const [newRequired, setNewRequired] = useState(false);
  const [newPlaceholder, setNewPlaceholder] = useState("");
  const [newMin, setNewMin] = useState<string>("");
  const [newMax, setNewMax] = useState<string>("");
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editType, setEditType] = useState<LiveTradeQuestion['type']>("text");
  const [editOptions, setEditOptions] = useState("");
  const [editMaxItems, setEditMaxItems] = useState(5);
  const [editRequired, setEditRequired] = useState(false);
  const [editPlaceholder, setEditPlaceholder] = useState("");
  const [editMin, setEditMin] = useState<string>("");
  const [editMax, setEditMax] = useState<string>("");

  const saveQuestions = (updated: LiveTradeQuestion[]) => {
    updateSettings.mutate({ live_trade_questions: updated } as any);
  };

  const buildQuestion = (
    id: string,
    type: LiveTradeQuestion['type'],
    label: string,
    options: string,
    maxItems: number,
    required: boolean,
    placeholder: string,
    min: string,
    max: string,
  ): LiveTradeQuestion => {
    const q: LiveTradeQuestion = { id, type, label };
    if (type === 'select' && options.trim()) {
      q.options = options.split(',').map(o => o.trim()).filter(Boolean);
    }
    if (type === 'screenshot') q.maxItems = maxItems;
    if (required) q.required = true;
    if (placeholder.trim() && (type === 'text' || type === 'number')) q.placeholder = placeholder.trim();
    if ((type === 'number' || type === 'rating') && min !== '') q.min = Number(min);
    if ((type === 'number' || type === 'rating') && max !== '') q.max = Number(max);
    return q;
  };

  const addQuestion = () => {
    if (!newLabel.trim()) {
      toast.error("Enter a question label");
      return;
    }
    const id = newLabel.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30) + '_' + Date.now();
    const q = buildQuestion(id, newType, newLabel.trim(), newOptions, newMaxItems, newRequired, newPlaceholder, newMin, newMax);
    saveQuestions([...questions, q]);
    setNewLabel("");
    setNewOptions("");
    setNewMaxItems(5);
    setNewRequired(false);
    setNewPlaceholder("");
    setNewMin("");
    setNewMax("");
    toast.success("Question added");
  };

  const startEdit = (q: LiveTradeQuestion) => {
    setEditingId(q.id);
    setEditLabel(q.label);
    setEditType(q.type);
    setEditOptions(q.options?.join(', ') || '');
    setEditMaxItems(q.maxItems || 5);
    setEditRequired(q.required || false);
    setEditPlaceholder(q.placeholder || '');
    setEditMin(q.min != null ? String(q.min) : '');
    setEditMax(q.max != null ? String(q.max) : '');
  };

  const saveEdit = () => {
    if (!editingId || !editLabel.trim()) return;
    const updated = questions.map(q => {
      if (q.id !== editingId) return q;
      return buildQuestion(q.id, editType, editLabel.trim(), editOptions, editMaxItems, editRequired, editPlaceholder, editMin, editMax);
    });
    saveQuestions(updated);
    setEditingId(null);
    toast.success("Question updated");
  };

  const removeQuestion = (id: string) => {
    saveQuestions(questions.filter(q => q.id !== id));
    toast.success("Question removed");
  };

  const resetToDefaults = () => {
    saveQuestions(DEFAULT_LIVE_TRADE_QUESTIONS);
    toast.success("Reset to defaults");
  };

  const getTypeBadgeIcon = (type: LiveTradeQuestion['type']) => {
    switch (type) {
      case 'screenshot': return <Image className="h-3 w-3 mr-0.5" />;
      case 'number': return <Hash className="h-3 w-3 mr-0.5" />;
      case 'checkbox': return <CheckSquare className="h-3 w-3 mr-0.5" />;
      default: return null;
    }
  };

  const renderConfigFields = (
    type: LiveTradeQuestion['type'],
    opts: { options: string; setOptions: (v: string) => void; maxItems: number; setMaxItems: (v: number) => void; required: boolean; setRequired: (v: boolean) => void; placeholder: string; setPlaceholder: (v: string) => void; min: string; setMin: (v: string) => void; max: string; setMax: (v: string) => void; }
  ) => (
    <div className="space-y-2">
      {type === 'select' && (
        <Input
          value={opts.options}
          onChange={e => opts.setOptions(e.target.value)}
          placeholder="Options (comma-separated): Focused, Calm, Anxious"
        />
      )}
      {type === 'screenshot' && (
        <div className="flex items-center gap-2">
          <Label className="text-xs whitespace-nowrap">Max images</Label>
          <Input
            type="number"
            min={1}
            max={10}
            value={opts.maxItems}
            onChange={e => opts.setMaxItems(Math.max(1, Math.min(10, Number(e.target.value))))}
            className="w-20"
          />
        </div>
      )}
      {(type === 'text' || type === 'number') && (
        <Input
          value={opts.placeholder}
          onChange={e => opts.setPlaceholder(e.target.value)}
          placeholder="Placeholder text (optional)"
        />
      )}
      {(type === 'number' || type === 'rating') && (
        <div className="flex gap-2">
          <div className="flex items-center gap-1">
            <Label className="text-xs">Min</Label>
            <Input type="number" value={opts.min} onChange={e => opts.setMin(e.target.value)} className="w-16" placeholder="—" />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-xs">Max</Label>
            <Input type="number" value={opts.max} onChange={e => opts.setMax(e.target.value)} className="w-16" placeholder="—" />
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Switch checked={opts.required} onCheckedChange={opts.setRequired} id={`req-${type}`} />
        <Label htmlFor={`req-${type}`} className="text-xs">Required</Label>
      </div>
    </div>
  );

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
            <CardContent className="p-3">
              {editingId === q.id ? (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      value={editLabel}
                      onChange={e => setEditLabel(e.target.value)}
                      className="flex-1"
                    />
                    <Select value={editType} onValueChange={v => setEditType(v as LiveTradeQuestion['type'])}>
                      <SelectTrigger className="w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QUESTION_TYPES.map(t => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {renderConfigFields(editType, {
                    options: editOptions, setOptions: setEditOptions,
                    maxItems: editMaxItems, setMaxItems: setEditMaxItems,
                    required: editRequired, setRequired: setEditRequired,
                    placeholder: editPlaceholder, setPlaceholder: setEditPlaceholder,
                    min: editMin, setMin: setEditMin,
                    max: editMax, setMax: setEditMax,
                  })}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveEdit}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{q.label}</span>
                      <Badge variant="secondary" className="text-xs shrink-0 flex items-center">
                        {getTypeBadgeIcon(q.type)}
                        {q.type}
                      </Badge>
                      {q.required && <Badge variant="outline" className="text-xs shrink-0">Required</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {q.options?.map(o => (
                        <Badge key={o} variant="outline" className="text-xs">{o}</Badge>
                      ))}
                      {q.type === 'screenshot' && (
                        <span className="text-xs text-muted-foreground">Max {q.maxItems || 5} images</span>
                      )}
                      {q.placeholder && (
                        <span className="text-xs text-muted-foreground italic">"{q.placeholder}"</span>
                      )}
                      {q.min != null && <span className="text-xs text-muted-foreground">min: {q.min}</span>}
                      {q.max != null && <span className="text-xs text-muted-foreground">max: {q.max}</span>}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => startEdit(q)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                    onClick={() => removeQuestion(q.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
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
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUESTION_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {renderConfigFields(newType, {
            options: newOptions, setOptions: setNewOptions,
            maxItems: newMaxItems, setMaxItems: setNewMaxItems,
            required: newRequired, setRequired: setNewRequired,
            placeholder: newPlaceholder, setPlaceholder: setNewPlaceholder,
            min: newMin, setMin: setNewMin,
            max: newMax, setMax: setNewMax,
          })}
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
