import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COLOR_PALETTE } from "@/lib/colorPalette";
import { cn } from "@/lib/utils";

interface ColorSwatchPickerProps {
  value?: string;
  onChange: (color: string) => void;
  size?: "sm" | "md";
  className?: string;
}

export function ColorSwatchPicker({ value, onChange, size = "md", className }: ColorSwatchPickerProps) {
  const [open, setOpen] = useState(false);
  const dimension = size === "sm" ? "w-4 h-4" : "w-5 h-5";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Pick color"
          className={cn(
            dimension,
            "rounded-full border border-border/60 ring-offset-background transition-all hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex-shrink-0",
            className,
          )}
          style={{ backgroundColor: value || "#6B7280" }}
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="grid grid-cols-6 gap-1.5">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className={cn(
                "w-6 h-6 rounded-full transition-all hover:scale-110",
                value === c && "ring-2 ring-offset-2 ring-offset-background ring-foreground",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
