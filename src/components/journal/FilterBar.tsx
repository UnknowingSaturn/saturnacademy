import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, X, Filter, ChevronDown } from "lucide-react";
import { FilterCondition, FilterOperator, DEFAULT_COLUMNS } from "@/types/settings";
import { cn } from "@/lib/utils";

interface FilterBarProps {
  filters: FilterCondition[];
  onFiltersChange: (filters: FilterCondition[]) => void;
}

const OPERATORS: { value: FilterOperator; label: string; types: string[] }[] = [
  { value: 'equals', label: '=', types: ['text', 'number', 'select', 'badge'] },
  { value: 'not_equals', label: '≠', types: ['text', 'number', 'select', 'badge'] },
  { value: 'contains', label: 'contains', types: ['text'] },
  { value: 'greater_than', label: '>', types: ['number', 'date'] },
  { value: 'less_than', label: '<', types: ['number', 'date'] },
  { value: 'is_empty', label: 'is empty', types: ['text', 'number', 'select'] },
  { value: 'is_not_empty', label: 'is not empty', types: ['text', 'number', 'select'] },
];

export function FilterBar({ filters, onFiltersChange }: FilterBarProps) {
  const [showAddFilter, setShowAddFilter] = useState(false);
  const [newFilter, setNewFilter] = useState<Partial<FilterCondition>>({
    column: '',
    operator: 'equals',
    value: '',
  });

  const handleAddFilter = () => {
    if (!newFilter.column) return;

    const filter: FilterCondition = {
      id: crypto.randomUUID(),
      column: newFilter.column,
      operator: newFilter.operator as FilterOperator,
      value: newFilter.value || null,
    };

    onFiltersChange([...filters, filter]);
    setShowAddFilter(false);
    setNewFilter({ column: '', operator: 'equals', value: '' });
  };

  const handleRemoveFilter = (id: string) => {
    onFiltersChange(filters.filter(f => f.id !== id));
  };

  const handleClearAll = () => {
    onFiltersChange([]);
  };

  const getColumnDef = (key: string) => DEFAULT_COLUMNS.find(c => c.key === key);
  const getColumnLabel = (key: string) => getColumnDef(key)?.label || key;

  const getOperatorsForColumn = (columnKey: string) => {
    const column = getColumnDef(columnKey);
    if (!column) return OPERATORS;
    return OPERATORS.filter(op => op.types.includes(column.type));
  };

  const getOperatorLabel = (op: FilterOperator) => {
    return OPERATORS.find(o => o.value === op)?.label || op;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Active Filters */}
      {filters.map((filter) => (
        <div
          key={filter.id}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-sm border border-border"
        >
          <span className="font-medium text-muted-foreground">{getColumnLabel(filter.column)}</span>
          <span className="text-muted-foreground">{getOperatorLabel(filter.operator)}</span>
          {filter.value !== null && filter.operator !== 'is_empty' && filter.operator !== 'is_not_empty' && (
            <span className="font-medium">{String(filter.value)}</span>
          )}
          <button
            onClick={() => handleRemoveFilter(filter.id)}
            className="ml-1 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}

      {/* Add Filter Popover */}
      <Popover open={showAddFilter} onOpenChange={setShowAddFilter}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
            <Plus className="w-3 h-3" />
            Filter
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3" align="start">
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Column</label>
              <Select
                value={newFilter.column}
                onValueChange={(v) => setNewFilter({ ...newFilter, column: v, operator: 'equals', value: '' })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent>
                  {DEFAULT_COLUMNS.filter(c => c.filterable).map((column) => (
                    <SelectItem key={column.key} value={column.key}>
                      {column.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {newFilter.column && (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Condition</label>
                  <Select
                    value={newFilter.operator}
                    onValueChange={(v) => setNewFilter({ ...newFilter, operator: v as FilterOperator })}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getOperatorsForColumn(newFilter.column).map((op) => (
                        <SelectItem key={op.value} value={op.value}>
                          {op.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {newFilter.operator !== 'is_empty' && newFilter.operator !== 'is_not_empty' && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Value</label>
                    <Input
                      value={newFilter.value as string || ''}
                      onChange={(e) => setNewFilter({ ...newFilter, value: e.target.value })}
                      placeholder="Enter value"
                      className="h-8 text-sm"
                    />
                  </div>
                )}

                <Button onClick={handleAddFilter} size="sm" className="w-full">
                  Add Filter
                </Button>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Clear All */}
      {filters.length > 0 && (
        <button
          onClick={handleClearAll}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
