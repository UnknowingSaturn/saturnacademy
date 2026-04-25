import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { format, parseISO } from "date-fns";
import { TrendingUp, TrendingDown, CheckCircle2, AlertCircle, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublicTradeCard } from "@/types/sharedReports";

const SESSION_LABELS: Record<string, string> = {
  tokyo: "Tokyo",
  london: "London",
  new_york: "New York",
  new_york_am: "NY AM",
  new_york_pm: "NY PM",
  overlap_london_ny: "London/NY",
  off_hours: "Off-hours",
  unknown: "Untagged",
};

interface Props {
  card: PublicTradeCard;
  index: number;
}

export function EducationalTradeCard({ card, index }: Props) {
  const isLong = card.direction?.toLowerCase() === "long" || card.direction?.toLowerCase() === "buy";
  const dt = card.entry_time ? parseISO(card.entry_time) : null;

  return (
    <Card className="overflow-hidden border-border bg-card">
      {/* Header strip */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-[10px] font-bold tracking-widest text-muted-foreground tabular-nums">
            #{String(index + 1).padStart(2, "0")}
          </div>
          <div className="text-base font-semibold tracking-tight">{card.symbol}</div>
          <Badge variant="outline" className={cn(
            "gap-1 font-mono text-[11px]",
            isLong ? "border-success/40 text-success" : "border-destructive/40 text-destructive",
          )}>
            {isLong ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {card.direction?.toUpperCase()}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
          {dt && <span className="tabular-nums">{format(dt, "MMM d, HH:mm")}</span>}
          {card.session && <Badge variant="secondary" className="text-[10px]">{SESSION_LABELS[card.session] || card.session}</Badge>}
          {card.playbook_name && <span className="italic">{card.playbook_name}</span>}
        </div>
      </div>

      {/* Screenshots */}
      {card.screenshots.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
          {card.screenshots.map((s, i) => (
            <figure key={i} className="bg-card">
              <div className="relative aspect-video bg-muted/40">
                <img src={s.url} alt={s.description || s.timeframe} className="w-full h-full object-cover" loading="lazy" />
                {s.timeframe && (
                  <Badge className="absolute top-2 left-2 font-mono text-[10px] bg-background/80 text-foreground border border-border">
                    {s.timeframe}
                  </Badge>
                )}
              </div>
              {s.description && (
                <figcaption className="px-3 py-2 text-xs text-muted-foreground italic leading-relaxed border-t border-border/50">
                  {s.description}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}

      {/* Captions */}
      {(card.caption_what_went_well || card.caption_what_went_wrong || card.caption_what_to_improve) && (
        <div className="px-5 py-4 space-y-3">
          {card.caption_what_went_well && (
            <CaptionRow icon={<CheckCircle2 className="w-4 h-4 text-success" />} label="What went well" text={card.caption_what_went_well} />
          )}
          {card.caption_what_went_wrong && (
            <CaptionRow icon={<AlertCircle className="w-4 h-4 text-destructive" />} label="What went wrong" text={card.caption_what_went_wrong} />
          )}
          {card.caption_what_to_improve && (
            <CaptionRow icon={<Lightbulb className="w-4 h-4 text-warning" />} label="What to improve" text={card.caption_what_to_improve} />
          )}
        </div>
      )}
    </Card>
  );
}

function CaptionRow({ icon, label, text }: { icon: React.ReactNode; label: string; text: string }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase mb-1">{label}</div>
        <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line">{text}</p>
      </div>
    </div>
  );
}
