import React, { createContext, useContext, useState, useCallback, useRef } from "react";

type PendingType = "chat" | "compliance" | "questions";

interface LiveTradesContextValue {
  selectedTradeId: string | null;
  setSelectedTradeId: (id: string | null) => void;
  // Pending saves tracking for flush on navigation
  registerPendingSave: (tradeId: string, type: PendingType) => void;
  unregisterPendingSave: (tradeId: string, type: PendingType) => void;
  hasPendingSave: (tradeId: string) => boolean;
}

const LiveTradesContext = createContext<LiveTradesContextValue | null>(null);

export function LiveTradesProvider({ children }: { children: React.ReactNode }) {
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const pendingSavesRef = useRef<Map<string, Set<PendingType>>>(new Map());

  const registerPendingSave = useCallback((tradeId: string, type: PendingType) => {
    if (!pendingSavesRef.current.has(tradeId)) {
      pendingSavesRef.current.set(tradeId, new Set());
    }
    pendingSavesRef.current.get(tradeId)!.add(type);
  }, []);

  const unregisterPendingSave = useCallback((tradeId: string, type: PendingType) => {
    pendingSavesRef.current.get(tradeId)?.delete(type);
    if (pendingSavesRef.current.get(tradeId)?.size === 0) {
      pendingSavesRef.current.delete(tradeId);
    }
  }, []);

  const hasPendingSave = useCallback((tradeId: string) => {
    return (pendingSavesRef.current.get(tradeId)?.size ?? 0) > 0;
  }, []);

  return (
    <LiveTradesContext.Provider
      value={{
        selectedTradeId,
        setSelectedTradeId,
        registerPendingSave,
        unregisterPendingSave,
        hasPendingSave,
      }}
    >
      {children}
    </LiveTradesContext.Provider>
  );
}

export function useLiveTrades() {
  const context = useContext(LiveTradesContext);
  if (!context) {
    throw new Error("useLiveTrades must be used within a LiveTradesProvider");
  }
  return context;
}
