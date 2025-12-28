import { useState, useEffect } from "react";
import { format, addDays, subDays } from "date-fns";
import { NotebookEntry, NotebookGoal } from "@/types/notebook";
import { useNotebookEntry, useUpsertNotebookEntry } from "@/hooks/useNotebook";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { MoodEnergyPicker } from "./MoodEnergyPicker";
import { GoalsChecklist } from "./GoalsChecklist";
import { ChevronLeft, ChevronRight, Calendar, Save, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface NotebookEditorProps {
  date: Date;
  onDateChange: (date: Date) => void;
}

export function NotebookEditor({ date, onDateChange }: NotebookEditorProps) {
  const dateStr = format(date, "yyyy-MM-dd");
  const { data: entry, isLoading } = useNotebookEntry(dateStr);
  const upsertEntry = useUpsertNotebookEntry();

  const [content, setContent] = useState("");
  const [marketConditions, setMarketConditions] = useState("");
  const [moodRating, setMoodRating] = useState<number | null>(null);
  const [energyLevel, setEnergyLevel] = useState<number | null>(null);
  const [goals, setGoals] = useState<NotebookGoal[]>([]);
  const [reflection, setReflection] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // Load entry data
  useEffect(() => {
    if (entry) {
      setContent(entry.content || "");
      setMarketConditions(entry.market_conditions || "");
      setMoodRating(entry.mood_rating);
      setEnergyLevel(entry.energy_level);
      setGoals(entry.goals);
      setReflection(entry.reflection || "");
    } else {
      setContent("");
      setMarketConditions("");
      setMoodRating(null);
      setEnergyLevel(null);
      setGoals([]);
      setReflection("");
    }
    setHasChanges(false);
  }, [entry, dateStr]);

  const handleChange = (setter: (v: any) => void) => (value: any) => {
    setter(value);
    setHasChanges(true);
  };

  const handleSave = async () => {
    await upsertEntry.mutateAsync({
      entry_date: dateStr,
      content: content || null,
      market_conditions: marketConditions || null,
      mood_rating: moodRating,
      energy_level: energyLevel,
      goals,
      reflection: reflection || null,
    });
    setHasChanges(false);
  };

  const isToday = format(new Date(), "yyyy-MM-dd") === dateStr;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-[400px]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Date Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDateChange(subDays(date, 1))}
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">
              {format(date, "EEEE, MMMM d, yyyy")}
            </h2>
            {isToday && (
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-primary/20 text-primary">
                Today
              </span>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDateChange(addDays(date, 1))}
            disabled={isToday}
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>

        <Button
          onClick={handleSave}
          disabled={!hasChanges || upsertEntry.isPending}
          className={cn(
            "gap-2 transition-all",
            hasChanges && "btn-premium"
          )}
        >
          {upsertEntry.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {hasChanges ? "Save Entry" : "Saved"}
        </Button>
      </div>

      {/* Editor Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column - Morning */}
        <div className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <span className="text-2xl">🌅</span> Pre-Market
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <MoodEnergyPicker
                label="How are you feeling?"
                value={moodRating}
                onChange={handleChange(setMoodRating)}
                type="mood"
              />
              
              <MoodEnergyPicker
                label="Energy Level"
                value={energyLevel}
                onChange={handleChange(setEnergyLevel)}
                type="energy"
              />

              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Market Conditions & Bias
                </label>
                <Textarea
                  value={marketConditions}
                  onChange={(e) => handleChange(setMarketConditions)(e.target.value)}
                  placeholder="What are the key levels? Any news to watch? What's your bias today?"
                  rows={4}
                  className="bg-background/50"
                />
              </div>

              <GoalsChecklist
                goals={goals}
                onChange={handleChange(setGoals)}
              />
            </CardContent>
          </Card>
        </div>

        {/* Right Column - End of Day */}
        <div className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <span className="text-2xl">📝</span> Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={content}
                onChange={(e) => handleChange(setContent)(e.target.value)}
                placeholder="Free-form notes, observations, ideas..."
                rows={8}
                className="bg-background/50"
              />
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <span className="text-2xl">🌙</span> End of Day Reflection
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={reflection}
                onChange={(e) => handleChange(setReflection)(e.target.value)}
                placeholder="What did you learn today? What would you do differently? Any patterns you noticed?"
                rows={6}
                className="bg-background/50"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
