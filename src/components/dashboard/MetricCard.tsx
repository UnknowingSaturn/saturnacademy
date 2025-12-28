import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: "up" | "down" | "neutral";
  className?: string;
  size?: "default" | "large";
}

export function MetricCard({ 
  title, 
  value, 
  subtitle, 
  icon, 
  trend, 
  className,
  size = "default" 
}: MetricCardProps) {
  const isProfit = trend === "up";
  const isLoss = trend === "down";

  return (
    <div 
      className={cn(
        "group relative rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl transition-all duration-300",
        size === "large" ? "p-6" : "p-5",
        isProfit && "hover:border-profit/30",
        isLoss && "hover:border-loss/30",
        !trend && "hover:border-primary/30",
        className
      )}
      style={{
        boxShadow: isProfit 
          ? "0 0 0 1px hsl(var(--profit) / 0.1), 0 4px 24px -4px hsl(0 0% 0% / 0.4), 0 0 32px -8px hsl(var(--profit) / 0.1)"
          : isLoss
          ? "0 0 0 1px hsl(var(--loss) / 0.1), 0 4px 24px -4px hsl(0 0% 0% / 0.4), 0 0 32px -8px hsl(var(--loss) / 0.1)"
          : "0 0 0 1px hsl(0 0% 100% / 0.05), 0 4px 24px -4px hsl(0 0% 0% / 0.4)"
      }}
    >
      {/* Gradient overlay on hover */}
      <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
        <div className={cn(
          "absolute inset-0 rounded-xl",
          isProfit && "bg-gradient-to-br from-profit/5 to-transparent",
          isLoss && "bg-gradient-to-br from-loss/5 to-transparent",
          !trend && "bg-gradient-to-br from-primary/5 to-transparent"
        )} />
      </div>

      <div className="relative flex items-start justify-between">
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className={cn(
            "font-bold font-mono tracking-tight animate-number-pop",
            size === "large" ? "text-4xl" : "text-2xl",
            isProfit && "text-profit",
            isLoss && "text-loss",
            !trend && "text-foreground"
          )}
          style={{
            textShadow: isProfit 
              ? "0 0 30px hsl(var(--profit) / 0.4)"
              : isLoss 
              ? "0 0 30px hsl(var(--loss) / 0.4)"
              : "none"
          }}
          >
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div className={cn(
            "p-2.5 rounded-lg transition-all duration-300 group-hover:scale-110",
            isProfit && "bg-profit/10 text-profit",
            isLoss && "bg-loss/10 text-loss",
            !trend && "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
          )}>
            {icon}
          </div>
        )}
      </div>

      {/* Subtle shine effect */}
      <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] via-transparent to-transparent" />
      </div>
    </div>
  );
}
