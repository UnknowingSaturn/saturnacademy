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
import { ArrowLeft, Share2, Trash2, Eye, Loader2, Sparkles, RotateCcw, Radio } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { TradePickerPanel } from "@/components/shared-reports/TradePickerPanel";
import { EducationalTradeCard } from "@/components/shared-reports/EducationalTradeCard";
import { ReportTradeEditor } from "@/components/shared-reports/ReportTradeEditor";
import { ShareDialog } from "@/components/shared-reports/ShareDialog";
import {
  format,
  parseISO,
  isSameDay,
  isSameMonth,
  isSameWeek,
  startOfWeek,
  endOfWeek,
  differenceInCalendarDays,
  formatDistanceToNow,
} from "date-fns";
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

// Build an auto title from a [start, end] date range derived from the picked trades.
function buildAutoTitle(start: Date | null, end: Date | null): string {
  if (!start || !end) return "Untitled report";
  if (isSameDay(start, end)) {
    return `Daily recap — ${format(start, "MMM d, yyyy")}`;
  }
  // Same Monday-week
  if (isSameWeek(start, end, { weekStartsOn: 1 })) {
    const ws = startOfWeek(start, { weekStartsOn: 1 });
    const we = endOfWeek(start, { weekStartsOn: 1 });
    // Only call it a "Week of" if the picks roughly span the full week, otherwise show a tight range
    if (
      differenceInCalendarDays(start, ws) <= 1 &&
      differenceInCalendarDays(we, end) <= 1
    ) {
      return `Week of ${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`;
    }
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }
  if (isSameMonth(start, end)) {
    // Spans most of a single month → "April 2026 recap"
    const span = differenceInCalendarDays(end, start);
    if (span >= 14) return `${format(start, "MMMM yyyy")} recap`;
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }
  return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
}

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

  // Bulk add/remove (used by trade picker "Select all visible")
  const handleBulkAdd = (tradeIds: string[]) => {
    if (!id || !data) return;
    let sort = data.trades.length;
    for (const tradeId of tradeIds) {
      if (selectedTradeIds.has(tradeId)) continue;
      addTrade.mutate({ shared_report_id: id, trade_id: tradeId, sort_order: sort++ });
    }
  };
  const handleBulkRemove = (tradeIds: string[]) => {
    if (!id || !data) return;
    for (const tradeId of tradeIds) {
      const link = data.trades.find(t => t.trade_id === tradeId);
      if (link) removeTrade.mutate({ id: link.id, shared_report_id: id });
    }
  };

  // Override-dates toggle: when off, From/To are auto-derived from picks and read-only.
  const [overrideDates, setOverrideDates] = useState(false);

  // Compute date range derived from currently picked trades' entry_time.
  const pickedDateRange = useMemo<{ start: Date | null; end: Date | null }>(() => {
    const times: number[] = [];
    for (const link of (data?.trades || [])) {
      const t = allTrades.find(x => x.id === link.trade_id);
      const iso = (link as any).entry_time_override ?? t?.entry_time;
      if (iso) {
        const d = parseISO(iso);
        if (!isNaN(d.getTime())) times.push(d.getTime());
      }
    }
    if (!times.length) return { start: null, end: null };
    return { start: new Date(Math.min(...times)), end: new Date(Math.max(...times)) };
  }, [data?.trades, allTrades]);

  // Auto-sync period_start / period_end to picked range (unless user is overriding dates).
  useEffect(() => {
    if (!data?.report || overrideDates) return;
    const { start, end } = pickedDateRange;
    const newStart = start ? format(start, "yyyy-MM-dd") : null;
    const newEnd = end ? format(end, "yyyy-MM-dd") : null;
    const patch: any = {};
    if ((data.report.period_start || null) !== newStart) patch.period_start = newStart;
    if ((data.report.period_end || null) !== newEnd) patch.period_end = newEnd;
    if (Object.keys(patch).length) debouncedSave(patch);
  }, [pickedDateRange, overrideDates, data?.report, debouncedSave]);

  // Auto-sync title from picked range when auto_title flag is true.
  useEffect(() => {
    if (!data?.report) return;
    if (data.report.auto_title === false) return;
    const { start, end } = pickedDateRange;
    if (!start || !end) return;
    const next = buildAutoTitle(start, end);
    if (next !== title) {
      setTitle(next);
      debouncedSave({ title: next });
    }
  }, [pickedDateRange, data?.report, debouncedSave]); // eslint-disable-line react-hooks/exhaustive-deps

  const isAutoTitle = data?.report?.auto_title !== false;
  const handleTitleChange = (val: string) => {
    setTitle(val);
    // First user edit flips auto_title off
    debouncedSave({ title: val, auto_title: false });
  };
  const handleResetAutoTitle = () => {
    const { start, end } = pickedDateRange;
    const next = start && end ? buildAutoTitle(start, end) : "Untitled report";
    setTitle(next);
    debouncedSave({ title: next, auto_title: true });
  };

  if (isLoading) {
    return <div className="h-full flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>;
  }
  if (!data) {
    return <div className="h-full flex items-center justify-center text-muted-foreground">Report not found.</div>;
  }
  const { report, trades: links } = data;

  // Build educational preview cards from local trade data, applying overrides
  const previewCards: Array<{ card: PublicTradeCard; link: typeof links[number]; sourceShots: any[]; liveTrade: any }> = links
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(link => {
      const t = allTrades.find(x => x.id === link.trade_id);
      if (!t) return null;
      const review = t.review;
      const rawShots: any[] = Array.isArray(review?.screenshots)
        ? (review!.screenshots as any[]).filter(s => s && typeof s === "object" && (s as any).url)
        : [];
      const overrides = (link.screenshot_overrides as any[]) || [];
      const screenshots = rawShots
        .map((s: any, idx: number) => {
          const ov = overrides.find((o: any) => o.id === s.id) || {};
          return {
            url: s.url,
            timeframe: String(ov.timeframe ?? s.timeframe ?? ""),
            description: ov.description ?? s.description ?? null,
            _hidden: !!ov.hidden,
            _sortIndex: typeof ov.sort_index === "number" ? ov.sort_index : 1000 + idx,
          };
        })
        .filter((s: any) => !s._hidden)
        .sort((a: any, b: any) => a._sortIndex - b._sortIndex)
        .map(({ url, timeframe, description }: any) => ({ url, timeframe, description }));
      const livePbName = (t as any).actual_playbook?.name || t.playbook?.name || null;
      const card: PublicTradeCard = {
        id: t.id,
        symbol: (link as any).symbol_override ?? t.symbol,
        direction: (link as any).direction_override ?? t.direction,
        entry_time: (link as any).entry_time_override ?? t.entry_time,
        session: (link as any).session_override ?? t.session,
        playbook_name: (link as any).playbook_name_override ?? livePbName,
        screenshots,
        caption_what_went_well: link.caption_what_went_well,
        caption_what_went_wrong: link.caption_what_went_wrong,
        caption_what_to_improve: link.caption_what_to_improve,
        added_at: link.created_at,
      };
      return { card, link, sourceShots: rawShots, liveTrade: t };
    })
    .filter(Boolean) as any;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <header className="border-b border-border bg-card px-4 py-3 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate("/shared-reports")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        {report.live_mode && (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-success/10 border border-success/30 text-success text-[11px] font-medium">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
            </span>
            Live
            {report.published_at && (
              <span className="text-success/70 font-normal tabular-nums">
                · edited {formatDistanceToNow(parseISO(report.updated_at), { addSuffix: true })}
              </span>
            )}
          </div>
        )}
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
              <div className="flex items-center justify-between">
                <Label htmlFor="title" className="text-xs flex items-center gap-1.5">
                  Title
                  {isAutoTitle && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 font-normal">
                      Auto
                    </Badge>
                  )}
                </Label>
                {!isAutoTitle && pickedDateRange.start && (
                  <button
                    type="button"
                    onClick={handleResetAutoTitle}
                    className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                    title="Reset to auto-generated title"
                  >
                    <RotateCcw className="w-3 h-3" /> Auto
                  </button>
                )}
              </div>
              <Input id="title" value={title} onChange={e => handleTitleChange(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intro" className="text-xs">Intro / weekly preamble</Label>
              <Textarea id="intro" rows={6} value={intro} onChange={e => { setIntro(e.target.value); debouncedSave({ intro: e.target.value }); }} placeholder="Set the scene for this week's trades…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="author" className="text-xs">Display name (public)</Label>
              <Input id="author" value={authorName} onChange={e => { setAuthorName(e.target.value); debouncedSave({ author_display_name: e.target.value }); }} placeholder="e.g. @yourname" />
            </div>

            {/* Period — auto-derived from picks unless overridden */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Period</Label>
                <button
                  type="button"
                  onClick={() => setOverrideDates(v => !v)}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {overrideDates ? "Use auto" : "Override dates"}
                </button>
              </div>
              {overrideDates ? (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="date"
                    value={report.period_start || ""}
                    onChange={e => debouncedSave({ period_start: e.target.value || null })}
                  />
                  <Input
                    type="date"
                    value={report.period_end || ""}
                    onChange={e => debouncedSave({ period_end: e.target.value || null })}
                  />
                </div>
              ) : (
                <div className="text-xs text-muted-foreground tabular-nums px-3 py-2 rounded-md border border-dashed border-border bg-muted/30">
                  {pickedDateRange.start && pickedDateRange.end ? (
                    isSameDay(pickedDateRange.start, pickedDateRange.end) ? (
                      format(pickedDateRange.start, "MMM d, yyyy")
                    ) : (
                      <>
                        {format(pickedDateRange.start, "MMM d")}
                        {" – "}
                        {format(pickedDateRange.end, "MMM d, yyyy")}
                      </>
                    )
                  ) : (
                    <span className="italic">Pick trades to set the period</span>
                  )}
                </div>
              )}
            </div>

            {/* Live updates toggle */}
            <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <Label className="text-xs flex items-center gap-1.5 cursor-pointer">
                    <Radio className="w-3.5 h-3.5 text-success" />
                    Live updates
                  </Label>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Keep adding trades after publishing — viewers see updates instantly.
                  </p>
                </div>
                <Switch
                  checked={!!report.live_mode}
                  onCheckedChange={(v) => update.mutate({ id: report.id, patch: { live_mode: v } as any })}
                />
              </div>
              {report.live_mode && report.live_started_at && (
                <div className="text-[11px] text-success/80 tabular-nums">
                  Live since {format(parseISO(report.live_started_at), "MMM d, HH:mm")}
                </div>
              )}
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
          onBulkAdd={handleBulkAdd}
          onBulkRemove={handleBulkRemove}
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
                {previewCards.map(({ card, link, sourceShots, liveTrade }, i) => {
                  const livePbName = (liveTrade as any).actual_playbook?.name || liveTrade.playbook?.name || null;
                  return (
                    <div key={card.id} className="space-y-3">
                      <EducationalTradeCard card={card} index={i} />
                      <ReportTradeEditor
                        link={link}
                        liveSymbol={liveTrade.symbol}
                        liveDirection={liveTrade.direction}
                        liveEntryTime={liveTrade.entry_time}
                        liveSession={liveTrade.session ?? null}
                        livePlaybookName={livePbName}
                        sourceScreenshots={sourceShots}
                        index={i}
                        total={previewCards.length}
                        onMoveUp={() => handleMoveCard(link.id, -1)}
                        onMoveDown={() => handleMoveCard(link.id, 1)}
                        onRemove={() => handleRemoveTrade(card.id)}
                        onPatch={(patch) => handlePatchTrade(link.id, patch)}
                      />
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

