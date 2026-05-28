import { useCallback, useRef } from "react";

/**
 * Debounced callback. Returns a stable function that delays invoking `fn`
 * until `delay` ms have elapsed since the last call. The latest `fn` is
 * captured via a ref so closures see fresh state without resetting the timer.
 */
export function useDebouncedCallback<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  return useCallback(
    (...args: Parameters<T>) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay],
  );
}
