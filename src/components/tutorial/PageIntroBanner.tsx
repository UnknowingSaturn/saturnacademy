import { useState } from "react";
import { X, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isDismissed, setDismissed } from "@/lib/tutorialStorage";

interface PageIntroBannerProps {
  routeKey: string;
  title: string;
  body: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Dismissible top-of-page banner. Persists dismissal in localStorage
 * under `tutorial.intro.<routeKey>` so it never re-appears for that user.
 */
export function PageIntroBanner({
  routeKey,
  title,
  body,
  actionLabel,
  onAction,
}: PageIntroBannerProps) {
  const storageKey = `intro.${routeKey}`;
  const [hidden, setHidden] = useState(() => isDismissed(storageKey));

  if (hidden) return null;

  const dismiss = () => {
    setDismissed(storageKey);
    setHidden(true);
  };

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4"
    >
      <div className="mt-0.5 shrink-0 rounded-md bg-primary/10 p-1.5 text-primary">
        <Lightbulb className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-sm leading-relaxed text-muted-foreground">
          {body}
        </div>
        {actionLabel && onAction && (
          <div className="pt-1">
            <Button size="sm" variant="outline" onClick={onAction}>
              {actionLabel}
            </Button>
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={dismiss}
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
