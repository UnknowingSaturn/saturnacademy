import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { usePublicReport } from "@/hooks/useSharedReports";
import { EducationalTradeCard } from "@/components/shared-reports/EducationalTradeCard";
import { Loader2, TrendingUp, AlertCircle } from "lucide-react";
import { format, parseISO, formatDistanceToNow, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";

export default function PublicReport() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading, error } = usePublicReport(slug);

  const report = data?.report;
  const trades = data?.trades || [];
  const isLive = !!report?.live_mode;
  const periodLabel = report?.period_start && report?.period_end
    ? `${format(parseISO(report.period_start), "MMM d")} – ${format(parseISO(report.period_end), "MMM d, yyyy")}`
    : null;
  const liveSinceLabel = report?.live_started_at
    ? `Updated daily since ${format(parseISO(report.live_started_at), "MMM d")}`
    : null;
  const description = report
    ? `${trades.length} ${trades.length === 1 ? "trade" : "trades"}${periodLabel ? ` · ${periodLabel}` : ""}${report.author_display_name ? ` by ${report.author_display_name}` : ""}`
    : "";

  useEffect(() => {
    if (!report) return;
    document.title = report.title;
    const desc = description.slice(0, 160);
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', desc);
  }, [report, description]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data || !report) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="text-center max-w-md">
          <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-xl font-semibold">Report not found</h1>
          <p className="text-sm text-muted-foreground mt-2">
            This shared report may have been unpublished or deleted.
          </p>
        </div>
      </div>
    );
  }

  // Group dateline: only render the date header when this card's day differs
  // from the previous one — keeps a single date when several trades share a day.
  const dayKey = (iso: string | null | undefined) =>
    iso ? format(parseISO(iso), "yyyy-MM-dd") : "";

  const now = Date.now();
  const isRecentlyAdded = (addedAtIso: string | undefined) => {
    if (!addedAtIso || !isLive) return false;
    const t = parseISO(addedAtIso).getTime();
    return Number.isFinite(t) && now - t < 24 * 60 * 60 * 1000;
  };

  return (
    <>
      <div className="min-h-screen bg-background">
        {/* Top bar */}
        <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-6 py-3 flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Ephemeris</span>
            <div className="flex-1" />
            <a href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Build your own →
            </a>
          </div>
        </header>

        <article className="max-w-4xl mx-auto px-6 py-12 space-y-10">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              {periodLabel && (
                <div className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
                  {liveSinceLabel || periodLabel}
                  {report.author_display_name && <> · by {report.author_display_name}</>}
                </div>
              )}
              {isLive && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/10 border border-success/30 text-success text-[11px] font-medium">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                  </span>
                  Live
                  <span className="text-success/70 font-normal tabular-nums">
                    · updated {formatDistanceToNow(parseISO(report.updated_at), { addSuffix: true })}
                  </span>
                </div>
              )}
            </div>
            <h1 className="font-serif text-4xl md:text-5xl font-bold tracking-tight leading-[1.1]">
              {report.title}
            </h1>
            {report.intro && (
              <p className="text-xl leading-relaxed text-foreground/85 whitespace-pre-line pt-2">
                {report.intro}
              </p>
            )}
          </div>

          <hr className="border-border" />

          {trades.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No trades selected for this report.
            </div>
          ) : (
            <div className="space-y-12">
              {trades.map((card, i) => {
                const prev = i > 0 ? trades[i - 1] : null;
                const showDateline =
                  card.entry_time &&
                  (i === 0 || !prev?.entry_time || dayKey(card.entry_time) !== dayKey(prev.entry_time));
                const recentlyAdded = isRecentlyAdded(card.added_at);
                return (
                  <div key={card.id} className="space-y-3">
                    {showDateline && card.entry_time && (
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "text-xs font-semibold tracking-wider uppercase tabular-nums",
                          "text-muted-foreground",
                        )}>
                          {format(parseISO(card.entry_time), "EEE, MMM d")}
                        </div>
                        {recentlyAdded && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-success/10 border border-success/30 text-success text-[10px] font-medium">
                            New
                          </span>
                        )}
                        <div className="flex-1 h-px bg-border" />
                      </div>
                    )}
                    <EducationalTradeCard card={card} index={i} />
                  </div>
                );
              })}
            </div>
          )}

          <footer className="pt-8 border-t border-border text-center text-xs text-muted-foreground">
            <p>Educational content only — not financial advice.</p>
            <p className="mt-1">Built with <a href="/" className="text-primary hover:underline">Ephemeris</a></p>
          </footer>
        </article>
      </div>
    </>
  );
}
