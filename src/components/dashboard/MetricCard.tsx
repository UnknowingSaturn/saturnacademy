import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: "up" | "down" | "neutral";
  className?: string;
}

export function MetricCard({ title, value, subtitle, icon, trend, className }: MetricCardProps) {
  return (
    <div className={cn("metric-card", className)}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className={cn(
            "text-2xl font-bold font-mono-numbers",
            trend === "up" && "text-profit",
            trend === "down" && "text-loss",
          )}>
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div className={cn(
            "p-2 rounded-lg",
            trend === "up" && "bg-profit/10 text-profit",
            trend === "down" && "bg-loss/10 text-loss",
            !trend && "bg-muted text-muted-foreground"
          )}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}