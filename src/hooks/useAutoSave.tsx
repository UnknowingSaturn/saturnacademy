import { useState, useEffect, useRef, useCallback } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unsaved';

interface UseAutoSaveOptions {
  delay?: number;
  enabled?: boolean;
  storageKey?: string;
}

interface UseAutoSaveReturn<T> {
  status: SaveStatus;
  save: () => Promise<void>;
  flush: () => Promise<void>;
  hasUnsavedChanges: boolean;
  error: Error | null;
  hasDraft: boolean;
  clearDraft: () => void;
  restoreDraft: () => T | null;
}

export function useAutoSave<T>(
  data: T,
  saveFn: (data: T) => Promise<void>,
  options: UseAutoSaveOptions = {}
): UseAutoSaveReturn<T> {
  const { delay = 500, enabled = true, storageKey } = options;
  
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const savingRef = useRef(false);
  const lastSavedRef = useRef<string>('');
  const saveFnRef = useRef(saveFn);

  const prevStorageKeyRef = useRef<string | undefined>(storageKey);

  // Keep saveFn ref updated
  useEffect(() => {
    saveFnRef.current = saveFn;
  }, [saveFn]);

  // Reset state when storageKey (document ID) changes - prevents phantom saves
  useEffect(() => {
    if (storageKey !== prevStorageKeyRef.current) {
      // Clear any pending timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Reset baseline to current data
      lastSavedRef.current = JSON.stringify(data);
      savingRef.current = false;
      setStatus('idle');
      setError(null);
      prevStorageKeyRef.current = storageKey;
    }
  }, [storageKey, data]);

  const currentDataStr = JSON.stringify(data);
  const hasUnsavedChanges = lastSavedRef.current !== '' && currentDataStr !== lastSavedRef.current;

  // Check for existing draft
  const hasDraft = storageKey ? !!localStorage.getItem(storageKey) : false;

  // Clear draft from localStorage
  const clearDraft = useCallback(() => {
    if (storageKey) {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  // Restore draft from localStorage
  const restoreDraft = useCallback((): T | null => {
    if (!storageKey) return null;
    try {
      const draft = localStorage.getItem(storageKey);
      return draft ? JSON.parse(draft) : null;
    } catch {
      return null;
    }
  }, [storageKey]);

  // Perform save
  const performSave = useCallback(async (dataToSave: T) => {
    if (savingRef.current) return;
    
    savingRef.current = true;
    setStatus('saving');
    setError(null);

    try {
      await saveFnRef.current(dataToSave);
      const dataStr = JSON.stringify(dataToSave);
      lastSavedRef.current = dataStr;
      setStatus('saved');
      clearDraft(); // Clear localStorage only after successful save
      
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err : new Error('Save failed'));
    } finally {
      savingRef.current = false;
    }
  }, [clearDraft]);

  // Manual save
  const flush = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    const dataStr = JSON.stringify(data);
    if (dataStr !== lastSavedRef.current && lastSavedRef.current !== '') {
      await performSave(data);
    }
  }, [data, performSave]);

  const save = flush;

  // Auto-save effect
  useEffect(() => {
    if (!enabled) return;

    // Initialize on first render
    if (lastSavedRef.current === '') {
      lastSavedRef.current = currentDataStr;
      return;
    }

    // No changes
    if (currentDataStr === lastSavedRef.current) return;

    // Save to localStorage immediately (crash recovery)
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, currentDataStr);
      } catch {}
    }

    setStatus('unsaved');

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Debounce server save
    timeoutRef.current = setTimeout(() => {
      performSave(JSON.parse(currentDataStr));
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [currentDataStr, delay, enabled, performSave, storageKey]);

  // beforeunload warning
  useEffect(() => {
    if (!enabled) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes.';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [enabled, hasUnsavedChanges]);

  // Save on tab hide
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.hidden && hasUnsavedChanges) {
        flush();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled, hasUnsavedChanges, flush]);

  return {
    status,
    save,
    flush,
    hasUnsavedChanges,
    error,
    hasDraft,
    clearDraft,
    restoreDraft,
  };
}
