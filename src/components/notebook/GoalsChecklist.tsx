import { useState } from "react";
import { NotebookGoal } from "@/types/notebook";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface GoalsChecklistProps {
  goals: NotebookGoal[];
  onChange: (goals: NotebookGoal[]) => void;
}

export function GoalsChecklist({ goals, onChange }: GoalsChecklistProps) {
  const [newGoal, setNewGoal] = useState("");

  const addGoal = () => {
    if (!newGoal.trim()) return;
    onChange([
      ...goals,
      { id: crypto.randomUUID(), text: newGoal.trim(), completed: false }
    ]);
    setNewGoal("");
  };

  const toggleGoal = (id: string) => {
    onChange(goals.map(g => g.id === id ? { ...g, completed: !g.completed } : g));
  };

  const removeGoal = (id: string) => {
    onChange(goals.filter(g => g.id !== id));
  };

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-muted-foreground">Today's Goals</label>
      
      <div className="space-y-2">
        {goals.map((goal) => (
          <div 
            key={goal.id}
            className={cn(
              "flex items-center gap-3 p-3 rounded-lg border transition-all",
              goal.completed 
                ? "bg-profit/5 border-profit/20" 
                : "bg-card/50 border-border/50"
            )}
          >
            <Checkbox
              checked={goal.completed}
              onCheckedChange={() => toggleGoal(goal.id)}
              className={goal.completed ? "border-profit data-[state=checked]:bg-profit" : ""}
            />
            <span className={cn(
              "flex-1 text-sm",
              goal.completed && "line-through text-muted-foreground"
            )}>
              {goal.text}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-50 hover:opacity-100"
              onClick={() => removeGoal(goal.id)}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={newGoal}
          onChange={(e) => setNewGoal(e.target.value)}
          placeholder="Add a goal for today..."
          onKeyDown={(e) => e.key === "Enter" && addGoal()}
          className="bg-background/50"
        />
        <Button variant="outline" size="icon" onClick={addGoal}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
