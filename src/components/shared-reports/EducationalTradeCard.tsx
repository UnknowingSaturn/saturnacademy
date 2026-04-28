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
      <Card className="overflow-hidden border-border bg-card shadow-sm">
        {/* Header strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border bg-muted/20">
          <div className="flex items-center gap-3 min-w-0">
            <div className="font-serif text-xl font-semibold text-muted-foreground tabular-nums leading-none">
              {String(index + 1).padStart(2, "0")}
            </div>
            <div className="text-lg font-semibold tracking-tight">{card.symbol}</div>
            <Badge variant="outline" className={cn(
              "gap-1 font-mono text-xs",
              isLong ? "border-success/40 text-success" : "border-destructive/40 text-destructive",
            )}>
              {isLong ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {card.direction?.toUpperCase()}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground shrink-0">
            {dt && <span className="tabular-nums">{format(dt, "MMM d, HH:mm")}</span>}
            {card.session && <Badge variant="secondary" className="text-[11px]">{SESSION_LABELS[card.session] || card.session}</Badge>}
            {card.playbook_name && <span className="italic">{card.playbook_name}</span>}
          </div>
        </div>

        {/* Screenshots — adaptive layout based on count */}
        <ScreenshotLayout
          shots={card.screenshots}
          onOpen={(i) => setLightboxIndex(i)}
        />

        {/* Captions */}
        {(card.caption_what_went_well || card.caption_what_went_wrong || card.caption_what_to_improve) && (
          <div className="p-4 md:p-5 space-y-3">
            {card.caption_what_went_well && (
              <CaptionRow
                tone="success"
                icon={<CheckCircle2 className="w-5 h-5 text-success" />}
                label="What went well"
                text={card.caption_what_went_well}
              />
            )}
            {card.caption_what_went_wrong && (
              <CaptionRow
                tone="destructive"
                icon={<AlertCircle className="w-5 h-5 text-destructive" />}
                label="What went wrong"
                text={card.caption_what_went_wrong}
              />
            )}
            {card.caption_what_to_improve && (
              <CaptionRow
                tone="warning"
                icon={<Lightbulb className="w-5 h-5 text-warning" />}
                label="What to improve"
                text={card.caption_what_to_improve}
              />
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

/* ----------------------------- subcomponents ----------------------------- */

type Shot = { url: string; timeframe: string; description: string | null };

function ScreenshotLayout({
  shots,
  onOpen,
}: {
  shots: Shot[];
  onOpen: (i: number) => void;
}) {
  if (!shots.length) return null;

  // Adaptive grid: keep cards from feeling empty when there are 1–3 screenshots.
  // - 1 shot: full-width hero
  // - 2 shots: two side-by-side (stack on mobile)
  // - 3 shots: hero on top, two below
  // - 4+ shots: even 2-column grid

  if (shots.length === 1) {
    return (
      <div className="bg-border">
        <ShotFigure shot={shots[0]} index={0} aspect="aspect-[16/10]" onOpen={() => onOpen(0)} total={1} />
      </div>
    );
  }

  if (shots.length === 2) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
        {shots.map((s, i) => (
          <ShotFigure key={i} shot={s} index={i} aspect="aspect-[16/10]" onOpen={() => onOpen(i)} total={2} />
        ))}
      </div>
    );
  }

  if (shots.length === 3) {
    return (
      <div className="grid grid-cols-2 gap-px bg-border">
        <div className="col-span-2">
          <ShotFigure shot={shots[0]} index={0} aspect="aspect-[16/9]" onOpen={() => onOpen(0)} total={3} />
        </div>
        <ShotFigure shot={shots[1]} index={1} aspect="aspect-[16/10]" onOpen={() => onOpen(1)} total={3} />
        <ShotFigure shot={shots[2]} index={2} aspect="aspect-[16/10]" onOpen={() => onOpen(2)} total={3} />
      </div>
    );
  }

  // 4+
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
      {shots.map((s, i) => (
        <ShotFigure key={i} shot={s} index={i} aspect="aspect-[16/10]" onOpen={() => onOpen(i)} total={shots.length} />
      ))}
    </div>
  );
}

function ShotFigure({
  shot,
  index,
  aspect,
  onOpen,
  total,
}: {
  shot: Shot;
  index: number;
  aspect: string;
  onOpen: () => void;
  total: number;
}) {
  return (
    <figure className="bg-card">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "relative bg-muted/40 w-full block group cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          aspect,
        )}
        aria-label={`Open screenshot ${index + 1} of ${total}${shot.timeframe ? ` (${shot.timeframe})` : ""}`}
      >
        <img
          src={shot.url}
          alt={shot.description || shot.timeframe || `Screenshot ${index + 1}`}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {shot.timeframe && (
          <Badge className="absolute top-3 left-3 font-mono text-[11px] bg-background/85 text-foreground border border-border">
            {shot.timeframe}
          </Badge>
        )}
        <div className="absolute inset-0 bg-background/0 group-hover:bg-background/20 transition-colors flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-background/90 rounded-full p-2.5 border border-border shadow-lg">
            <ZoomIn className="w-5 h-5 text-foreground" />
          </div>
        </div>
      </button>
      {shot.description && (
        <figcaption className="px-4 py-3 text-sm text-muted-foreground italic leading-relaxed border-t border-border/50">
          {shot.description}
        </figcaption>
      )}
    </figure>
  );
}

const TONE_BG: Record<"success" | "destructive" | "warning", string> = {
  success: "bg-success/[0.06] border-success/20",
  destructive: "bg-destructive/[0.06] border-destructive/20",
  warning: "bg-warning/[0.06] border-warning/20",
};

function CaptionRow({
  icon,
  label,
  text,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  text: string;
  tone: "success" | "destructive" | "warning";
}) {
  return (
    <div className={cn("flex gap-4 items-start rounded-lg border p-4 md:p-5", TONE_BG[tone])}>
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold tracking-widest text-muted-foreground uppercase mb-1.5">{label}</div>
        <p className="text-base text-foreground/90 leading-relaxed whitespace-pre-line">{text}</p>
      </div>
    </div>
  );
}
