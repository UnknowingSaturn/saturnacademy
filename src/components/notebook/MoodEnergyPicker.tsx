import { cn } from "@/lib/utils";

interface MoodEnergyPickerProps {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  type: 'mood' | 'energy';
}

const moodEmojis = ['😫', '😔', '😐', '🙂', '😄'];
const moodLabels = ['Terrible', 'Bad', 'Okay', 'Good', 'Great'];
const energyEmojis = ['🔋', '🔋', '🔋', '🔋', '⚡'];
const energyLabels = ['Exhausted', 'Low', 'Normal', 'High', 'Peak'];

export function MoodEnergyPicker({ label, value, onChange, type }: MoodEnergyPickerProps) {
  const emojis = type === 'mood' ? moodEmojis : energyEmojis;
  const labels = type === 'mood' ? moodLabels : energyLabels;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-muted-foreground">{label}</label>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => onChange(level)}
            className={cn(
              "flex flex-col items-center gap-1 p-2 rounded-lg border transition-all duration-200",
              "hover:bg-accent/50 hover:border-primary/30",
              value === level 
                ? "bg-primary/10 border-primary/50 ring-1 ring-primary/30" 
                : "border-border/50 bg-card/50"
            )}
          >
            <span className="text-xl">{emojis[level - 1]}</span>
            <span className="text-[10px] text-muted-foreground">{labels[level - 1]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
