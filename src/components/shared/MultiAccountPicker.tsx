import { useState } from "react";
import { Check, ChevronsUpDown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Account } from "@/types/trading";

interface MultiAccountPickerProps {
  accounts: Account[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  singleSelect?: boolean;
  singleSelectHint?: string;
}

export function MultiAccountPicker({
  accounts,
  selectedIds,
  onChange,
  disabled,
  singleSelect,
  singleSelectHint,
}: MultiAccountPickerProps) {
  const [open, setOpen] = useState(false);

  const toggle = (id: string) => {
    if (singleSelect) {
      onChange([id]);
      setOpen(false);
      return;
    }
    if (selectedIds.includes(id)) {
      // Don't allow deselecting last one
      if (selectedIds.length === 1) return;
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const label =
    selectedIds.length === 0
      ? "Select account"
      : selectedIds.length === 1
        ? accounts.find((a) => a.id === selectedIds[0])?.name ?? "1 account"
        : `${selectedIds.length} accounts`;

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className="flex items-center gap-2 truncate">
              {selectedIds.length > 1 && <Users className="h-3.5 w-3.5" />}
              {label}
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-1" align="start">
          {accounts.map((acct) => {
            const checked = selectedIds.includes(acct.id);
            return (
              <button
                key={acct.id}
                type="button"
                onClick={() => toggle(acct.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent text-left",
                  checked && "bg-accent/50"
                )}
              >
                {!singleSelect && (
                  <Checkbox checked={checked} className="pointer-events-none" />
                )}
                <span className="flex-1 truncate">{acct.name}</span>
                {acct.balance_start ? (
                  <span className="text-xs text-muted-foreground">
                    ${acct.balance_start.toLocaleString()}
                  </span>
                ) : null}
                {singleSelect && checked && <Check className="h-4 w-4" />}
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
      {selectedIds.length > 1 && (
        <Badge variant="secondary" className="text-xs">
          Mirroring to {selectedIds.length} accounts
        </Badge>
      )}
      {singleSelect && singleSelectHint && (
        <p className="text-xs text-muted-foreground">{singleSelectHint}</p>
      )}
    </div>
  );
}
