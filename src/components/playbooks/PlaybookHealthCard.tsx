import * as React from "react";
import { Playbook } from "@/types/trading";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, AlertTriangle, XCircle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface GapItem {
  category: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

function computeGaps(playbook: Playbook): { score: number; items: GapItem[] } {
  const items: GapItem[] = [];

  const entryRules = playbook.entry_zone_rules || {};
  const hasEntryRules =
    Object.keys(entryRules).length > 0 && JSON.stringify(entryRules) !== "{}";
  items.push({
    category: "Entry Rules",
    status: hasEntryRules ? "pass" : "fail",
    message: hasEntryRules ? "Entry zone rules defined" : "No entry zone rules",
  });

  const confirmations = playbook.confirmation_rules || [];
  items.push({
    category: "Confirmations",
    status:
      confirmations.length >= 2 ? "pass" : confirmations.length === 1 ? "warn" : "fail",
    message: confirmations.length > 0
      ? `${confirmations.length} confirmation rule(s)`
      : "No confirmation rules",
  });

  const invalidations = playbook.invalidation_rules || [];
  items.push({
    category: "Invalidations",
    status:
      invalidations.length >= confirmations.length
        ? "pass"
        : invalidations.length > 0
        ? "warn"
        : "fail",
    message: invalidations.length > 0
      ? `${invalidations.length} invalidation rule(s)`
      : "No invalidation rules",
  });

  const management = playbook.management_rules || [];
  items.push({
    category: "Trade Management",
    status: management.length >= 2 ? "pass" : management.length === 1 ? "warn" : "fail",
    message: management.length > 0
      ? `${management.length} management rule(s)`
      : "No management rules",
  });

  const failures = playbook.failure_modes || [];
  items.push({
    category: "Failure Modes",
    status: failures.length >= 3 ? "pass" : failures.length > 0 ? "warn" : "fail",
    message: failures.length > 0
      ? `${failures.length} failure mode(s)`
      : "No failure modes documented",
  });

  const hasRPerTrade = playbook.max_r_per_trade != null;
  const hasDailyLoss = playbook.max_daily_loss_r != null;
  const hasMaxTrades = playbook.max_trades_per_session != null;
  const riskCount = [hasRPerTrade, hasDailyLoss, hasMaxTrades].filter(Boolean).length;
  items.push({
    category: "Risk Limits",
    status: riskCount === 3 ? "pass" : riskCount > 0 ? "warn" : "fail",
    message:
      riskCount === 3 ? "All risk limits set" : `${3 - riskCount} risk limit(s) missing`,
  });

  const sessions = playbook.session_filter || [];
  items.push({
    category: "Session Filter",
    status: sessions.length > 0 ? "pass" : "warn",
    message: sessions.length > 0
      ? `Filtered to: ${sessions.join(", ")}`
      : "No session filter",
  });

  const symbols = playbook.symbol_filter || [];
  items.push({
    category: "Symbol Filter",
    status: symbols.length > 0 ? "pass" : "warn",
    message: symbols.length > 0 ? `Filtered to: ${symbols.join(", ")}` : "All symbols",
  });

  const checklist = playbook.checklist_questions || [];
  items.push({
    category: "Pre-Trade Checklist",
    status: checklist.length >= 4 ? "pass" : checklist.length > 0 ? "warn" : "fail",
    message: checklist.length > 0
      ? `${checklist.length} checklist question(s)`
      : "No checklist questions",
  });

  items.push({
    category: "Description",
    status: playbook.description ? "pass" : "warn",
    message: playbook.description ? "Strategy description provided" : "No description",
  });

  const passCount = items.filter((i) => i.status === "pass").length;
  const score = Math.round((passCount / items.length) * 100);

  return { score, items };
}

const statusIcon = {
  pass: <CheckCircle2 className="h-4 w-4 text-profit" />,
  warn: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  fail: <XCircle className="h-4 w-4 text-destructive" />,
} as const;

interface PlaybookHealthCardProps {
  playbook: Playbook;
}

export function PlaybookHealthCard({ playbook }: PlaybookHealthCardProps) {
  const { score, items } = React.useMemo(() => computeGaps(playbook), [playbook]);
  const passCount = items.filter((i) => i.status === "pass").length;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Playbook Health
        </h3>
        <span className="text-xs text-muted-foreground">
          {passCount}/{items.length} criteria passed
        </span>
      </div>

      <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/40 border border-border/50">
        <div
          className={cn(
            "w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold border-4 shrink-0",
            score >= 80
              ? "border-profit text-profit"
              : score >= 50
              ? "border-amber-500 text-amber-500"
              : "border-destructive text-destructive"
          )}
        >
          {score}%
        </div>
        <p className="text-xs text-muted-foreground">
          {score >= 80
            ? "Playbook is well-defined and ready for backtesting."
            : score >= 50
            ? "Some categories are incomplete — strengthen the gaps below before going live."
            : "Several core categories are missing. Address fails before trusting this playbook."}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map((item) => (
          <Card
            key={item.category}
            className={cn(
              "border",
              item.status === "pass" && "border-profit/20",
              item.status === "warn" && "border-amber-500/20",
              item.status === "fail" && "border-destructive/20"
            )}
          >
            <CardContent className="pt-2 pb-2 px-2.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                {statusIcon[item.status]}
                <span className="text-[11px] font-medium">{item.category}</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug">
                {item.message}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
