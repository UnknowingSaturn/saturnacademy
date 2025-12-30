import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Account } from "@/types/trading";
import { useAccounts } from "@/hooks/useAccounts";

const STORAGE_KEY = "tradelog-selected-account";

interface AccountFilterContextType {
  selectedAccountId: string | "all";
  setSelectedAccountId: (id: string | "all") => void;
  selectedAccount: Account | null;
  accounts: Account[];
  isLoading: boolean;
}

const AccountFilterContext = createContext<AccountFilterContextType | undefined>(undefined);

export function AccountFilterProvider({ children }: { children: ReactNode }) {
  const { data: accounts = [], isLoading } = useAccounts();
  const [selectedAccountId, setSelectedAccountIdState] = useState<string | "all">(() => {
    // Initialize from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored || "all";
  });

  // Persist to localStorage when selection changes
  const setSelectedAccountId = (id: string | "all") => {
    setSelectedAccountIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  // Validate stored account still exists
  useEffect(() => {
    if (!isLoading && selectedAccountId !== "all") {
      const accountExists = accounts.some(a => a.id === selectedAccountId);
      if (!accountExists) {
        setSelectedAccountId("all");
      }
    }
  }, [accounts, isLoading, selectedAccountId]);

  const selectedAccount = selectedAccountId === "all" 
    ? null 
    : accounts.find(a => a.id === selectedAccountId) || null;

  return (
    <AccountFilterContext.Provider
      value={{
        selectedAccountId,
        setSelectedAccountId,
        selectedAccount,
        accounts,
        isLoading,
      }}
    >
      {children}
    </AccountFilterContext.Provider>
  );
}

export function useAccountFilter() {
  const context = useContext(AccountFilterContext);
  if (!context) {
    throw new Error("useAccountFilter must be used within AccountFilterProvider");
  }
  return context;
}
