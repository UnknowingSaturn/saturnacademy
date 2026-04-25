import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { usePublicReport } from "@/hooks/useSharedReports";
import { EducationalTradeCard } from "@/components/shared-reports/EducationalTradeCard";
import { Loader2, TrendingUp, AlertCircle } from "lucide-react";
import { format, parseISO } from "date-fns";

export default function PublicReport() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading, error } = usePublicReport(slug);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
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

  const { report, trades } = data;
  const periodLabel = report.period_start && report.period_end
    ? `${format(parseISO(report.period_start), "MMM d")} – ${format(parseISO(report.period_end), "MMM d, yyyy")}`
    : null;
  const description = `${trades.length} ${trades.length === 1 ? "trade" : "trades"}${periodLabel ? ` · ${periodLabel}` : ""}${report.author_display_name ? ` by ${report.author_display_name}` : ""}`;

  useEffect(() => {
    document.title = report.title;
    const desc = description.slice(0, 160);
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', desc);
  }, [report.title, description]);

  return (
    <>
      <div className="min-h-screen bg-background">
        {/* Top bar */}
        <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-3xl mx-auto px-6 py-3 flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold tracking-tight">TradeLog</span>
            <div className="flex-1" />
            <a href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Build your own →
            </a>
          </div>
        </header>

        <article className="max-w-3xl mx-auto px-6 py-12 space-y-8">
          <div className="space-y-3">
            {periodLabel && (
              <div className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
                {periodLabel}
                {report.author_display_name && <> · by {report.author_display_name}</>}
              </div>
            )}
            <h1 className="font-serif text-4xl md:text-5xl font-bold tracking-tight leading-tight">
              {report.title}
            </h1>
            {report.intro && (
              <p className="text-lg leading-relaxed text-foreground/85 whitespace-pre-line pt-2">
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
            <div className="space-y-8">
              {trades.map((card, i) => (
                <EducationalTradeCard key={card.id} card={card} index={i} />
              ))}
            </div>
          )}

          <footer className="pt-8 border-t border-border text-center text-xs text-muted-foreground">
            <p>Educational content only — not financial advice.</p>
            <p className="mt-1">Built with <a href="/" className="text-primary hover:underline">TradeLog</a></p>
          </footer>
        </article>
      </div>
    </>
  );
}
