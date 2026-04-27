import { Trade, SessionType, EmotionalState, TimeframeAlignment, TradeProfile, RegimeType } from "@/types/trading";
import { useUpdateTrade, useUpsertTradeReview } from "@/hooks/useTrades";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { useAccounts } from "@/hooks/useAccounts";
import { usePropertyOptions, useUserSettings } from "@/hooks/useUserSettings";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import {
  DETAIL_FIELD_CATALOG,
  DEFAULT_DETAIL_FIELD_ORDER,
  DEFAULT_DETAIL_VISIBLE_FIELDS,
  DetailFieldDef,
  CustomFieldDefinition,
  customFieldToColumn,
} from "@/types/settings";
import { cn } from "@/lib/utils";
import { formatFullDateTimeET, getDayNameET } from "@/lib/time";
import { BadgeSelect } from "./BadgeSelect";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CustomFieldCell } from "./CustomFieldCell";
import { Calendar, Clock, TrendingUp, TrendingDown, DollarSign, Target, Hash, Wallet } from "lucide-react";
import { useMemo } from "react";

interface TradePropertiesProps {
  trade: Trade;
}

// Convert user PropertyOption rows into BadgeSelect option shape
function toBadgeOptions(rows?: { value: string; label: string; color: string }[]) {
  if (!rows || rows.length === 0) return [];
  return rows.map(r => ({ value: r.value, label: r.label, customColor: r.color, color: "primary" }));
}

export function TradeProperties({ trade }: TradePropertiesProps) {
  const updateTrade = useUpdateTrade();
  const upsertReview = useUpsertTradeReview();
  const { data: playbooks } = usePlaybooks();
  const { data: accounts } = useAccounts();
  const { data: settings } = useUserSettings();
  const { data: customFields = [] } = useCustomFieldDefinitions();

  // User-editable property dropdowns (from Settings → Dropdown Options)
  const { data: profileOpts } = usePropertyOptions("profile");
  const { data: regimeOpts } = usePropertyOptions("regime");
  const { data: sessionOpts } = usePropertyOptions("session");
  const { data: timeframeOpts } = usePropertyOptions("timeframe");
  const { data: emotionOpts } = usePropertyOptions("emotion");

  const isManualTrade = !trade.ticket;

  const accountOptions = useMemo(() => {
    if (!accounts) return [];
    return accounts.map(acc => ({ value: acc.id, label: acc.name, color: "primary" }));
  }, [accounts]);

  const optionsByProperty = useMemo(() => ({
    profile: toBadgeOptions(profileOpts),
    regime: toBadgeOptions(regimeOpts),
    session: toBadgeOptions(sessionOpts),
    timeframe: toBadgeOptions(timeframeOpts),
    emotion: toBadgeOptions(emotionOpts),
  }), [profileOpts, regimeOpts, sessionOpts, timeframeOpts, emotionOpts]);

  const modelOptions = useMemo(() => {
    if (!playbooks) return [];
    return playbooks.map(pb => ({
      value: pb.id,
      label: pb.name,
      customColor: pb.color || undefined,
      color: "primary",
      description: pb.description || undefined,
    }));
  }, [playbooks]);

  // Resolve the user's preferred field order (or defaults), and which fields are visible.
  const fieldOrder = useMemo<string[]>(() => {
    const userOrder = settings?.detail_field_order?.length ? settings.detail_field_order : DEFAULT_DETAIL_FIELD_ORDER;
    const customKeys = customFields.filter(f => f.is_active).map(f => f.key);
    const known = new Set([...DEFAULT_DETAIL_FIELD_ORDER, ...customKeys]);
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const key of userOrder) if (known.has(key) && !seen.has(key)) { ordered.push(key); seen.add(key); }
    for (const key of [...DEFAULT_DETAIL_FIELD_ORDER, ...customKeys]) {
      if (!seen.has(key)) ordered.push(key);
    }
    return ordered;
  }, [settings?.detail_field_order, customFields]);

  const visibleSet = useMemo(() => {
    if (!settings) return new Set(DEFAULT_DETAIL_VISIBLE_FIELDS);
    if (settings.detail_visible_fields.length === 0) {
      return new Set([...DEFAULT_DETAIL_VISIBLE_FIELDS, ...customFields.filter(f => f.is_active).map(f => f.key)]);
    }
    return new Set(settings.detail_visible_fields);
  }, [settings, customFields]);

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

  const pnl = trade.net_pnl || 0;
  const isWin = pnl > 0;
  const isLoss = pnl < 0;

  // Renderers per kind. Returns a JSX node OR null to skip.
  const renderField = (key: string) => {
    if (!visibleSet.has(key)) return null;

    const sysDef = DETAIL_FIELD_CATALOG.find(f => f.key === key);
    if (sysDef) return renderSystemField(sysDef);

    const customDef = customFields.find(f => f.key === key && f.is_active);
    if (customDef) {
      return (
        <PropertyRow key={key} label={customDef.label}>
          <CustomFieldCell trade={trade} field={customDef} />
        </PropertyRow>
      );
    }
    return null;
  };

  const renderSystemField = (def: DetailFieldDef) => {
    switch (def.key) {
      case 'status':
        return (
          <div key="status" className="flex items-center gap-2 text-xs flex-wrap">
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
        );
      case 'account':
        if (!isManualTrade) return null;
        return (
          <PropertyRow key="account" icon={<Wallet className="w-3.5 h-3.5" />} label="Account">
            <BadgeSelect
              value={trade.account_id || ""}
              onChange={(v) => updateTrade.mutateAsync({ id: trade.id, account_id: (v as string) || null })}
              options={accountOptions}
              placeholder="Select..."
            />
          </PropertyRow>
        );
      case 'pair':
        return (
          <PropertyRow key="pair" icon={<Hash className="w-3.5 h-3.5" />} label="Pair">
            <span className="font-semibold">{trade.symbol}</span>
          </PropertyRow>
        );
      case 'day':
        return (
          <PropertyRow key="day" icon={<Calendar className="w-3.5 h-3.5" />} label="Day">
            <span>{getDayNameET(trade.entry_time)}</span>
          </PropertyRow>
        );
      case 'date':
        return (
          <PropertyRow key="date" icon={<Clock className="w-3.5 h-3.5" />} label="Date (ET)">
            <span>{formatFullDateTimeET(trade.entry_time)}</span>
          </PropertyRow>
        );
      case 'direction':
        return (
          <PropertyRow
            key="direction"
            icon={trade.direction === "buy" ? <TrendingUp className="w-3.5 h-3.5 text-profit" /> : <TrendingDown className="w-3.5 h-3.5 text-loss" />}
            label="Direction"
          >
            <span className={cn("font-semibold uppercase", trade.direction === "buy" ? "text-profit" : "text-loss")}>
              {trade.direction}
            </span>
          </PropertyRow>
        );
      case 'pnl':
        return (
          <PropertyRow key="pnl" icon={<DollarSign className="w-3.5 h-3.5" />} label="P&L">
            <span className={cn("font-mono-numbers font-bold", isWin && "text-profit", isLoss && "text-loss")}>
              {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
            </span>
          </PropertyRow>
        );
      case 'r_pct':
        return (
          <PropertyRow key="r_pct" icon={<Target className="w-3.5 h-3.5" />} label="R%">
            <span
              className={cn(
                "font-mono-numbers font-bold",
                trade.r_multiple_actual && trade.r_multiple_actual >= 0 && "text-profit",
                trade.r_multiple_actual && trade.r_multiple_actual < 0 && "text-loss"
              )}
            >
              {trade.r_multiple_actual !== null
                ? `${trade.r_multiple_actual >= 0 ? "+" : ""}${trade.r_multiple_actual.toFixed(1)}%`
                : "—"}
            </span>
          </PropertyRow>
        );
      case 'emotion':
        return (
          <PropertyRow key="emotion" label="Emotion">
            <BadgeSelect
              value={trade.review?.emotional_state_before || ""}
              onChange={(v) => upsertReview.mutateAsync({
                review: { trade_id: trade.id, emotional_state_before: v as EmotionalState },
                silent: true,
              })}
              options={optionsByProperty.emotion}
              placeholder="Select..."
            />
          </PropertyRow>
        );
      case 'session':
        return (
          <PropertyRow key="session" label="Session">
            <BadgeSelect
              value={trade.session || ""}
              onChange={(v) => updateTrade.mutateAsync({ id: trade.id, session: (v as SessionType) || null })}
              options={optionsByProperty.session}
              placeholder="Select..."
            />
          </PropertyRow>
        );
      case 'model':
        return (
          <DualPropertyRow key="model" label="Model">
            <BadgeSelect
              value={trade.playbook_id || ""}
              onChange={async (v) => {
                const playbookId = v as string;
                await updateTrade.mutateAsync({ id: trade.id, playbook_id: playbookId || null });
                const selected = playbooks?.find(p => p.id === playbookId);
                if (selected?.valid_regimes?.length === 1 && !trade.review?.regime) {
                  upsertReview.mutateAsync({
                    review: { trade_id: trade.id, regime: selected.valid_regimes[0] as RegimeType },
                    silent: true,
                  });
                }
              }}
              options={modelOptions}
              placeholder="Planned..."
            />
            <BadgeSelect
              value={trade.actual_playbook_id || ""}
              onChange={(v) => updateTrade.mutateAsync({ id: trade.id, actual_playbook_id: (v as string) || null })}
              options={modelOptions}
              placeholder="Actual..."
            />
          </DualPropertyRow>
        );
      case 'profile':
        return (
          <DualPropertyRow key="profile" label="Profile">
            <BadgeSelect
              value={trade.profile || ""}
              onChange={(v) => updateTrade.mutateAsync({ id: trade.id, profile: (v as TradeProfile) || null })}
              options={optionsByProperty.profile}
              placeholder="Planned..."
            />
            <BadgeSelect
              value={(trade.actual_profile as string) || ""}
              onChange={(v) => updateTrade.mutateAsync({ id: trade.id, actual_profile: ((v as string) || null) as TradeProfile | null })}
              options={optionsByProperty.profile}
              placeholder="Actual..."
            />
          </DualPropertyRow>
        );
      case 'regime':
        return (
          <DualPropertyRow key="regime" label="Regime">
            <BadgeSelect
              value={trade.review?.regime || ""}
              onChange={(v) => upsertReview.mutateAsync({
                review: { trade_id: trade.id, regime: v as RegimeType },
                silent: true,
              })}
              options={optionsByProperty.regime}
              placeholder="Planned..."
            />
            <BadgeSelect
              value={(trade.actual_regime as string) || ""}
              onChange={(v) => updateTrade.mutateAsync({ id: trade.id, actual_regime: ((v as string) || null) as RegimeType | null })}
              options={optionsByProperty.regime}
              placeholder="Actual..."
            />
          </DualPropertyRow>
        );
      case 'timeframes':
        return (
          <DualPropertyRow key="timeframes" label="Timeframes">
            <BadgeSelect
              value={trade.alignment || []}
              onChange={(v) => updateTrade.mutateAsync({ id: trade.id, alignment: v as TimeframeAlignment[] })}
              options={optionsByProperty.timeframe}
              placeholder="HTF..."
              multiple
            />
            <BadgeSelect
              value={trade.entry_timeframes || []}
              onChange={(v) => updateTrade.mutateAsync({ id: trade.id, entry_timeframes: v as TimeframeAlignment[] })}
              options={optionsByProperty.timeframe}
              placeholder="Entry..."
              multiple
            />
          </DualPropertyRow>
        );
      case 'place':
        return (
          <PropertyRow key="place" label="Place">
            <span className="text-sm text-muted-foreground">{trade.place || "Empty"}</span>
          </PropertyRow>
        );
      default:
        return null;
    }
  };

  const renderedRows = fieldOrder.map(renderField).filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Properties</div>

      <div className="space-y-3">{renderedRows}</div>

      <Separator />

      {/* Trade Details — always shown (raw price/lots data) */}
      <div className="space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Entry Price</span>
          <span className="font-mono-numbers">{trade.entry_price}</span>
        </div>
        {trade.exit_price && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Exit Price</span>
            <span className="font-mono-numbers">{trade.exit_price}</span>
          </div>
        )}
        {trade.sl_initial && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Stop Loss</span>
            <span className="font-mono-numbers text-loss">{trade.sl_initial}</span>
          </div>
        )}
        {trade.tp_initial && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Take Profit</span>
            <span className="font-mono-numbers text-profit">{trade.tp_initial}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Lots</span>
          <span className="font-mono-numbers">{trade.total_lots}</span>
        </div>
      </div>
    </div>
  );
}

function PropertyRow({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm">{children}</div>
    </div>
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
