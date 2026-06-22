// Commit-on-blur numeric input. Free typing (incl. empty / partial decimals)
// without value snap-back; clamps only on blur or Enter.
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  value: number;
  onCommit: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  id?: string;
}

export function NumericInput({ value, onCommit, min, max, step, className, id }: Props) {
  const [raw, setRaw] = useState<string>(String(value));

  // Keep local state in sync if the parent resets the value.
  useEffect(() => {
    setRaw(String(value));
  }, [value]);

  const commit = () => {
    if (raw.trim() === "" || raw === "-" || raw === ".") {
      setRaw(String(value));
      return;
    }
    let n = Number(raw);
    if (!Number.isFinite(n)) {
      setRaw(String(value));
      return;
    }
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    setRaw(String(n));
    if (n !== value) onCommit(n);
  };

  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      value={raw}
      step={step}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      className={cn("h-8", className)}
    />
  );
}
