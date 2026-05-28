/**
 * Tutorial / hint storage helpers.
 * All keys are namespaced under `tutorial.` so a single reset can clear them.
 */

const PREFIX = "tutorial.";

export function isDismissed(key: string): boolean {
  try {
    return localStorage.getItem(PREFIX + key) === "1";
  } catch {
    return false;
  }
}

export function setDismissed(key: string): void {
  try {
    localStorage.setItem(PREFIX + key, "1");
  } catch {
    /* ignore quota / privacy mode */
  }
}

export function clearDismissed(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Remove every tutorial.* key — wired to a "Reset tutorials" action later. */
export function resetAllTutorials(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

// Expose to window for power users / debugging.
if (typeof window !== "undefined") {
  (window as unknown as { resetTutorials?: () => void }).resetTutorials =
    resetAllTutorials;
}
