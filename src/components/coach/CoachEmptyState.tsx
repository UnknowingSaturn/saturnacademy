import * as React from "react";
import { TrendingDown, Trophy, Flame, LineChart } from "lucide-react";
import { CoachMark } from "./CoachMark";

const SUGGESTIONS: { icon: React.ComponentType<{ className?: string }>; label: string; prompt: string }[] = [
  { icon: TrendingDown, label: "Review my last losing trade", prompt: "Review my most recent losing trade — what went wrong and what should I learn?" },
  { icon: Trophy, label: "My best setup this month", prompt: "What's my highest-expectancy setup this month? Cite specific trades." },
  { icon: Flame, label: "Find my revenge trades", prompt: "Find times I took revenge trades or over-traded after a loss." },
  { icon: LineChart, label: "Analyze a chart screenshot", prompt: "I'll upload a chart — help me review the setup against my playbooks." },
];

interface Props {
  onPick: (prompt: string) => void;
}

export function CoachEmptyState({ onPick }: Props) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
      <CoachMark size={56} className="mb-4" />
      <h3 className="text-lg font-semibold text-foreground">Your trading coach</h3>
      <p className="text-sm text-muted-foreground max-w-md mt-1.5">
        Ask about your trades, drop in a chart, or pick a starter below. I cite real trades from your journal.
      </p>
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
        {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
          <button
            key={label}
            type="button"
            onClick={() => onPick(prompt)}
            className="group flex items-center gap-3 rounded-xl border border-border/70 bg-card/40 hover:bg-accent hover:border-border transition text-left px-3.5 py-3"
          >
            <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:bg-primary/15">
              <Icon className="w-4 h-4" />
            </span>
            <span className="text-sm text-foreground/90 leading-snug">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
