import { useState, useEffect, useRef, useCallback } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseAutoSaveOptions {
  delay?: number;
  enabled?: boolean;
}

interface UseAutoSaveReturn<T> {
  status: SaveStatus;
  save: () => Promise<void>;
  hasUnsavedChanges: boolean;
  error: Error | null;
}

export function useAutoSave<T>(
  data: T,
  saveFn: (data: T) => Promise<void>,
  options: UseAutoSaveOptions = {}
): UseAutoSaveReturn<T> {
  const { delay = 1500, enabled = true } = options;
  
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  
  const lastSavedDataRef = useRef<string>('');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const savingRef = useRef(false);
  const pendingDataRef = useRef<T | null>(null);

  const currentDataStr = JSON.stringify(data);
  const hasUnsavedChanges = lastSavedDataRef.current !== '' && currentDataStr !== lastSavedDataRef.current;

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
      await saveFn(dataToSave);
      if (isMountedRef.current) {
        lastSavedDataRef.current = JSON.stringify(dataToSave);
        setStatus('saved');
        
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
  }, [saveFn]);

  // Manual save trigger
  const save = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    await performSave(JSON.parse(currentDataStr));
  }, [performSave, currentDataStr]);

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
  }, [currentDataStr, delay, enabled, performSave]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Reset when data source changes (e.g., switching trades)
  const resetLastSaved = useCallback((newData: T) => {
    lastSavedDataRef.current = JSON.stringify(newData);
    setStatus('idle');
    setError(null);
  }, []);

  return {
    status,
    save,
    hasUnsavedChanges,
    error,
  };
}
