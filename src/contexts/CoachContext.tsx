import * as React from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { CoachContextTarget } from "@/types/coach";

interface CoachContextValue {
  open: boolean;
  activeThreadId: string | null;
  attached: CoachContextTarget | null;
  openCoach: (opts?: { threadId?: string | null; attached?: CoachContextTarget | null }) => void;
  closeCoach: () => void;
  setActiveThreadId: (id: string | null) => void;
  clearAttached: () => void;
}

const Ctx = createContext<CoachContextValue | undefined>(undefined);

export function CoachProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [attached, setAttached] = useState<CoachContextTarget | null>(null);

  const openCoach = useCallback((opts?: { threadId?: string | null; attached?: CoachContextTarget | null }) => {
    if (opts?.threadId !== undefined) setActiveThreadId(opts.threadId);
    if (opts?.attached !== undefined) setAttached(opts.attached);
    setOpen(true);
  }, []);

  const closeCoach = useCallback(() => setOpen(false), []);
  const clearAttached = useCallback(() => setAttached(null), []);

  const value = useMemo<CoachContextValue>(
    () => ({ open, activeThreadId, attached, openCoach, closeCoach, setActiveThreadId, clearAttached }),
    [open, activeThreadId, attached, openCoach, closeCoach, clearAttached],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCoachPanel() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCoachPanel must be used inside CoachProvider");
  return v;
}
