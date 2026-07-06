import * as React from "react";
import { useCoachPanel } from "@/contexts/CoachContext";
import { cn } from "@/lib/utils";
import { useLocation } from "react-router-dom";
import { CoachMark } from "./CoachMark";

/**
 * Floating Coach button. Hidden on auth pages, reset-password, and on /coach.
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
        "fixed bottom-5 right-5 z-40 h-12 pl-2 pr-4 rounded-full",
        "bg-card/80 backdrop-blur border border-border shadow-lg hover:shadow-xl",
        "hover:bg-accent transition flex items-center gap-2 text-sm font-medium text-foreground",
        open && "opacity-0 pointer-events-none",
      )}
    >
      <CoachMark size={32} />
      Ask Coach
    </button>
  );
}
