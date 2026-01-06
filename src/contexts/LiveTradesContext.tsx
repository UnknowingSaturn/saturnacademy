import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatState {
  messages: Message[];
  quickResponses: string[];
  savedData: Record<string, any>;
}

interface ComplianceState {
  manualAnswers: Record<string, boolean>;
}

interface LiveTradesState {
  selectedTradeId: string | null;
  chatStates: Map<string, ChatState>;
  complianceStates: Map<string, ComplianceState>;
}

interface LiveTradesContextValue {
  selectedTradeId: string | null;
  setSelectedTradeId: (id: string | null) => void;
  
  // Chat state management
  getChatState: (tradeId: string) => ChatState | undefined;
  setChatState: (tradeId: string, state: ChatState) => void;
  updateChatMessages: (tradeId: string, messages: Message[]) => void;
  updateQuickResponses: (tradeId: string, responses: string[]) => void;
  updateSavedData: (tradeId: string, data: Record<string, any>) => void;
  clearChatState: (tradeId: string) => void;
  
  // Compliance state management
  getComplianceState: (tradeId: string) => ComplianceState | undefined;
  setComplianceState: (tradeId: string, state: ComplianceState) => void;
  updateManualAnswers: (tradeId: string, answers: Record<string, boolean>) => void;
  
  // Pending saves tracking for flush on navigation
  registerPendingSave: (tradeId: string, type: 'chat' | 'compliance') => void;
  unregisterPendingSave: (tradeId: string, type: 'chat' | 'compliance') => void;
  hasPendingSave: (tradeId: string) => boolean;
}

const LiveTradesContext = createContext<LiveTradesContextValue | null>(null);

export function LiveTradesProvider({ children }: { children: React.ReactNode }) {
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [chatStates, setChatStates] = useState<Map<string, ChatState>>(new Map());
  const [complianceStates, setComplianceStates] = useState<Map<string, ComplianceState>>(new Map());
  const pendingSavesRef = useRef<Map<string, Set<'chat' | 'compliance'>>>(new Map());

  // Chat state management
  const getChatState = useCallback((tradeId: string) => {
    return chatStates.get(tradeId);
  }, [chatStates]);

  const setChatState = useCallback((tradeId: string, state: ChatState) => {
    setChatStates(prev => {
      const next = new Map(prev);
      next.set(tradeId, state);
      return next;
    });
  }, []);

  const updateChatMessages = useCallback((tradeId: string, messages: Message[]) => {
    setChatStates(prev => {
      const next = new Map(prev);
      const existing = next.get(tradeId) || { messages: [], quickResponses: [], savedData: {} };
      next.set(tradeId, { ...existing, messages });
      return next;
    });
  }, []);

  const updateQuickResponses = useCallback((tradeId: string, responses: string[]) => {
    setChatStates(prev => {
      const next = new Map(prev);
      const existing = next.get(tradeId) || { messages: [], quickResponses: [], savedData: {} };
      next.set(tradeId, { ...existing, quickResponses: responses });
      return next;
    });
  }, []);

  const updateSavedData = useCallback((tradeId: string, data: Record<string, any>) => {
    setChatStates(prev => {
      const next = new Map(prev);
      const existing = next.get(tradeId) || { messages: [], quickResponses: [], savedData: {} };
      next.set(tradeId, { ...existing, savedData: { ...existing.savedData, ...data } });
      return next;
    });
  }, []);

  const clearChatState = useCallback((tradeId: string) => {
    setChatStates(prev => {
      const next = new Map(prev);
      next.delete(tradeId);
      return next;
    });
  }, []);

  // Compliance state management
  const getComplianceState = useCallback((tradeId: string) => {
    return complianceStates.get(tradeId);
  }, [complianceStates]);

  const setComplianceState = useCallback((tradeId: string, state: ComplianceState) => {
    setComplianceStates(prev => {
      const next = new Map(prev);
      next.set(tradeId, state);
      return next;
    });
  }, []);

  const updateManualAnswers = useCallback((tradeId: string, answers: Record<string, boolean>) => {
    setComplianceStates(prev => {
      const next = new Map(prev);
      next.set(tradeId, { manualAnswers: answers });
      return next;
    });
  }, []);

  // Pending saves tracking
  const registerPendingSave = useCallback((tradeId: string, type: 'chat' | 'compliance') => {
    if (!pendingSavesRef.current.has(tradeId)) {
      pendingSavesRef.current.set(tradeId, new Set());
    }
    pendingSavesRef.current.get(tradeId)!.add(type);
  }, []);

  const unregisterPendingSave = useCallback((tradeId: string, type: 'chat' | 'compliance') => {
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
        getChatState,
        setChatState,
        updateChatMessages,
        updateQuickResponses,
        updateSavedData,
        clearChatState,
        getComplianceState,
        setComplianceState,
        updateManualAnswers,
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
