import { useUserSettings, useUpdateUserSettings } from "@/hooks/useUserSettings";
import { DEFAULT_COLUMNS, DEFAULT_VISIBLE_COLUMNS } from "@/types/settings";
import { Switch } from "@/components/ui/switch";
import { GripVertical, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function ColumnConfigPanel() {
  const { data: settings, isLoading } = useUserSettings();
  const updateSettings = useUpdateUserSettings();

  const visibleColumns = settings?.visible_columns || DEFAULT_VISIBLE_COLUMNS;
  const columnOrder = settings?.column_order || DEFAULT_VISIBLE_COLUMNS;

  const handleToggleColumn = async (columnKey: string) => {
    const newVisibleColumns = visibleColumns.includes(columnKey)
      ? visibleColumns.filter(c => c !== columnKey)
      : [...visibleColumns, columnKey];
    
    await updateSettings.mutateAsync({ visible_columns: newVisibleColumns });
  };

  const handleShowAll = async () => {
    await updateSettings.mutateAsync({ 
      visible_columns: DEFAULT_COLUMNS.map(c => c.key) 
    });
  };

  const handleHideOptional = async () => {
    const required = DEFAULT_COLUMNS.filter(c => !c.hideable).map(c => c.key);
    await updateSettings.mutateAsync({ visible_columns: required });
  };

  if (isLoading) {
    return <div className="p-4 text-center text-muted-foreground">Loading columns...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Column Visibility</h3>
          <p className="text-sm text-muted-foreground">Choose which columns to display in the trade table</p>
        </div>
        <div className="flex gap-2">
          <button 
            className="text-xs text-muted-foreground hover:text-foreground underline"
            onClick={handleShowAll}
          >
            Show All
          </button>
          <button 
            className="text-xs text-muted-foreground hover:text-foreground underline"
            onClick={handleHideOptional}
          >
            Show Required Only
          </button>
        </div>
      </div>

      {/* Column List */}
      <div className="space-y-2">
        {DEFAULT_COLUMNS.map((column) => {
          const isVisible = visibleColumns.includes(column.key);
          const isRequired = !column.hideable;

          return (
            <div
              key={column.key}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50 transition-colors",
                !isVisible && "opacity-50"
              )}
            >
              <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
              
              <div className="flex-1 min-w-0">
                <div className="font-medium">{column.label}</div>
                <div className="text-xs text-muted-foreground">
                  {column.type} • {column.sortable ? 'Sortable' : 'Not sortable'}
                  {isRequired && ' • Required'}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isVisible ? (
                  <Eye className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <EyeOff className="w-4 h-4 text-muted-foreground" />
                )}
                <Switch
                  checked={isVisible}
                  onCheckedChange={() => handleToggleColumn(column.key)}
                  disabled={isRequired}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Drag columns to reorder. Required columns cannot be hidden.
      </p>
    </div>
  );
}
