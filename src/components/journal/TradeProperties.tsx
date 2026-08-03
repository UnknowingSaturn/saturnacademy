import { Trade, SessionType, EmotionalState, TimeframeAlignment, TradeProfile, RegimeType } from "@/types/trading";
import { useUpdateTrade, useUpsertTradeReview } from "@/hooks/useTrades";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { useAccounts } from "@/hooks/useAccounts";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { buildFieldRegistry, getFieldDef, resolveFieldLabel, DEFAULT_DETAIL_GROUPS, FieldDef } from "@/lib/journalFields/registry";
import { useFieldLayoutActions } from "@/hooks/useFieldLayoutActions";
import { FieldCell } from "@/lib/journalFields/FieldCell";
import { FieldRowMenu } from "./FieldRowMenu";
import { AddFieldPopover } from "./AddFieldPopover";
import { RemoveFieldDialog } from "./RemoveFieldDialog";
import { cn } from "@/lib/utils";
import { formatFullDateTimeET, getDayNameET } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CustomFieldCell } from "./CustomFieldCell";
import { Calendar, Clock, DollarSign, Target, Hash, Wallet, Layers, TrendingUp, TrendingDown, Plus, Pencil, Trash2, MoreHorizontal } from "lucide-react";

import { getAllCloseFills, getWeightedAvgExitPrice, hasMultipleCloses } from "@/lib/tradeMath";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";

interface TradePropertiesProps {
  trade: Trade;
  /** Every leg in the group. When length > 1 headline metrics show cumulative
   *  values and edits to qualitative fields fan out to all legs. */
  legs?: Trade[];
  /** Pre-aggregated group view (sum P&L, sum lots, VWAP prices). Provided by
   *  useTradeGroup; falls back to `trade` for single-leg trades. */
  aggregate?: Trade;
}

export function TradeProperties({ trade, legs, aggregate }: TradePropertiesProps) {
  const isGroup = !!legs && legs.length > 1;
  const legList = legs && legs.length > 0 ? legs : [trade];
  const agg = aggregate ?? trade;
  const updateTradeMut = useUpdateTrade();
  const upsertReviewMut = useUpsertTradeReview();

  // Wrap the base mutations so any qualitative edit made against the leader
  // row automatically fans out to every leg in the group. Numeric/price
  // fields are only rendered as read-only in this component, so all edit
  // sites here are safe to propagate.
  const legIds = useMemo(() => legList.map((l) => l.id), [legList]);
  const updateTrade = useMemo(() => ({
    mutateAsync: async (args: { id: string } & Partial<Trade>) => {
      const { id, ...patch } = args;
      if (isGroup && id === trade.id) {
        return Promise.all(legIds.map((lid) => updateTradeMut.mutateAsync({ id: lid, ...patch } as Partial<Trade> & { id: string })));
      }
      return updateTradeMut.mutateAsync(args);
    },
  }), [updateTradeMut, isGroup, legIds, trade.id]);
  const upsertReview = useMemo(() => ({
    mutateAsync: async (args: { review: Partial<import("@/types/trading").TradeReview> & { trade_id: string }; silent?: boolean }) => {
      const { review, silent } = args;
      if (isGroup && review.trade_id === trade.id) {
        return Promise.all(legIds.map((lid) => upsertReviewMut.mutateAsync({ review: { ...review, trade_id: lid }, silent })));
      }
      return upsertReviewMut.mutateAsync(args);
    },
  }), [upsertReviewMut, isGroup, legIds, trade.id]);

  const { data: playbooks } = usePlaybooks();
  const { data: accounts } = useAccounts();
  const { data: settings } = useUserSettings();
  const { data: customFields = [] } = useCustomFieldDefinitions();
  const [removeTarget, setRemoveTarget] = useState<FieldDef | null>(null);



  const isManualTrade = !trade.ticket;

  // Read Quality computation (only relevant if model+regime+profile fields are present)
  const readQuality = useMemo(() => {
    const fields: Array<[unknown, unknown]> = [
      [trade.playbook_id, trade.actual_playbook_id],
      [trade.profile, trade.actual_profile],
      [trade.review?.regime, trade.actual_regime],
    ];
    const graded = fields.filter(([planned, actual]) => planned && actual);
    if (graded.length === 0) return null;
    const matches = graded.filter(([p, a]) => p === a).length;
    if (matches === graded.length) return { label: "Match", variant: "default" as const, tone: "profit" };
    if (matches === 0) return { label: "Mismatch", variant: "destructive" as const, tone: "loss" };
    return { label: "Partial", variant: "outline" as const, tone: "breakeven" };
  }, [trade.playbook_id, trade.actual_playbook_id, trade.profile, trade.actual_profile, trade.review?.regime, trade.actual_regime]);

  const pnl = agg.net_pnl || 0;
  const isWin = pnl > 0;
  const isLoss = pnl < 0;
  const totalLotsAgg = agg.original_lots ?? agg.total_lots ?? trade.original_lots ?? trade.total_lots;

  const fills = useMemo(() => getAllCloseFills(trade), [
    trade.partial_closes, trade.exit_price, trade.exit_time,
    trade.original_lots, trade.gross_pnl, trade.is_open, trade.total_lots,
  ]);
  const hasMultiple = fills.length > 1;
  const avgExit = useMemo(() => (hasMultiple ? getWeightedAvgExitPrice(trade) : null), [hasMultiple, trade]);

  const { layout, labels: overrides, addGroup, renameGroup, deleteGroup } = useFieldLayoutActions();
  const allFields = buildFieldRegistry(customFields, accounts ?? []);
  const allFieldMap = useMemo(() => new Map(allFields.map((f) => [f.key, f])), [allFields]);

  const groups = layout?.detail?.groups?.length ? layout.detail.groups : DEFAULT_DETAIL_GROUPS;
  const groupOptions = useMemo(() => groups.map((g) => ({ id: g.id, label: g.label })), [groups]);

  const renderField = (key: string, groupId: string) => {
    const field = allFieldMap.get(key) || getFieldDef(key);
    if (!field) return null;
    const label = resolveFieldLabel(key, overrides);
    return (
      <PropertyRow
        key={key}
        label={label}
        menu={
          <FieldRowMenu
            field={field}
            label={label}
            hasLabelOverride={!!overrides[key]}
            groups={groupOptions}
            currentGroupId={groupId}
            onRequestRemove={setRemoveTarget}
          />
        }
      >
        <FieldCell
          field={field}
          trade={trade}
          surface="detail"
          legIds={legIds}
          accounts={accounts}
          playbooks={playbooks}
        />
      </PropertyRow>
    );
  };

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Properties</div>

      {/* Status row — always visible at the top */}
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <Badge variant={trade.is_open ? "outline" : isWin ? "default" : "destructive"}>
          {trade.is_open ? "OPEN" : isWin ? "WIN" : isLoss ? "LOSS" : "BE"}
        </Badge>
        {trade.trade_number && <span className="text-muted-foreground">#{trade.trade_number}</span>}
        {readQuality && (
          <Badge
            variant={readQuality.variant}
            className={cn(
              readQuality.tone === "profit" && "bg-profit/20 text-profit hover:bg-profit/30 border-transparent",
              readQuality.tone === "breakeven" && "bg-breakeven/20 text-breakeven hover:bg-breakeven/30 border-breakeven/30",
            )}
            title="Read Quality: how closely your planned thesis matched the actual setup"
          >
            Read: {readQuality.label}
          </Badge>
        )}
      </div>

      {/* User-defined groups from Notion-style layout */}
      <div className="space-y-5">
        {groups.map((group) => {
          const visibleFields = group.fields.filter((k) => {
            const f = allFieldMap.get(k) || getFieldDef(k);
            return f && (f.group !== "custom" || customFields.some((cf) => cf.key === k && cf.is_active));
          });
          return (
            <div key={group.id} className="space-y-3 group/section">
              <div className="flex items-center gap-1">
                <GroupHeader
                  label={group.label}
                  onRename={(v) => renameGroup(group.id, v)}
                  onDelete={() => deleteGroup(group.id)}
                />
                <div className="opacity-0 group-hover/section:opacity-100 transition-opacity">
                  <AddFieldPopover
                    surface="detail"
                    groupId={group.id}
                    trigger={
                      <button
                        className="p-0.5 rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label={`Add field to ${group.label}`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    }
                  />
                </div>
              </div>
              <div className="space-y-3">
                {visibleFields.map((k) => renderField(k, group.id))}
                {visibleFields.length === 0 && (
                  <div className="text-xs text-muted-foreground italic">No fields yet</div>
                )}
              </div>
            </div>
          );
        })}
        <button
          onClick={() => addGroup()}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New group
        </button>
      </div>

      <RemoveFieldDialog
        field={removeTarget}
        label={removeTarget ? resolveFieldLabel(removeTarget.key, overrides) : ""}
        onClose={() => setRemoveTarget(null)}
      />


      <Separator />

      {/* Trade Details — always shown (raw price/lots data). */}
      <div className="space-y-2 text-xs">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Trade Details</div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Entry Price{isGroup ? " (leader leg)" : ""}</span>
          <span className="font-mono-numbers">{trade.entry_price}</span>
        </div>
        {trade.exit_price && (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Exit Price{hasMultiple ? " (final)" : isGroup ? " (leader leg)" : ""}</span>
              <span className="font-mono-numbers">{trade.exit_price}</span>
            </div>
            {hasMultiple && avgExit != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg Exit ({fills.length} fills)</span>
                <span className="font-mono-numbers">{avgExit.toFixed(5)}</span>
              </div>
            )}
          </>
        )}
        {trade.sl_initial && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Stop Loss{isGroup ? " (leader leg)" : ""}</span>
            <span className="font-mono-numbers text-loss">{trade.sl_initial}</span>
          </div>
        )}
        {trade.tp_initial && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Take Profit{isGroup ? " (leader leg)" : ""}</span>
            <span className="font-mono-numbers text-profit">{trade.tp_initial}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Lots</span>
          <span className="font-mono-numbers">
            {(() => {
              if (isGroup) {
                return `${Number(totalLotsAgg ?? 0).toFixed(2)} (${legList.length} legs)`;
              }
              const orig = trade.original_lots;
              const partials = fills.filter(f => !f.isFinal).length;
              if (!trade.is_open && orig && partials > 0) return `${orig} (${fills.length} fills)`;
              if (trade.is_open && orig && orig !== trade.total_lots) return `${trade.total_lots} / ${orig}`;
              return orig ?? trade.total_lots;
            })()}
          </span>
        </div>
      </div>

      {isGroup && (
        <>
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Legs
              </div>
              <span className="text-[10px] text-muted-foreground">
                {legList.length} positions in this idea
              </span>
            </div>
            <div className="rounded-md border border-border/50 divide-y divide-border/50 overflow-hidden">
              <div className="grid grid-cols-[24px_1fr_60px_80px_60px] gap-2 px-2 py-1 text-[10px] text-muted-foreground uppercase tracking-wide bg-muted/30">
                <span>#</span>
                <span>Exit</span>
                <span className="text-right">Lots</span>
                <span className="text-right">P&L</span>
                <span className="text-right">R</span>
              </div>
              {[...legList]
                .sort((a, b) => {
                  const ta = a.exit_time ? new Date(a.exit_time).getTime() : Number(a.is_open ? Infinity : 0);
                  const tb = b.exit_time ? new Date(b.exit_time).getTime() : Number(b.is_open ? Infinity : 0);
                  return ta - tb;
                })
                .map((leg, i) => {
                  const legPnl = leg.net_pnl ?? 0;
                  const legR = leg.r_multiple_actual;
                  return (
                    <div
                      key={leg.id}
                      className="grid grid-cols-[24px_1fr_60px_80px_60px] gap-2 px-2 py-1.5 text-xs items-center"
                    >
                      <span className="text-muted-foreground">{i + 1}</span>
                      <span className="font-mono-numbers truncate">
                        {leg.is_open ? (
                          <span className="text-muted-foreground italic">open</span>
                        ) : leg.exit_price != null ? (
                          leg.exit_price
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </span>
                      <span className="font-mono-numbers text-right">
                        {(leg.original_lots ?? leg.total_lots)?.toString() ?? "—"}
                      </span>
                      <span
                        className={cn(
                          "font-mono-numbers font-semibold text-right",
                          legPnl > 0 && "text-profit",
                          legPnl < 0 && "text-loss",
                        )}
                      >
                        {leg.is_open ? "—" : `${legPnl >= 0 ? "+" : ""}$${legPnl.toFixed(2)}`}
                      </span>
                      <span
                        className={cn(
                          "font-mono-numbers text-right",
                          legR != null && legR >= 0 && "text-profit",
                          legR != null && legR < 0 && "text-loss",
                        )}
                      >
                        {legR != null ? `${legR >= 0 ? "+" : ""}${legR.toFixed(2)}R` : "—"}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function GroupHeader({
  label,
  onRename,
  onDelete,
}: {
  label: string;
  onRename: (v: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onRename(draft); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onRename(draft); setEditing(false); }
          if (e.key === "Escape") { setDraft(label); setEditing(false); }
        }}
        className="h-6 text-xs w-40"
      />
    );
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      <div className="opacity-0 group-hover/section:opacity-100 transition-opacity flex items-center">
        <button
          onClick={() => { setDraft(label); setEditing(true); }}
          className="p-0.5 rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`Rename ${label} group`}
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={onDelete}
          className="p-0.5 rounded text-muted-foreground hover:bg-accent hover:text-destructive"
          aria-label={`Delete ${label} group`}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function PropertyRow({
  icon,
  label,
  menu,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  menu?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 group/row">
      <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
        {icon}
        <span className="truncate">{label}</span>
        {menu}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}


function PlaceEditor({ value, onSave }: { value: string; onSave: (v: string) => void | Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onSave(draft.trim()); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onSave(draft.trim()); setEditing(false); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        className="h-7 text-xs w-40"
      />
    );
  }
  return (
    <button
      onClick={() => { setDraft(value); setEditing(true); }}
      className={cn("text-sm hover:text-foreground transition-colors", value ? "" : "text-muted-foreground italic")}
    >
      {value || "Empty"}
    </button>
  );
}

function DualPropertyRow({
  label,
  children,
}: {
  label: string;
  children: [React.ReactNode, React.ReactNode];
}) {
  const [plannedNode, actualNode] = children;
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1.5">
        <span>{label}</span>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Planned</span>
          <div className="text-sm">{plannedNode}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Actual</span>
          <div className="text-sm">{actualNode}</div>
        </div>
      </div>
    </div>
  );
}
