import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Branded coach identity mark — a small gradient orb with a rising-chart glyph.
 * Used in the header, empty state, and assistant avatar. Replaces generic Sparkles.
 */
export function CoachMark({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full shrink-0",
        "bg-gradient-to-br from-primary via-primary/80 to-[hsl(var(--chart-5))]",
        "shadow-[0_0_0_1px_hsl(var(--primary)/0.25),0_6px_20px_-6px_hsl(var(--primary)/0.55)]",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" stroke="white" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 17 L10 11 L14 15 L20 7" />
        <path d="M15 7 L20 7 L20 12" />
      </svg>
    </span>
  );
}
