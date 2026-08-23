import { useMemo, useState } from "react";
import { Trade } from "@/types/trading";
import { cn } from "@/lib/utils";
import { FieldDef, FieldValueType } from "./registry";
import { readFieldValue, resolveDisplay } from "./resolve";
import { BadgeSelect } from "@/components/journal/BadgeSelect";
import { CustomFieldCell } from "@/components/journal/CustomFieldCell";
import { Input } from "@/components/ui/input";
import { useAccounts } from "@/hooks/useAccounts";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { usePropertyOptions, useSessionLookup } from "@/hooks/useUserSettings";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { useUpdateTrade, useUpsertTradeReview } from "@/hooks/useTrades";
import { formatDateET, formatTimeET, getDayNameET } from "@/lib/time";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Lightbulb, FileText, Clock, Layers, RefreshCw, Wrench } from "lucide-react";
import { getRealPartialCloses } from "@/lib/tradeMath";

interface FieldCellProps {
  field: FieldDef;
  trade: Trade;
  surface: "table" | "detail";
  /** Optional list of trade ids in the same group. When provided, edits apply to all legs. */
  legIds?: string[];
  accounts?: import("@/types/trading").Account[];
  playbooks?: import("@/types/trading").Playbook[];
  /** Passed in from TradeTable context to render group/leg expand info. */
  isGroup?: boolean;
  legs?: Trade[];
  isExpanded?: boolean;
  toggleExpand?: () => void;
  /** Resolved (user-renamed) label. Falls back to the registry default. */
  label?: string;
}

export function FieldCell({
  field,
  trade,
  surface,
  legIds,
  accounts,
  playbooks,
  isGroup,
  legs,
  isExpanded,
  toggleExpand,
  label,
}: FieldCellProps) {
  // RenderKey overrides are for complex cells that cannot be inferred from valueType.
  if (field.renderKey) {
    return (
      <SpecialCell
        renderKey={field.renderKey}
        field={field}
        trade={trade}
        surface={surface}
        isGroup={isGroup}
        legs={legs}
        isExpanded={isExpanded}
        toggleExpand={toggleExpand}
      />
    );
  }

  const valueType = field.editor ?? field.valueType;

  if (valueType === "account") {
    return <AccountCell field={field} trade={trade} surface={surface} accounts={accounts} legIds={legIds} />;
  }

  if (valueType === "playbook") {
    return <PlaybookCell field={field} trade={trade} surface={surface} playbooks={playbooks} legIds={legIds} />;
  }

  if (valueType === "select" || valueType === "multi_select") {
    return <SelectCell field={field} trade={trade} surface={surface} legIds={legIds} label={label} />;
  }

  if (valueType === "text") {
    return <TextCell field={field} trade={trade} surface={surface} legIds={legIds} />;
  }

  if (valueType === "date") {
    return <DateCell trade={trade} />;
  }

  if (valueType === "duration") {
    return <DurationCell trade={trade} field={field} />;
  }

  // Readonly / computed / badge / money / percent / number
  const { display } = resolveDisplay(trade, field);
  const alignClass = cn(
    field.alignRight && "text-right",
    field.alignCenter && "text-center",
    (field.valueType === "money" || field.valueType === "number" || field.valueType === "percent") && "font-mono-numbers"
  );
  const colorClass = useNumberColorClass(trade, field, readFieldValue(trade, field));

  return (
    <div className={cn("text-sm", alignClass, colorClass)}>
      {display ?? "—"}
    </div>
  );
}

function useNumberColorClass(trade: Trade, field: FieldDef, raw: unknown): string {
  if (field.valueType === "money" || field.valueType === "number" || field.valueType === "percent") {
    const n = Number(raw);
    if (n > 0) return "text-profit";
    if (n < 0) return "text-loss";
  }
  return "";
}

function DateCell({ trade }: { trade: Trade }) {
  return (
    <div className="text-sm">
      <div className="font-medium">{formatDateET(trade.entry_time)}</div>
      <div className="text-xs text-muted-foreground">{formatTimeET(trade.entry_time)}</div>
    </div>
  );
}

function DurationCell({ trade, field }: { trade: Trade; field: FieldDef }) {
  const raw = readFieldValue(trade, field);
  const duration = Number(raw);
  if (!duration) return <div className="text-sm text-muted-foreground">—</div>;
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  return (
    <div className="text-sm text-muted-foreground">
      {hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`}
    </div>
  );
}

function CustomFieldCellWrapper({ trade, fieldKey }: { trade: Trade; fieldKey: string }) {
  const { data: customFields = [] } = useCustomFieldDefinitions();
  const def = customFields.find((f) => f.key === fieldKey);
  if (!def) return <div className="text-sm text-muted-foreground">—</div>;
  return <CustomFieldCell trade={trade} field={def} />;
}

function useLegMutate<T extends (args: any) => Promise<any>>(
  mutate: T,
  legIds?: string[]
): (args: any) => Promise<any> {
  return useMemo(() => {
    if (!legIds || legIds.length === 0) return mutate;
    return async (args: any) => {
      // Review payloads target trade_reviews via `review.trade_id`; trade
      // payloads target `trades.id`. Rewriting the wrong key silently wrote
      // the leader's row N times instead of one row per leg.
      if (args && typeof args === "object" && args.review) {
        const { review, ...rest } = args;
        return Promise.all(
          legIds.map((lid) => mutate({ ...rest, review: { ...review, trade_id: lid } } as any)),
        );
      }
      const { id, ...patch } = args;
      return Promise.all(legIds.map((lid) => mutate({ id: lid, ...patch } as any)));
    };
  }, [mutate, legIds]);
}


function AccountCell({
  field,
  trade,
  surface,
  accounts,
  legIds,
}: {
  field: FieldDef;
  trade: Trade;
  surface: "table" | "detail";
  accounts?: import("@/types/trading").Account[];
  legIds?: string[];
}) {
  const { data: accountsData } = useAccounts();
  const accountList = accounts ?? accountsData ?? [];
  const account = accountList.find((a) => a.id === trade.account_id);
  const updateTrade = useUpdateTrade();
  const mutate = useLegMutate(updateTrade.mutateAsync, legIds);
  const pending = trade.is_open && account?.live_state === "dormant";

  if (surface === "detail") {
    const options = accountList.map((a) => ({ value: a.id, label: a.name, color: "primary" as const }));
    return (
      <div className="text-sm">
        {trade.ticket ? (
          <span className="text-muted-foreground">{account?.name ?? "—"}</span>
        ) : (
          <BadgeSelect
            value={trade.account_id || ""}
            onChange={(v) => mutate({ id: trade.id, account_id: (v as string) || null } as any)}
            options={options}
            placeholder="Select..."
          />
        )}
      </div>
    );
  }

  return (
    <div className="text-sm text-muted-foreground truncate flex items-center gap-1.5">
      <span className="truncate">{account?.name ?? "—"}</span>
      {pending && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 whitespace-nowrap">
                ⏸ Pending verification
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-xs">
                No EA heartbeat for this account. Log into <strong>{account?.name}</strong> in MT5 to confirm or close this position.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

function PlaybookCell({
  field,
  trade,
  surface,
  playbooks,
  legIds,
}: {
  field: FieldDef;
  trade: Trade;
  surface: "table" | "detail";
  playbooks?: import("@/types/trading").Playbook[];
  legIds?: string[];
}) {
  const { data: playbooksData } = usePlaybooks();
  const list = playbooks ?? playbooksData ?? [];
  const updateTrade = useUpdateTrade();
  const upsertReview = useUpsertTradeReview();
  const mutate = useLegMutate(updateTrade.mutateAsync, legIds);

  const column = field.source.kind === "trades" ? field.source.column : null;
  const value = column ? (trade as any)[column] : null;
  const options = list.map((pb) => ({
    value: pb.id,
    label: pb.name,
    customColor: pb.color || undefined,
    color: "primary" as const,
  }));

  const handleChange = async (v: string) => {
    const playbookId = v || null;
    if (column === "playbook_id") {
      await mutate({ id: trade.id, playbook_id: playbookId } as any);
      const selected = list.find((p) => p.id === playbookId);
      if (selected?.valid_regimes?.length === 1 && !trade.review?.regime) {
        upsertReview.mutateAsync({
          review: { trade_id: trade.id, regime: selected.valid_regimes[0] },
          silent: true,
        });
      }
    } else if (column === "actual_playbook_id") {
      await mutate({ id: trade.id, actual_playbook_id: playbookId } as any);
    }
  };

  return (
    <div className={surface === "table" ? "" : "text-sm"} onClick={(e) => surface === "table" && e.stopPropagation()}>
      <BadgeSelect
        value={value || ""}
        onChange={handleChange}
        options={options.length > 0 ? options : [{ value: "", label: "No playbooks", color: "muted" as const }]}
        placeholder={column === "playbook_id" ? "Planned" : "Hindsight"}
      />
    </div>
  );
}

function SelectCell({
  field,
  trade,
  surface,
  legIds,
  label,
}: {
  field: FieldDef;
  trade: Trade;
  surface: "table" | "detail";
  legIds?: string[];
  label?: string;
}) {
  const propertyName = field.optionsProperty;
  const { data: optionRows = [] } = usePropertyOptions(propertyName, true);
  const { options: sessionOptions } = useSessionLookup();
  const updateTrade = useUpdateTrade();
  const upsertReview = useUpsertTradeReview();
  const mutate = useLegMutate(updateTrade.mutateAsync, legIds);
  const reviewMutate = useLegMutate(upsertReview.mutateAsync, legIds);

  const options = useMemo(() => {
    if (propertyName === "session") {
      return sessionOptions;
    }
    return optionRows.map((o) => ({ value: o.value, label: o.label, customColor: o.color || undefined }));
  }, [optionRows, sessionOptions, propertyName]);

  const raw = readFieldValue(trade, field);
  const isMulti = field.valueType === "multi_select";
  const value = isMulti ? (raw as string[]) || [] : (raw as string) || "";

  const handleChange = async (v: string | string[]) => {
    const source = field.source;
    if (source.kind === "trades") {
      await mutate({ id: trade.id, [source.column]: v } as any);
    } else if (source.kind === "trade_reviews") {
      await reviewMutate({
        review: { trade_id: trade.id, [source.column]: v },
        silent: true,
      });
    }
  };

  return (
    <div className={surface === "table" ? "" : "text-sm"} onClick={(e) => surface === "table" && e.stopPropagation()}>
      <BadgeSelect
        value={value}
        onChange={handleChange}
        options={options}
        placeholder={label ?? field.label}
        multiple={isMulti}
      />
    </div>
  );
}

function TextCell({
  field,
  trade,
  surface,
  legIds,
}: {
  field: FieldDef;
  trade: Trade;
  surface: "table" | "detail";
  legIds?: string[];
}) {
  const updateTrade = useUpdateTrade();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const mutate = useLegMutate(updateTrade.mutateAsync, legIds);

  const source = field.source;
  const current = source.kind === "trades" ? (trade as any)[source.column] : null;

  const save = async () => {
    const trimmed = draft.trim();
    if (source.kind === "trades") {
      await mutate({ id: trade.id, [source.column]: trimmed || null } as any);
    }
    setEditing(false);
  };

  if (surface === "table" && !editing) {
    return (
      <div
        className="text-sm text-muted-foreground truncate cursor-pointer hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(current || "");
          setEditing(true);
        }}
      >
        {current || "—"}
      </div>
    );
  }

  if (editing) {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-7 text-xs"
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => { setDraft(current || ""); setEditing(true); }}
      className={cn("text-sm hover:text-foreground transition-colors text-left", current ? "" : "text-muted-foreground italic")}
    >
      {current || "Empty"}
    </button>
  );
}

function SpecialCell({
  renderKey,
  field,
  trade,
  surface,
  isGroup,
  legs,
  isExpanded,
  toggleExpand,
}: {
  renderKey: string;
  field: FieldDef;
  trade: Trade;
  surface: "table" | "detail";
  isGroup?: boolean;
  legs?: Trade[];
  isExpanded?: boolean;
  toggleExpand?: () => void;
}) {
  switch (renderKey) {
    case "symbol":
      return <SymbolCell trade={trade} isGroup={isGroup} legs={legs} isExpanded={isExpanded} toggleExpand={toggleExpand} surface={surface} />;
    case "direction":
      return <DirectionCell trade={trade} />;
    case "result":
      return <ResultCell trade={trade} surface={surface} />;
    case "status":
      return <StatusCell trade={trade} surface={surface} />;
    case "read_quality":
      return <ReadQualityCell trade={trade} />;
    case "closes":
      return <ClosesCell trade={trade} />;
    default:
      return <div className="text-sm text-muted-foreground">{String(readFieldValue(trade, field))}</div>;
  }
}

function getTradeTypeIcon(tradeType: string | undefined) {
  switch (tradeType) {
    case "idea":
      return { icon: <Lightbulb className="w-3.5 h-3.5" />, label: "Trade Idea", color: "text-amber-500" };
    case "paper":
      return { icon: <FileText className="w-3.5 h-3.5" />, label: "Paper Trade", color: "text-blue-500" };
    case "missed":
      return { icon: <Clock className="w-3.5 h-3.5" />, label: "Missed Setup", color: "text-orange-500" };
    default:
      return null;
  }
}

function DirectionCell({ trade }: { trade: Trade }) {
  const isBuy = trade.direction === "buy";
  return (
    <span className={cn("font-semibold uppercase", isBuy ? "text-profit" : "text-loss")}>
      {trade.direction}
    </span>
  );
}

function SymbolCell({
  trade,
  isGroup,
  legs,
  isExpanded,
  toggleExpand,
  surface,
}: {
  trade: Trade;
  isGroup?: boolean;
  legs?: Trade[];
  isExpanded?: boolean;
  toggleExpand?: () => void;
  surface: "table" | "detail";
}) {
  const tradeTypeInfo = getTradeTypeIcon(trade.trade_type);
  const isNonExecuted = trade.trade_type && trade.trade_type !== "executed";
  if (surface === "detail") {
    return <span className="font-semibold text-sm">{trade.symbol}</span>;
  }
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn("font-semibold text-sm truncate", isNonExecuted && "italic text-muted-foreground")}>
          {trade.symbol}
        </span>
        {tradeTypeInfo && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn("shrink-0", tradeTypeInfo.color)}>{tradeTypeInfo.icon}</span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{tradeTypeInfo.label}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      {isGroup && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/30 whitespace-nowrap cursor-pointer self-start"
                onClick={(e) => { e.stopPropagation(); toggleExpand?.(); }}
              >
                <Layers className="w-3 h-3" />
                {legs?.length ?? 0} legs
              </span>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              Multi-TP position: {legs?.length ?? 0} broker positions from the position sizer, grouped as one trade. Click to view legs.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

function useAwaitingRepair(trade: Trade): boolean {
  if ((trade as any).awaiting_exit === true) return true;
  const events = (trade as any).repair_events as Array<{ action: string }> | undefined;
  if (events && events.length > 0) {
    const hasSnapshotClosed = events.some((e) => e.action === "snapshot_closed");
    const wasRepaired = events.some((e) =>
      e.action === "repaired_from_snapshot" || e.action === "repaired_reopened" || e.action === "phase_a_one_shot"
    );
    if (!hasSnapshotClosed || wasRepaired) return false;
    return trade.net_pnl == null || trade.net_pnl === 0;
  }
  const pc = (trade as any).partial_closes;
  if (!Array.isArray(pc)) return false;
  const hasSnapshotClosed = pc.some((e: any) => e?.type === "snapshot_closed");
  const wasRepaired = pc.some((e: any) =>
    e?.type === "repaired_from_snapshot" || e?.type === "repaired_reopened" || e?.type === "phase_a_one_shot"
  );
  if (!hasSnapshotClosed || wasRepaired) return false;
  return trade.net_pnl == null || trade.net_pnl === 0;
}

function getSnapshotInfo(trade: Trade) {
  const events = (trade as any).repair_events as Array<{ action: string; metadata: any; applied_at: string }> | undefined;
  if (events && events.length > 0) {
    const marker = events.find((e) => e.action === "snapshot_closed");
    if (marker) return { type: "snapshot_closed", ...(marker.metadata || {}), at: marker.applied_at };
  }
  const pc = (trade as any).partial_closes;
  if (!Array.isArray(pc)) return null;
  const marker = pc.find((e: any) => e?.type === "snapshot_closed");
  return marker || null;
}

function ResultCell({ trade, surface }: { trade: Trade; surface: "table" | "detail" }) {
  const pnl = trade.net_pnl || 0;
  const isNonExecuted = trade.trade_type && trade.trade_type !== "executed";
  const g = trade as any;
  const awaiting = useAwaitingRepair(trade);
  const partialCount = getRealPartialCloses(trade).length;
  const [repairingId, setRepairingId] = useState<string | null>(null);

  const handleRepair = async () => {
    try {
      setRepairingId(trade.id);
      const { data, error } = await supabase.functions.invoke("trade-repair", {
        body: { action: "repair", account_id: trade.account_id },
      });
      if (error) throw error;
      const result = data as any;
      if (result?.repaired > 0) toast.success(result.message || "Trade repaired");
      else if (result?.pending_mt5_reconnect > 0) toast.info(result.message || "Awaiting MT5 reconnect to repair");
      else toast.info("Nothing to repair right now");
    } catch (err) {
      console.error(err);
      toast.error("Repair failed — check edge function logs");
    } finally {
      setRepairingId(null);
    }
  };

  let label: string;
  let color: "profit" | "loss" | "breakeven" | "muted";
  if (trade.is_open) { label = "Open"; color = "muted"; }
  else if (awaiting) { label = "Awaiting repair"; color = "muted"; }
  else if (isNonExecuted) {
    if (pnl > 0) { label = "Would Win"; color = "profit"; }
    else if (pnl < 0) { label = "Would Lose"; color = "loss"; }
    else { label = "Hypothetical"; color = "muted"; }
  } else if (g.outcome_mix === "mixed") {
    const parts = [`${g.legs_win}W`, `${g.legs_loss}L`];
    if (g.legs_be > 0) parts.push(`${g.legs_be}BE`);
    const money = `${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)}`;
    label = `${parts.join(" / ")} · ${money}`;
    color = pnl > 0 ? "profit" : pnl < 0 ? "loss" : "breakeven";
  } else if (pnl > 0) { label = "Win"; color = "profit"; }
  else if (pnl < 0) { label = "Loss"; color = "loss"; }
  else { label = "BE"; color = "breakeven"; }

  const badge = (
    <span className={cn(
      "px-2 py-0.5 rounded text-xs font-medium",
      color === "profit" && "bg-profit/20 text-profit",
      color === "loss" && "bg-loss/20 text-loss",
      color === "breakeven" && "bg-breakeven/20 text-breakeven",
      color === "muted" && "bg-muted text-muted-foreground",
      awaiting && "cursor-pointer hover:bg-amber-500/20 hover:text-amber-700 dark:hover:text-amber-400"
    )}>
      {label}
    </span>
  );

  if (surface === "detail") {
    return <div className="flex items-center gap-1">{badge}</div>;
  }

  return (
    <div className="flex justify-center items-center gap-1" onClick={(e) => awaiting && e.stopPropagation()}>
      {awaiting ? (
        <Popover>
          <PopoverTrigger asChild>{badge}</PopoverTrigger>
          <PopoverContent align="center" className="w-80 text-sm space-y-3">
            <div>
              <div className="font-medium mb-1">Awaiting repair</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                This trade was zeroed out by a position snapshot from another MT5 login on the same install
                {getSnapshotInfo(trade)?.account_login ? (
                  <> (login <span className="font-mono">{getSnapshotInfo(trade)!.account_login}</span>)</>
                ) : null}. The real close hasn't been streamed yet.
              </p>
            </div>
            <div className="text-xs text-muted-foreground">
              Clicking <strong>Try repair now</strong> searches MT5 deal history across sibling logins on the same install. If the close still isn't there, log MT5 back into the original broker account — the EA will heal it automatically on reconnect.
            </div>
            <Button size="sm" className="w-full" onClick={handleRepair} disabled={repairingId === trade.id}>
              {repairingId === trade.id ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Wrench className="h-3.5 w-3.5 mr-1.5" />
              )}
              Try repair now
            </Button>
          </PopoverContent>
        </Popover>
      ) : badge}
      {partialCount > 0 && (
        <span
          className="text-[9px] px-1 py-0 rounded bg-muted text-muted-foreground border border-border/50"
          title={`${partialCount + 1} partial closes`}
        >
          {partialCount + 1}×
        </span>
      )}
    </div>
  );
}

function StatusCell({ trade, surface }: { trade: Trade; surface: "table" | "detail" }) {
  const isOpen = trade.is_open;
  const pnl = trade.net_pnl ?? 0;
  const win = !isOpen && pnl > 0;
  const loss = !isOpen && pnl < 0;
  const label = isOpen ? "OPEN" : win ? "WIN" : loss ? "LOSS" : "BE";
  const advisory = trade.repair_state === "advisory_closed";

  return (
    <div className="flex justify-center items-center gap-1">
      <span className={cn(
        "px-2 py-0.5 rounded text-xs font-medium",
        isOpen && "bg-muted text-muted-foreground border border-border",
        win && "bg-profit/20 text-profit",
        loss && "bg-loss/20 text-loss",
        !isOpen && !win && !loss && "bg-breakeven/20 text-breakeven"
      )}>
        {label}
      </span>
      {advisory && surface === "table" && (
        <span
          title="Advisory close — inferred from snapshot, not from a real close event"
          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-600 border border-amber-500/30"
        >
          ADV
        </span>
      )}
    </div>
  );
}

function ReadQualityCell({ trade }: { trade: Trade }) {
  const fields: Array<[unknown, unknown]> = [
    [trade.playbook_id, trade.actual_playbook_id],
    [trade.profile, trade.actual_profile],
    [trade.review?.regime, trade.actual_regime],
  ];
  const graded = fields.filter(([p, a]) => p && a);
  if (graded.length === 0) return <div className="text-xs text-muted-foreground text-center">—</div>;
  const matches = graded.filter(([p, a]) => p === a).length;
  const label = matches === graded.length ? "Match" : matches === 0 ? "Mismatch" : "Partial";
  const tone = matches === graded.length ? "profit" : matches === 0 ? "loss" : "breakeven";

  return (
    <span className={cn(
      "px-2 py-0.5 rounded text-xs font-medium",
      tone === "profit" && "bg-profit/20 text-profit",
      tone === "loss" && "bg-loss/20 text-loss",
      tone === "breakeven" && "bg-breakeven/20 text-breakeven"
    )}>
      {label}
    </span>
  );
}

function ClosesCell({ trade }: { trade: Trade }) {
  const partials = getRealPartialCloses(trade).length;
  const total = trade.is_open ? partials : partials + 1;
  return (
    <div className="text-sm text-muted-foreground text-center font-mono-numbers">
      {total > 0 ? `${total}×` : "—"}
    </div>
  );
}
