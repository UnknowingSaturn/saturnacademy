import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, ArrowUp, ArrowDown, Filter, EyeOff, Settings2 } from "lucide-react";
import { ColumnDefinition } from "@/types/settings";
import { cn } from "@/lib/utils";

interface ColumnHeaderMenuProps {
  column: ColumnDefinition;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (column: string, direction: 'asc' | 'desc') => void;
  onFilter: (column: string) => void;
  onHide: (column: string) => void;
  onEditProperty?: (propertyName: string) => void;
  children: React.ReactNode;
}

export function ColumnHeaderMenu({
  column,
  sortColumn,
  sortDirection,
  onSort,
  onFilter,
  onHide,
  onEditProperty,
  children,
}: ColumnHeaderMenuProps) {
  const isSorted = sortColumn === column.key;
  const isAsc = isSorted && sortDirection === 'asc';
  const isDesc = isSorted && sortDirection === 'desc';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 hover:text-foreground transition-colors group">
          {children}
          <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          {isAsc && <ArrowUp className="w-3 h-3 text-primary" />}
          {isDesc && <ArrowDown className="w-3 h-3 text-primary" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {column.sortable && (
          <>
            <DropdownMenuItem onClick={() => onSort(column.key, 'asc')}>
              <ArrowUp className="w-4 h-4 mr-2" />
              Sort Ascending
              {isAsc && <span className="ml-auto text-xs text-primary">✓</span>}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSort(column.key, 'desc')}>
              <ArrowDown className="w-4 h-4 mr-2" />
              Sort Descending
              {isDesc && <span className="ml-auto text-xs text-primary">✓</span>}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {column.filterable && (
          <DropdownMenuItem onClick={() => onFilter(column.key)}>
            <Filter className="w-4 h-4 mr-2" />
            Filter by {column.label}
          </DropdownMenuItem>
        )}

        {column.hideable && (
          <DropdownMenuItem onClick={() => onHide(column.key)}>
            <EyeOff className="w-4 h-4 mr-2" />
            Hide Column
          </DropdownMenuItem>
        )}

        {column.propertyName && onEditProperty && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onEditProperty(column.propertyName!)}>
              <Settings2 className="w-4 h-4 mr-2" />
              Edit {column.label} Options
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
