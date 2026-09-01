import { useState, useEffect, useRef, useCallback } from 'react';
import { canonicalStringify } from '@/lib/canonicalJson';

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
  /** Canonical signature of the last payload this hook persisted. */
  lastSavedSignature: () => string;
}

export function useAutoSave<T>(
  data: T,
  saveFn: (data: T) => Promise<void>,
  options: UseAutoSaveOptions = {}
): UseAutoSaveReturn<T> {
  const { delay = 500, enabled = true, storageKey } = options;

  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  /** A change arrived while a save was in flight — save again when it settles. */
  const pendingRef = useRef(false);
  const lastSavedRef = useRef<string>('');
  const saveFnRef = useRef(saveFn);
  /** Always points at the live data so a coalesced save never sends a stale copy. */
  const dataRef = useRef(data);
  dataRef.current = data;

  const prevStorageKeyRef = useRef<string | undefined>(storageKey);

  // Keep saveFn ref updated
  useEffect(() => {
    saveFnRef.current = saveFn;
  }, [saveFn]);

  // Canonical (key-order / null-vs-"" insensitive) signature of the current data.
  const currentDataStr = canonicalStringify(data);

  // Reset state when storageKey (document ID) changes - prevents phantom saves
  useEffect(() => {
    if (storageKey !== prevStorageKeyRef.current) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      lastSavedRef.current = canonicalStringify(dataRef.current);
      savingRef.current = false;
      pendingRef.current = false;
      setStatus('idle');
      setError(null);
      prevStorageKeyRef.current = storageKey;
    }
  }, [storageKey]);

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

  // Perform save. Always sends the latest data (never a stale debounce capture)
  // and coalesces changes that land mid-flight instead of dropping them.
  const performSave = useCallback(async () => {
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }

    savingRef.current = true;
    setStatus('saving');
    setError(null);

    const snapshot = dataRef.current;
    const snapshotSig = canonicalStringify(snapshot);

    try {
      await saveFnRef.current(snapshot);
      lastSavedRef.current = snapshotSig;
      setStatus('saved');
      clearDraft(); // Clear localStorage only after successful save

      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 2000);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err : new Error('Save failed'));
      savingRef.current = false;
      pendingRef.current = false;
      return;
    }

    savingRef.current = false;

    // Anything the user changed while the request was in flight gets saved now.
    const hadPending = pendingRef.current;
    pendingRef.current = false;
    if (hadPending && canonicalStringify(dataRef.current) !== lastSavedRef.current) {
      void performSave();
    }
  }, [clearDraft]);

  // Manual save
  const flush = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (canonicalStringify(dataRef.current) !== lastSavedRef.current && lastSavedRef.current !== '') {
      await performSave();
    }
  }, [performSave]);

  const save = flush;

  const lastSavedSignature = useCallback(() => lastSavedRef.current, []);

  // Auto-save effect
  useEffect(() => {
    if (!enabled) return;

    // Initialize on first render
    if (lastSavedRef.current === '') {
      lastSavedRef.current = currentDataStr;
      return;
    }

    // No real change (key reordering / null-vs-"" echoes are not changes)
    if (currentDataStr === lastSavedRef.current) return;

    // Save to localStorage immediately (crash recovery)
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(dataRef.current));
      } catch {}
    }

    setStatus((s) => (s === 'saving' ? s : 'unsaved'));

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      void performSave();
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
    lastSavedSignature,
  };
}
