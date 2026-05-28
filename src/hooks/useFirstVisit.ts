import { useEffect, useState } from "react";
import { isDismissed, setDismissed } from "@/lib/tutorialStorage";

/**
 * Returns `true` the first time a given route key is visited, then `false`
 * forever after. Useful for auto-opening a tutorial dialog once.
 */
export function useFirstVisit(routeKey: string): boolean {
  const key = `firstVisit.${routeKey}`;
  const [firstVisit, setFirstVisit] = useState(false);

  useEffect(() => {
    if (!isDismissed(key)) {
      setFirstVisit(true);
      setDismissed(key);
    }
  }, [key]);

  return firstVisit;
}
