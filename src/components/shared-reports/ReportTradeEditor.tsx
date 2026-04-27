import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  X,
  RotateCcw,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Pencil,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { SharedReportTrade, ScreenshotOverride } from "@/types/sharedReports";
import type { TradeScreenshot } from "@/types/trading";

interface Props {
  link: SharedReportTrade;
  // Live trade data — used for fallbacks and "reset" actions
  liveSymbol: string;
  liveDirection: string;
  liveEntryTime: string;
  liveSession: string | null;
  livePlaybookName: string | null;
  // Source screenshots (from the trade's review)
  sourceScreenshots: TradeScreenshot[];
  // Position controls
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  // Update handlers
  onPatch: (patch: Partial<SharedReportTrade>) => void;
}

export function ReportTradeEditor({
  link,
  liveSymbol,
  liveDirection,
  liveEntryTime,
  liveSession,
  livePlaybookName,
  sourceScreenshots,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onRemove,
  onPatch,
}: Props) {
  const [headerOpen, setHeaderOpen] = useState(false);
  const [shotsOpen, setShotsOpen] = useState(false);

  // Local debounced text fields for captions to avoid typing lag
  const [well, setWell] = useState(link.caption_what_went_well || "");
  const [wrong, setWrong] = useState(link.caption_what_went_wrong || "");
  const [improve, setImprove] = useState(link.caption_what_to_improve || "");
  useEffect(() => setWell(link.caption_what_went_well || ""), [link.caption_what_went_well]);
  useEffect(() => setWrong(link.caption_what_went_wrong || ""), [link.caption_what_went_wrong]);
  useEffect(() => setImprove(link.caption_what_to_improve || ""), [link.caption_what_to_improve]);

  const overrides: ScreenshotOverride[] = Array.isArray(link.screenshot_overrides)
    ? link.screenshot_overrides
    : [];

  // Effective screenshot list with overrides applied + sort
  const effectiveShots = useMemo(() => {
    const items = sourceScreenshots
      .filter((s) => s && s.url)
      .map((s, idx) => {
        const ov = overrides.find((o) => o.id === s.id) || ({} as ScreenshotOverride);
        return {
          id: s.id,
          url: s.url,
          timeframe: (ov.timeframe ?? s.timeframe ?? "") as string,
          description: (ov.description ?? s.description ?? "") as string,
          hidden: !!ov.hidden,
          sortIndex: typeof ov.sort_index === "number" ? ov.sort_index : 1000 + idx,
          source: s,
        };
      });
    items.sort((a, b) => a.sortIndex - b.sortIndex);
    return items;
  }, [sourceScreenshots, overrides]);

  const updateScreenshotOverride = (id: string, patch: Partial<ScreenshotOverride>) => {
    const next = [...overrides];
    const i = next.findIndex((o) => o.id === id);
    if (i === -1) {
      next.push({ id, ...patch });
    } else {
      next[i] = { ...next[i], ...patch };
    }
    onPatch({ screenshot_overrides: next });
  };

  const moveShot = (id: string, dir: -1 | 1) => {
    const ordered = [...effectiveShots];
    const i = ordered.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    // Renumber sort indices for all shots so order is stable
    const next = [...overrides];
    ordered.forEach((s, idx) => {
      const k = next.findIndex((o) => o.id === s.id);
      if (k === -1) next.push({ id: s.id, sort_index: idx });
      else next[k] = { ...next[k], sort_index: idx };
    });
    onPatch({ screenshot_overrides: next });
  };

  const resetField = (field: keyof SharedReportTrade) => {
    onPatch({ [field]: null } as any);
  };

  const headerHasOverrides =
    !!link.symbol_override ||
    !!link.direction_override ||
    !!link.entry_time_override ||
    !!link.session_override ||
    !!link.playbook_name_override;

  const shotsHaveOverrides = overrides.length > 0;

  // Format the entry_time override value for the datetime-local input
  const entryTimeInputValue = link.entry_time_override
    ? format(parseISO(link.entry_time_override), "yyyy-MM-dd'T'HH:mm")
    : "";

  return (
    <div className="space-y-2 pl-4 border-l-2 border-border ml-2">
      {/* Position controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={index === 0}
            onClick={onMoveUp}
            aria-label="Move up"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={index === total - 1}
            onClick={onMoveDown}
            aria-label="Move down"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </Button>
          <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase ml-1">
            #{index + 1}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <X className="w-3 h-3 mr-1" /> Remove
        </Button>
      </div>

      {/* Header overrides */}
      <Collapsible open={headerOpen} onOpenChange={setHeaderOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 text-xs w-full justify-between font-semibold">
            <span className="flex items-center gap-1.5">
              <Pencil className="w-3 h-3" /> Header
              {headerHasOverrides && (
                <Badge variant="outline" className="text-[9px] h-4 px-1 border-primary/40 text-primary">edited</Badge>
              )}
            </span>
            {headerOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <div className="grid grid-cols-2 gap-2">
            <FieldWithReset
              label="Symbol"
              fallback={liveSymbol}
              value={link.symbol_override ?? ""}
              onChange={(v) => onPatch({ symbol_override: v || null })}
              onReset={() => resetField("symbol_override")}
            />
            <FieldWithReset
              label="Direction"
              fallback={liveDirection}
              value={link.direction_override ?? ""}
              onChange={(v) => onPatch({ direction_override: v || null })}
              onReset={() => resetField("direction_override")}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FieldWithReset
              label="Session"
              fallback={liveSession || "—"}
              value={link.session_override ?? ""}
              onChange={(v) => onPatch({ session_override: v || null })}
              onReset={() => resetField("session_override")}
            />
            <FieldWithReset
              label="Playbook"
              fallback={livePlaybookName || "—"}
              value={link.playbook_name_override ?? ""}
              onChange={(v) => onPatch({ playbook_name_override: v || null })}
              onReset={() => resetField("playbook_name_override")}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Entry time
                <span className="text-[9px] normal-case font-normal text-muted-foreground/70 ml-1">
                  (live: {format(parseISO(liveEntryTime), "MMM d, HH:mm")})
                </span>
              </Label>
              {link.entry_time_override && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => resetField("entry_time_override")}
                  aria-label="Reset entry time"
                >
                  <RotateCcw className="w-3 h-3" />
                </Button>
              )}
            </div>
            <Input
              type="datetime-local"
              value={entryTimeInputValue}
              onChange={(e) =>
                onPatch({
                  entry_time_override: e.target.value
                    ? new Date(e.target.value).toISOString()
                    : null,
                })
              }
              className="h-8 text-xs"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Screenshot overrides */}
      {sourceScreenshots.length > 0 && (
        <Collapsible open={shotsOpen} onOpenChange={setShotsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-xs w-full justify-between font-semibold">
              <span className="flex items-center gap-1.5">
                <ImageIcon className="w-3 h-3" /> Screenshots ({effectiveShots.filter((s) => !s.hidden).length}/{effectiveShots.length})
                {shotsHaveOverrides && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1 border-primary/40 text-primary">edited</Badge>
                )}
              </span>
              {shotsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            {effectiveShots.map((shot, i) => (
              <div
                key={shot.id}
                className={cn(
                  "rounded-md border border-border bg-background/50 p-2 space-y-2",
                  shot.hidden && "opacity-50",
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="w-16 h-10 rounded bg-muted overflow-hidden shrink-0 border border-border">
                    <img
                      src={shot.url}
                      alt={shot.description || shot.timeframe || "Screenshot"}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-1">
                      <Input
                        value={shot.timeframe}
                        onChange={(e) =>
                          updateScreenshotOverride(shot.id, {
                            timeframe: e.target.value,
                          })
                        }
                        placeholder="Timeframe"
                        className="h-6 text-[11px] font-mono w-20"
                      />
                      <div className="flex-1" />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={i === 0}
                        onClick={() => moveShot(shot.id, -1)}
                        aria-label="Move screenshot up"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={i === effectiveShots.length - 1}
                        onClick={() => moveShot(shot.id, 1)}
                        aria-label="Move screenshot down"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => updateScreenshotOverride(shot.id, { hidden: !shot.hidden })}
                        aria-label={shot.hidden ? "Show in report" : "Hide from report"}
                      >
                        {shot.hidden ? (
                          <EyeOff className="w-3 h-3 text-destructive" />
                        ) : (
                          <Eye className="w-3 h-3" />
                        )}
                      </Button>
                    </div>
                    <Textarea
                      value={shot.description}
                      onChange={(e) =>
                        updateScreenshotOverride(shot.id, {
                          description: e.target.value,
                        })
                      }
                      placeholder="Caption for this screenshot…"
                      rows={2}
                      className="text-xs resize-none"
                    />
                  </div>
                </div>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Captions */}
      <div className="space-y-1.5 pt-1">
        <div className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Captions</div>
        <Textarea
          value={well}
          onChange={(e) => {
            setWell(e.target.value);
            onPatch({ caption_what_went_well: e.target.value });
          }}
          placeholder="What went well…"
          rows={2}
          className="text-sm resize-none"
        />
        <Textarea
          value={wrong}
          onChange={(e) => {
            setWrong(e.target.value);
            onPatch({ caption_what_went_wrong: e.target.value });
          }}
          placeholder="What went wrong…"
          rows={2}
          className="text-sm resize-none"
        />
        <Textarea
          value={improve}
          onChange={(e) => {
            setImprove(e.target.value);
            onPatch({ caption_what_to_improve: e.target.value });
          }}
          placeholder="What to improve…"
          rows={2}
          className="text-sm resize-none"
        />
      </div>
    </div>
  );
}

function FieldWithReset({
  label,
  fallback,
  value,
  onChange,
  onReset,
}: {
  label: string;
  fallback: string;
  value: string;
  onChange: (v: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </Label>
        {value && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={onReset}
            aria-label={`Reset ${label}`}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        )}
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={fallback}
        className="h-8 text-xs"
      />
    </div>
  );
}
