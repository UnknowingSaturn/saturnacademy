import { useState } from "react";
import { useUserSettings, useUpdateUserSettings } from "@/hooks/useUserSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Filter } from "lucide-react";
import { FilterCondition, FilterOperator, DEFAULT_COLUMNS } from "@/types/settings";
import { cn } from "@/lib/utils";

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Does not equal' },
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Does not contain' },
  { value: 'greater_than', label: 'Greater than' },
  { value: 'less_than', label: 'Less than' },
  { value: 'between', label: 'Between' },
  { value: 'is_empty', label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' },
];

export function FilterPresetsPanel() {
  const { data: settings, isLoading } = useUserSettings();
  const updateSettings = useUpdateUserSettings();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newFilter, setNewFilter] = useState<Partial<FilterCondition>>({
    column: '',
    operator: 'equals',
    value: '',
  });

  const filters = settings?.default_filters || [];

  const handleAddFilter = async () => {
    if (!newFilter.column) return;

    const filter: FilterCondition = {
      id: crypto.randomUUID(),
      column: newFilter.column!,
      operator: newFilter.operator as FilterOperator,
      value: newFilter.value || null,
    };

    await updateSettings.mutateAsync({
      default_filters: [...filters, filter],
    });

    setShowAddForm(false);
    setNewFilter({ column: '', operator: 'equals', value: '' });
  };

  const handleRemoveFilter = async (id: string) => {
    await updateSettings.mutateAsync({
      default_filters: filters.filter(f => f.id !== id),
    });
  };

  const handleClearAll = async () => {
    await updateSettings.mutateAsync({ default_filters: [] });
  };

  const getColumnLabel = (key: string) => {
    return DEFAULT_COLUMNS.find(c => c.key === key)?.label || key;
  };

  const getOperatorLabel = (op: FilterOperator) => {
    return OPERATORS.find(o => o.value === op)?.label || op;
  };

  if (isLoading) {
    return <div className="p-4 text-center text-muted-foreground">Loading filters...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Default Filters</h3>
          <p className="text-sm text-muted-foreground">Set default filters that apply when you open the journal</p>
        </div>
        <div className="flex gap-2">
          {filters.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleClearAll}>
              Clear All
            </Button>
          )}
          <Button size="sm" onClick={() => setShowAddForm(true)}>
            <Plus className="w-4 h-4 mr-1" />
            Add Filter
          </Button>
        </div>
      </div>

      {/* Add Filter Form */}
      {showAddForm && (
        <div className="border border-border rounded-lg p-4 space-y-4 bg-card">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Column</Label>
              <Select
                value={newFilter.column}
                onValueChange={(v) => setNewFilter({ ...newFilter, column: v })}
              >
                <SelectTrigger>
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

            <div className="space-y-2">
              <Label>Operator</Label>
              <Select
                value={newFilter.operator}
                onValueChange={(v) => setNewFilter({ ...newFilter, operator: v as FilterOperator })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((op) => (
                    <SelectItem key={op.value} value={op.value}>
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Value</Label>
              <Input
                value={newFilter.value as string || ''}
                onChange={(e) => setNewFilter({ ...newFilter, value: e.target.value })}
                placeholder="Enter value"
                disabled={newFilter.operator === 'is_empty' || newFilter.operator === 'is_not_empty'}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button>
            <Button onClick={handleAddFilter} disabled={!newFilter.column}>Add Filter</Button>
          </div>
        </div>
      )}

      {/* Filters List */}
      <div className="space-y-2">
        {filters.map((filter) => (
          <div
            key={filter.id}
            className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50"
          >
            <Filter className="w-4 h-4 text-muted-foreground" />
            
            <div className="flex-1 flex items-center gap-2 text-sm">
              <span className="font-medium">{getColumnLabel(filter.column)}</span>
              <span className="text-muted-foreground">{getOperatorLabel(filter.operator)}</span>
              {filter.value !== null && (
                <span className="px-2 py-0.5 bg-muted rounded text-xs">{String(filter.value)}</span>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => handleRemoveFilter(filter.id)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>

      {filters.length === 0 && !showAddForm && (
        <div className="text-center py-8 text-muted-foreground">
          <Filter className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No default filters set</p>
          <p className="text-xs">Add filters to apply them automatically when opening the journal</p>
        </div>
      )}
    </div>
  );
}
