import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Check } from "lucide-react";

// Badge select component for dropdown selections with color badges

interface BadgeOption {
  value: string;
  label: string;
  color?: string;
  customColor?: string; // Hex color for custom styling
}

interface BadgeSelectProps {
  value: string | string[] | null;
  onChange: (value: string | string[]) => void;
  options: BadgeOption[];
  placeholder?: string;
  multiple?: boolean;
  allowClear?: boolean;
  className?: string;
}

const colorClasses: Record<string, string> = {
  profit: "bg-profit/15 text-profit border-profit/30",
  loss: "bg-loss/15 text-loss border-loss/30",
  breakeven: "bg-breakeven/15 text-breakeven border-breakeven/30",
  primary: "bg-primary/15 text-primary border-primary/30",
  muted: "bg-muted text-muted-foreground border-border",
  tokyo: "bg-[hsl(var(--session-tokyo)/0.15)] text-[hsl(var(--session-tokyo))] border-[hsl(var(--session-tokyo)/0.3)]",
  london: "bg-[hsl(var(--session-london)/0.15)] text-[hsl(var(--session-london))] border-[hsl(var(--session-london)/0.3)]",
  newyork: "bg-[hsl(var(--session-newyork)/0.15)] text-[hsl(var(--session-newyork))] border-[hsl(var(--session-newyork)/0.3)]",
  overlap: "bg-[hsl(var(--session-overlap)/0.15)] text-[hsl(var(--session-overlap))] border-[hsl(var(--session-overlap)/0.3)]",
};

export const BadgeSelect = React.forwardRef<HTMLDivElement, BadgeSelectProps>(
  function BadgeSelect(
    {
      value,
      onChange,
      options,
      placeholder = "Select...",
      multiple = false,
      allowClear = true,
      className,
    },
    forwardedRef
  ) {
    const [isOpen, setIsOpen] = useState(false);
    const internalRef = useRef<HTMLDivElement>(null);
    const ref = (forwardedRef as React.RefObject<HTMLDivElement>) || internalRef;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedValues = multiple
    ? (value as string[]) || []
    : value
    ? [value as string]
    : [];

  const handleSelect = (optionValue: string) => {
    if (multiple) {
      const current = (value as string[]) || [];
      const newValue = current.includes(optionValue)
        ? current.filter((v) => v !== optionValue)
        : [...current, optionValue];
      onChange(newValue);
    } else {
      // Toggle behavior: if already selected, clear it
      if (allowClear && value === optionValue) {
        onChange("");
      } else {
        onChange(optionValue);
      }
      setIsOpen(false);
    }
  };

  const handleClear = () => {
    if (multiple) {
      onChange([]);
    } else {
      onChange("");
    }
    setIsOpen(false);
  };

  const getOptionStyle = (option: BadgeOption): { className: string; style?: React.CSSProperties } => {
    // If customColor (hex) is provided, use inline styles
    if (option.customColor) {
      return {
        className: "border",
        style: {
          backgroundColor: `${option.customColor}26`, // 15% opacity
          color: option.customColor,
          borderColor: `${option.customColor}4D`, // 30% opacity
        },
      };
    }
    // Otherwise use theme color classes
    return {
      className: option.color ? colorClasses[option.color] || colorClasses.muted : colorClasses.muted,
    };
  };

  const selectedOptions = options.filter((opt) => selectedValues.includes(opt.value));

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-1 min-h-[28px] px-2 py-1 rounded-md border border-transparent",
          "hover:bg-accent/50 hover:border-border transition-colors text-sm",
          isOpen && "bg-accent border-border"
        )}
      >
        {selectedOptions.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {selectedOptions.map((opt) => {
              const optStyle = getOptionStyle(opt);
              return (
                <span
                  key={opt.value}
                  className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                    optStyle.className
                  )}
                  style={optStyle.style}
                >
                  {opt.label}
                </span>
              );
            })}
          </div>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <ChevronDown className="w-3 h-3 text-muted-foreground ml-auto shrink-0" />
      </button>

        {isOpen && (
          <div className="absolute z-50 mt-1 w-48 rounded-md border border-border bg-popover shadow-lg">
            <div className="p-1 max-h-60 overflow-auto">
              {/* Clear option when value is selected */}
              {allowClear && selectedValues.length > 0 && (
                <button
                  type="button"
                  onClick={handleClear}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm",
                    "hover:bg-accent transition-colors text-left text-muted-foreground"
                  )}
                >
                  <span className="text-xs">Clear selection</span>
                </button>
              )}
              {options.map((option) => {
                const isSelected = selectedValues.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSelect(option.value)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm",
                      "hover:bg-accent transition-colors text-left",
                      isSelected && "bg-accent/50"
                    )}
                  >
                    {(() => {
                      const optStyle = getOptionStyle(option);
                      return (
                        <span
                          className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                            optStyle.className
                          )}
                          style={optStyle.style}
                        >
                          {option.label}
                        </span>
                      );
                    })()}
                    {isSelected && <Check className="w-3 h-3 ml-auto text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }
);
BadgeSelect.displayName = "BadgeSelect";
