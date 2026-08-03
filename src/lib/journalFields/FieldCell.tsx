import { useMemo } from "react";
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
import { formatDateET, formatTimeET } from "@/lib/time";
import { useState } from "react";

interface FieldCellProps {
  field: FieldDef;
  trade: Trade;
  surface: "table" | "detail";
  /** Called when the row click should be suppressed (e.g. inline edits). */
  onSuppressClick?: (suppressed: boolean) => void;
  /** If this cell is being edited inside a group leader, call this for every leg. */
  legIds?: string[];
  accounts?: import("@/types/trading").Account[];
  playbooks?: import("@/types/trading").Playbook[];
}

export function FieldCell({
  field,
  trade,
  surface,
  onSuppressClick,
  legIds,
  accounts,
  playbooks,
}: FieldCellProps) {
  // Special renderers that are too visual to fit the generic valueType path.
  if (field.renderKey) {
    return <SpecialCell renderKey={field.renderKey} field={field} trade={trade} surface={surface} />;
  }

  const valueType = field.editor ?? field.valueType;

  if (valueType === "custom") {
    return <CustomFieldCellWrapper trade={trade} fieldKey={field.source.kind === "custom" ? field.source.key : ""} />;
  }

  if (valueType === "account") {
    return <AccountCell field={field} trade={trade} surface={surface} accounts={accounts} legIds={legIds} />;
  }

  if (valueType === "playbook") {
    return <PlaybookCell field={field} trade={trade} surface={surface} playbooks={playbooks} legIds={legIds} />;
  }

  if (valueType === "select" || valueType === "multi_select") {
    return <SelectCell field={field} trade={trade} surface={surface} legIds={legIds} />;
  }

  if (valueType === "text") {
    return <TextCell field={field} trade={trade} surface={surface} legIds={legIds} />;
  }

  // Readonly / computed / badge / money / percent / number / duration / date — just display.
  const { display, sortable } = resolveDisplay(trade, field);
  return <DisplayCell display={display} field={field} />;
}

function DisplayCell({ display, field }: { display: string | null; field: FieldDef }) {
  const alignClass = cn(
    field.alignRight && "text-right",
    field.alignCenter && "text-center"
  );

  if (field.valueType === "money" || field.valueType === "percent" || field.valueType === "number") {
    const resolved = resolveDisplay as any; // we already have display string
    return (
      <div className={cn("text-sm font-mono-numbers", alignClass)}>
        {display ?? "—"}
      </div>
    );
  }

  return (
    <div className={cn("text-sm text-muted-foreground", alignClass)}>
      {display ?? "—"}
    </div>
  );
}

function CustomFieldCellWrapper({ trade, fieldKey }: { trade: Trade; fieldKey: string }) {
  const { data: customFields = [] } = useCustomFieldDefinitions();
  const def = customFields.find((f) => f.key === fieldKey);
  if (!def) return <div className="text-sm text-muted-foreground">—</div>;
  return <CustomFieldCell trade={trade} field={def} />;
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
  const mutate = useMemo(() => {
    if (!legIds || legIds.length === 0) return updateTrade.mutateAsync;
    return async (args: { id: string } & Partial<Trade>) => {
      const { id, ...patch } = args;
      return Promise.all(legIds.map((lid) => updateTrade.mutateAsync({ id: lid, ...patch } as any)));
    };
  }, [updateTrade, legIds]);

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
    <div className="text-sm text-muted-foreground truncate">
      {account?.name ?? "—"}
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
  const mutate = useMemo(() => {
    if (!legIds || legIds.length === 0) return updateTrade.mutateAsync;
    return async (args: { id: string } & Partial<Trade>) => {
      const { id, ...patch } = args;
      return Promise.all(legIds.map((lid) => updateTrade.mutateAsync({ id: lid, ...patch } as any)));
    };
  }, [updateTrade, legIds]);

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
    <div className={surface === "table" ? "" : "text-sm"}>
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
}: {
  field: FieldDef;
  trade: Trade;
  surface: "table" | "detail";
  legIds?: string[];
}) {
  const propertyName = field.optionsProperty;
  const { data: optionRows = [] } = usePropertyOptions(propertyName, true);
  const { options: sessionOptions } = useSessionLookup();
  const updateTrade = useUpdateTrade();
  const upsertReview = useUpsertTradeReview();
  const mutate = useMemo(() => {
    if (!legIds || legIds.length === 0) return updateTrade.mutateAsync;
    return async (args: { id: string } & Partial<Trade>) => {
      const { id, ...patch } = args;
      return Promise.all(legIds.map((lid) => updateTrade.mutateAsync({ id: lid, ...patch } as any)));
    };
  }, [updateTrade, legIds]);
  const reviewMutate = useMemo(() => {
    if (!legIds || legIds.length === 0) return upsertReview.mutateAsync;
    return async (args: { review: any; silent?: boolean }) => {
      const { review, silent } = args;
      return Promise.all(legIds.map((lid) => upsertReview.mutateAsync({ review: { ...review, trade_id: lid }, silent })));
    };
  }, [upsertReview, legIds]);

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
    <div className={surface === "table" ? "" : "text-sm"}>
      <BadgeSelect
        value={value}
        onChange={handleChange}
        options={options}
        placeholder={field.label}
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
  const mutate = useMemo(() => {
    if (!legIds || legIds.length === 0) return updateTrade.mutateAsync;
    return async (args: { id: string } & Partial<Trade>) => {
      const { id, ...patch } = args;
      return Promise.all(legIds.map((lid) => updateTrade.mutateAsync({ id: lid, ...patch } as any)));
    };
  }, [updateTrade, legIds]);

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
      <div>
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
      className={cn("text-sm hover:text-foreground transition-colors", current ? "" : "text-muted-foreground italic")}
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
}: {
  renderKey: string;
  field: FieldDef;
  trade: Trade;
  surface: "table" | "detail";
}) {
  switch (renderKey) {
    case "symbol":
      return <SymbolCell trade={trade} />;
    case "result":
      return <ResultCell trade={trade} />;
    case "status":
      return <StatusCell trade={trade} />;
    case "read_quality":
      return <ReadQualityCell trade={trade} />;
    case "closes":
      return <ClosesCell trade={trade} />;
    default:
      return <DisplayCell display={String(readFieldValue(trade, field))} field={field} />;
  }
}

function SymbolCell({ trade }: { trade: Trade }) {
  return (
    <div className="text-sm font-semibold truncate">
      {trade.symbol}
    </div>
  );
}

function ResultCell({ trade }: { trade: Trade }) {
  const pnl = trade.net_pnl || 0;
  const isNonExecuted = trade.trade_type && trade.trade_type !== "executed";
  const g = trade as any;

  let label: string;
  let color: string;
  if (trade.is_open) { label = "Open"; color = "muted"; }
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

  return (
    <span className={cn(
      "px-2 py-0.5 rounded text-xs font-medium",
      color === "profit" && "bg-profit/20 text-profit",
      color === "loss" && "bg-loss/20 text-loss",
      color === "breakeven" && "bg-breakeven/20 text-breakeven",
      color === "muted" && "bg-muted text-muted-foreground"
    )}>
      {label}
    </span>
  );
}

function StatusCell({ trade }: { trade: Trade }) {
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
      {advisory && (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-600 border border-amber-500/30">
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
  const partials = (trade as any).partial_fills?.filter((f: any) => !f.isFinal).length ?? 0;
  const total = trade.is_open ? partials : partials + 1;
  return (
    <div className="text-sm text-muted-foreground text-center font-mono-numbers">
      {total > 0 ? `${total}×` : "—"}
    </div>
  );
}

export function formatDateCell(trade: Trade) {
  return (
    <div className="text-sm">
      <div className="font-medium">{formatDateET(trade.entry_time)}</div>
      <div className="text-xs text-muted-foreground">{formatTimeET(trade.entry_time)}</div>
    </div>
  );
}

export function formatNumberCell(n: number | null, suffix = ""): string {
  if (n === null || n === undefined) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}${suffix}`;
}
