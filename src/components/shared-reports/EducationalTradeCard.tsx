import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format, parseISO } from "date-fns";
import {
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  ChevronLeft,
  ChevronRight,
  X,
  ZoomIn,
} from "lucide-react";
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

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const open = lightboxIndex !== null;
  const total = card.screenshots.length;

  const goPrev = useCallback(() => {
    if (lightboxIndex === null || total === 0) return;
    setLightboxIndex((lightboxIndex - 1 + total) % total);
  }, [lightboxIndex, total]);
  const goNext = useCallback(() => {
    if (lightboxIndex === null || total === 0) return;
    setLightboxIndex((lightboxIndex + 1) % total);
  }, [lightboxIndex, total]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "Escape") setLightboxIndex(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, goPrev, goNext]);

  const activeShot = lightboxIndex !== null ? card.screenshots[lightboxIndex] : null;

  return (
    <>
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
                <button
                  type="button"
                  onClick={() => setLightboxIndex(i)}
                  className="relative aspect-video bg-muted/40 w-full block group cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={`Open screenshot ${i + 1} of ${total}${s.timeframe ? ` (${s.timeframe})` : ""}`}
                >
                  <img
                    src={s.url}
                    alt={s.description || s.timeframe || `Screenshot ${i + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {s.timeframe && (
                    <Badge className="absolute top-2 left-2 font-mono text-[10px] bg-background/80 text-foreground border border-border">
                      {s.timeframe}
                    </Badge>
                  )}
                  <div className="absolute inset-0 bg-background/0 group-hover:bg-background/20 transition-colors flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-background/90 rounded-full p-2 border border-border shadow-lg">
                      <ZoomIn className="w-4 h-4 text-foreground" />
                    </div>
                  </div>
                </button>
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

      {/* Lightbox dialog */}
      <Dialog open={open} onOpenChange={(o) => !o && setLightboxIndex(null)}>
        <DialogContent className="max-w-[95vw] w-[95vw] max-h-[95vh] h-[95vh] p-0 bg-background/95 backdrop-blur border-border overflow-hidden">
          {activeShot && (
            <div className="relative w-full h-full flex flex-col">
              {/* Top bar */}
              <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between gap-2 p-3 bg-gradient-to-b from-background/80 to-transparent">
                <div className="flex items-center gap-2">
                  {activeShot.timeframe && (
                    <Badge className="font-mono text-xs bg-background/80 border border-border text-foreground">
                      {activeShot.timeframe}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {(lightboxIndex ?? 0) + 1} / {total}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setLightboxIndex(null)}
                  className="h-8 w-8"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Image */}
              <div className="flex-1 flex items-center justify-center p-4 pt-14 pb-16 overflow-hidden">
                <img
                  src={activeShot.url}
                  alt={activeShot.description || activeShot.timeframe || "Screenshot"}
                  className="max-w-full max-h-full object-contain rounded"
                />
              </div>

              {/* Description */}
              {activeShot.description && (
                <div className="absolute bottom-0 inset-x-0 px-6 py-3 bg-gradient-to-t from-background/90 to-transparent text-sm text-foreground/90 italic text-center">
                  {activeShot.description}
                </div>
              )}

              {/* Nav arrows */}
              {total > 1 && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={goPrev}
                    className="absolute left-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-background/60 hover:bg-background/80 border border-border"
                    aria-label="Previous screenshot"
                  >
                    <ChevronLeft className="w-6 h-6" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={goNext}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-background/60 hover:bg-background/80 border border-border"
                    aria-label="Next screenshot"
                  >
                    <ChevronRight className="w-6 h-6" />
                  </Button>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
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
