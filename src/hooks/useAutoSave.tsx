import { useState, useEffect, useRef, useCallback } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unsaved';

interface UseAutoSaveOptions {
  delay?: number;
  enabled?: boolean;
  storageKey?: string; // For localStorage backup
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
  const { delay = 800, enabled = true, storageKey } = options;
  
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  
  const lastSavedDataRef = useRef<string>('');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const savingRef = useRef(false);
  const pendingDataRef = useRef<T | null>(null);
  const latestDataRef = useRef<T>(data);
  const saveFnRef = useRef(saveFn);

  // Keep refs updated
  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  useEffect(() => {
    saveFnRef.current = saveFn;
  }, [saveFn]);

  const currentDataStr = JSON.stringify(data);
  const hasUnsavedChanges = lastSavedDataRef.current !== '' && currentDataStr !== lastSavedDataRef.current;

  // Check for existing draft on mount
  useEffect(() => {
    if (storageKey) {
      const draft = localStorage.getItem(storageKey);
      setHasDraft(!!draft);
    }
  }, [storageKey]);

  // Update status to show unsaved changes
  useEffect(() => {
    if (hasUnsavedChanges && status === 'idle') {
      setStatus('unsaved');
    }
  }, [hasUnsavedChanges, status]);

  // Save to localStorage as backup
  const saveDraft = useCallback((dataToSave: T) => {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(dataToSave));
        setHasDraft(true);
      } catch (e) {
        console.warn('Failed to save draft to localStorage:', e);
      }
    }
  }, [storageKey]);

  // Clear localStorage draft
  const clearDraft = useCallback(() => {
    if (storageKey) {
      localStorage.removeItem(storageKey);
      setHasDraft(false);
    }
  }, [storageKey]);

  // Restore draft from localStorage
  const restoreDraft = useCallback((): T | null => {
    if (!storageKey) return null;
    try {
      const draft = localStorage.getItem(storageKey);
      if (draft) {
        return JSON.parse(draft) as T;
      }
    } catch (e) {
      console.warn('Failed to restore draft:', e);
    }
    return null;
  }, [storageKey]);

  // Perform the actual save
  const performSave = useCallback(async (dataToSave: T) => {
    if (savingRef.current) {
      // Queue this data for saving after current save completes
      pendingDataRef.current = dataToSave;
      return;
    }

    savingRef.current = true;
    setStatus('saving');
    setError(null);

    try {
      await saveFnRef.current(dataToSave);
      if (isMountedRef.current) {
        lastSavedDataRef.current = JSON.stringify(dataToSave);
        setStatus('saved');
        clearDraft(); // Clear localStorage backup after successful save
        
        // Fade back to idle after showing "saved"
        setTimeout(() => {
          if (isMountedRef.current) {
            setStatus('idle');
          }
        }, 2000);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setStatus('error');
        setError(err instanceof Error ? err : new Error('Save failed'));
        // Keep the draft in localStorage on error for recovery
      }
    } finally {
      savingRef.current = false;
      
      // Check if there's pending data to save
      if (pendingDataRef.current && isMountedRef.current) {
        const pending = pendingDataRef.current;
        pendingDataRef.current = null;
        performSave(pending);
      }
    }
  }, [clearDraft]);

  // Force immediate save
  const flush = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    const dataToSave = latestDataRef.current;
    const dataStr = JSON.stringify(dataToSave);
    
    // Only save if there are actual changes
    if (dataStr !== lastSavedDataRef.current && lastSavedDataRef.current !== '') {
      await performSave(dataToSave);
    }
  }, [performSave]);

  // Manual save trigger (same as flush but exposed as 'save')
  const save = flush;

  // Debounced auto-save effect
  useEffect(() => {
    if (!enabled) return;

    // Initialize lastSavedDataRef on first render with data
    if (lastSavedDataRef.current === '') {
      lastSavedDataRef.current = currentDataStr;
      return;
    }

    // Only trigger save if data actually changed
    if (currentDataStr === lastSavedDataRef.current) return;

    // Save draft to localStorage immediately for crash recovery
    saveDraft(data);

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new debounce timeout
    timeoutRef.current = setTimeout(() => {
      performSave(JSON.parse(currentDataStr));
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [currentDataStr, delay, enabled, performSave, saveDraft, data]);

  // beforeunload handler - warn user before closing browser
  useEffect(() => {
    if (!enabled) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [enabled, hasUnsavedChanges]);

  // visibilitychange handler - save when tab becomes hidden
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.hidden && hasUnsavedChanges) {
        // Immediately save when user switches tabs
        flush();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled, hasUnsavedChanges, flush]);

  // Cleanup and flush on unmount
  useEffect(() => {
    isMountedRef.current = true;
    
    return () => {
      isMountedRef.current = false;
      
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      
      // Flush pending changes on unmount using sendBeacon for reliability
      const dataStr = JSON.stringify(latestDataRef.current);
      if (dataStr !== lastSavedDataRef.current && lastSavedDataRef.current !== '') {
        // Try to save synchronously - this will work if component unmounts normally
        saveFnRef.current(latestDataRef.current).catch(() => {
          // If async save fails, at least the data is in localStorage
          console.warn('Failed to save on unmount, data preserved in localStorage');
        });
      }
    };
  }, []);

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
