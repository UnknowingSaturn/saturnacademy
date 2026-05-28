import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HintPopoverProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}

/**
 * Inline `(?)` icon you can drop next to any label or control.
 * Click opens a small popover with helper copy.
 */
export function HintPopover({ title, children, className, side = "top" }: HintPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-6 w-6 text-muted-foreground hover:text-foreground",
            className,
          )}
          aria-label={title ? `Help: ${title}` : "Help"}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side={side} className="w-80 text-sm leading-relaxed">
        {title && <div className="mb-1.5 font-medium text-foreground">{title}</div>}
        <div className="text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
