import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSharedReport, useUpdateSharedReport, useAddTradeToReport, useUpdateReportTrade, useRemoveTradeFromReport, useDeleteSharedReport } from "@/hooks/useSharedReports";
import { useTrades } from "@/hooks/useTrades";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Share2, Trash2, Eye, Loader2, Sparkles } from "lucide-react";
import { TradePickerPanel } from "@/components/shared-reports/TradePickerPanel";
import { EducationalTradeCard } from "@/components/shared-reports/EducationalTradeCard";
import { ReportTradeEditor } from "@/components/shared-reports/ReportTradeEditor";
import { ShareDialog } from "@/components/shared-reports/ShareDialog";
import { format, parseISO } from "date-fns";
// Simple inline debounced callback hook
function useDebouncedCallback<T extends (...args: any[]) => void>(fn: T, delay: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  return useCallback((...args: Parameters<T>) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(...args), delay);
  }, [delay]);
}
import { toast } from "sonner";
import type { PublicTradeCard } from "@/types/sharedReports";

export default function SharedReportEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useSharedReport(id || null);
  const { data: allTrades = [] } = useTrades();
  const update = useUpdateSharedReport();
  const addTrade = useAddTradeToReport();
  const updateTrade = useUpdateReportTrade();
  const removeTrade = useRemoveTradeFromReport();
  const del = useDeleteSharedReport();

  const [shareOpen, setShareOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [intro, setIntro] = useState("");
  const [authorName, setAuthorName] = useState("");

  useEffect(() => {
    if (data?.report) {
      setTitle(data.report.title || "");
      setIntro(data.report.intro || "");
      setAuthorName(data.report.author_display_name || "");
    }
  }, [data?.report]);

  const debouncedSave = useDebouncedCallback((patch: any) => {
    if (!id) return;
    update.mutate({ id, patch });
  }, 800);

  const selectedTradeIds = useMemo(
    () => new Set((data?.trades || []).map(t => t.trade_id)),
    [data?.trades],
  );

  const handleAddTrade = (tradeId: string) => {
    if (!id) return;
    const sortOrder = (data?.trades.length || 0);
    addTrade.mutate({ shared_report_id: id, trade_id: tradeId, sort_order: sortOrder });
  };

  const handleRemoveTrade = (tradeId: string) => {
    if (!id || !data) return;
    const link = data.trades.find(t => t.trade_id === tradeId);
    if (link) removeTrade.mutate({ id: link.id, shared_report_id: id });
  };

  const handlePatchTrade = (linkId: string, patch: any) => {
    if (!id) return;
    updateTrade.mutate({ id: linkId, shared_report_id: id, patch });
  };

  const handleMoveCard = (linkId: string, dir: -1 | 1) => {
    if (!id || !data) return;
    const ordered = [...data.trades].sort((a, b) => a.sort_order - b.sort_order);
    const i = ordered.findIndex((l) => l.id === linkId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    ordered.forEach((l, idx) => {
      if (l.sort_order !== idx) {
        updateTrade.mutate({ id: l.id, shared_report_id: id, patch: { sort_order: idx } as any });
      }
    });
  };

  if (isLoading) {
    return <div className="h-full flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>;
  }
  if (!data) {
    return <div className="h-full flex items-center justify-center text-muted-foreground">Report not found.</div>;
  }
  const { report, trades: links } = data;

  // Build educational preview cards from local trade data
  const previewCards: PublicTradeCard[] = links
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(link => {
      const t = allTrades.find(x => x.id === link.trade_id);
      if (!t) return null;
      const review = t.review;
      const rawShots: any[] = Array.isArray(review?.screenshots)
        ? (review!.screenshots as any[]).filter(s => s && typeof s === "object" && (s as any).url)
        : [];
      const screenshots = rawShots.map((s: any) => ({
        url: s.url,
        timeframe: String(s.timeframe || ""),
        description: (link.screenshot_overrides as any[])?.find((o: any) => o.id === s.id)?.description ?? s.description ?? null,
      }));
      const pbName = (t as any).actual_playbook?.name || t.playbook?.name || null;
      return {
        id: t.id,
        symbol: t.symbol,
        direction: t.direction,
        entry_time: t.entry_time,
        session: t.session,
        playbook_name: pbName,
        screenshots,
        caption_what_went_well: link.caption_what_went_well,
        caption_what_went_wrong: link.caption_what_went_wrong,
        caption_what_to_improve: link.caption_what_to_improve,
      } as PublicTradeCard;
    })
    .filter(Boolean) as PublicTradeCard[];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <header className="border-b border-border bg-card px-4 py-3 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate("/shared-reports")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div className="flex-1" />
        {report.published_at && (
          <Badge variant="secondary" className="text-xs">
            <Eye className="w-3 h-3 mr-1" /> {report.view_count} views
          </Badge>
        )}
        <Button variant="outline" size="sm" onClick={() => window.open(`/r/${report.slug}`, "_blank")}>
          <Eye className="w-4 h-4 mr-1" /> Preview
        </Button>
        <Button size="sm" onClick={() => setShareOpen(true)}>
          <Share2 className="w-4 h-4 mr-1" /> Share
        </Button>
        <Button variant="ghost" size="icon" onClick={() => {
          if (confirm("Delete this report?")) {
            del.mutate(report.id);
            navigate("/shared-reports");
          }
        }}>
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </header>

      <div className="flex-1 grid grid-cols-[280px_320px_1fr] overflow-hidden">
        {/* Settings */}
        <ScrollArea className="border-r border-border bg-card">
          <div className="p-4 space-y-4">
            <div className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Report</div>
            <div className="space-y-1.5">
              <Label htmlFor="title" className="text-xs">Title</Label>
              <Input id="title" value={title} onChange={e => { setTitle(e.target.value); debouncedSave({ title: e.target.value }); }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intro" className="text-xs">Intro / weekly preamble</Label>
              <Textarea id="intro" rows={6} value={intro} onChange={e => { setIntro(e.target.value); debouncedSave({ intro: e.target.value }); }} placeholder="Set the scene for this week's trades…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="author" className="text-xs">Display name (public)</Label>
              <Input id="author" value={authorName} onChange={e => { setAuthorName(e.target.value); debouncedSave({ author_display_name: e.target.value }); }} placeholder="e.g. @yourname" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">From</Label>
                <Input type="date" value={report.period_start || ""} onChange={e => debouncedSave({ period_start: e.target.value || null })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">To</Label>
                <Input type="date" value={report.period_end || ""} onChange={e => debouncedSave({ period_end: e.target.value || null })} />
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground italic border-t border-border pt-3">
              Public viewers see only: pair, direction, entry time, session, playbook, screenshots, and your captions. Dollar amounts, lot sizes, R-multiples, and balances are never exposed.
            </div>
          </div>
        </ScrollArea>

        {/* Trade picker */}
        <TradePickerPanel
          selectedTradeIds={selectedTradeIds}
          onAddTrade={handleAddTrade}
          onRemoveTrade={handleRemoveTrade}
        />

        {/* Preview + caption editor */}
        <ScrollArea className="bg-background">
          <div className="max-w-3xl mx-auto p-6 space-y-6">
            <div className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
              Live preview
            </div>
            <h1 className="font-serif text-3xl font-bold tracking-tight">{title || "Untitled report"}</h1>
            {(report.period_start || report.period_end) && (
              <div className="text-xs text-muted-foreground tabular-nums">
                {report.period_start && format(parseISO(report.period_start), "MMM d")}
                {report.period_start && report.period_end && " – "}
                {report.period_end && format(parseISO(report.period_end), "MMM d, yyyy")}
                {authorName && ` · by ${authorName}`}
              </div>
            )}
            {intro && (
              <p className="text-base leading-relaxed text-foreground/90 whitespace-pre-line border-l-4 border-primary/40 pl-4">
                {intro}
              </p>
            )}

            {previewCards.length === 0 ? (
              <div className="text-center py-16 px-4 border-2 border-dashed border-border rounded-lg">
                <Sparkles className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">Pick trades from the middle panel to start.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {previewCards.map((card, i) => {
                  const link = links.find(l => l.trade_id === card.id);
                  if (!link) return null;
                  return (
                    <div key={card.id} className="space-y-3">
                      <EducationalTradeCard card={card} index={i} />
                      <div className="space-y-2 pl-4 border-l-2 border-border ml-2">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Captions</div>
                          <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive hover:text-destructive" onClick={() => handleRemoveTrade(card.id)}>
                            <X className="w-3 h-3 mr-1" /> Remove
                          </Button>
                        </div>
                        <CaptionInput
                          value={link.caption_what_went_well || ""}
                          placeholder="What went well…"
                          onChange={(v) => handleCaptionChange(link.id, "caption_what_went_well", v)}
                        />
                        <CaptionInput
                          value={link.caption_what_went_wrong || ""}
                          placeholder="What went wrong…"
                          onChange={(v) => handleCaptionChange(link.id, "caption_what_went_wrong", v)}
                        />
                        <CaptionInput
                          value={link.caption_what_to_improve || ""}
                          placeholder="What to improve…"
                          onChange={(v) => handleCaptionChange(link.id, "caption_what_to_improve", v)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} report={report} />
    </div>
  );
}

function CaptionInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  const debounced = useDebouncedCallback((v: string) => onChange(v), 600);
  useEffect(() => setLocal(value), [value]);
  return (
    <Textarea
      value={local}
      onChange={e => { setLocal(e.target.value); debounced(e.target.value); }}
      placeholder={placeholder}
      rows={2}
      className="text-sm resize-none"
    />
  );
}
