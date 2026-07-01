import * as React from "react";
import { Sparkles } from "lucide-react";
import { useCoachPanel } from "@/contexts/CoachContext";
import { cn } from "@/lib/utils";
import { useLocation } from "react-router-dom";

/**
 * Floating Coach button. Hidden on auth pages, reset-password, and on /coach
 * (where the dedicated page already provides the surface).
 */
export function CoachFab() {
  const { openCoach, open } = useCoachPanel();
  const { pathname } = useLocation();
  const hidden =
    pathname.startsWith("/auth") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/r/") ||
    pathname.startsWith("/coach");
  if (hidden) return null;

  return (
    <button
      type="button"
      aria-label="Ask Coach"
      onClick={() => openCoach()}
      className={cn(
        "fixed bottom-5 right-5 z-40 h-12 pl-3 pr-4 rounded-full shadow-lg",
        "bg-primary text-primary-foreground hover:bg-primary/90 transition",
        "flex items-center gap-2 text-sm font-medium",
        open && "opacity-0 pointer-events-none",
      )}
    >
      <Sparkles className="w-4 h-4" />
      Ask Coach
    </button>
  );
}
