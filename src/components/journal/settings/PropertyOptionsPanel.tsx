import { useState } from "react";
import { usePropertyOptions, useCreatePropertyOption, useUpdatePropertyOption, useDeletePropertyOption } from "@/hooks/useUserSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, GripVertical, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { PropertyOption } from "@/types/settings";

const PROPERTY_TYPES = [
  { value: 'model', label: 'Model' },
  { value: 'profile', label: 'Profile' },
  { value: 'timeframe', label: 'Timeframe' },
  { value: 'emotion', label: 'Emotion' },
];

const COLOR_OPTIONS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', 
  '#22C55E', '#10B981', '#14B8A6', '#06B6D4', '#0EA5E9', 
  '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7', '#D946EF',
  '#EC4899', '#F43F5E', '#6B7280'
];

export function PropertyOptionsPanel() {
  const [selectedProperty, setSelectedProperty] = useState('model');
  const { data: options = [], isLoading } = usePropertyOptions(selectedProperty);
  const createOption = useCreatePropertyOption();
  const updateOption = useUpdatePropertyOption();
  const deleteOption = useDeletePropertyOption();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newOption, setNewOption] = useState({
    value: '',
    label: '',
    color: '#3B82F6',
  });

  const handleAddOption = async () => {
    const value = newOption.label.toLowerCase().replace(/\s+/g, '_');
    await createOption.mutateAsync({
      property_name: selectedProperty,
      value,
      label: newOption.label,
      color: newOption.color,
      sort_order: options.length,
      is_active: true,
    });
    setShowAddForm(false);
    setNewOption({ value: '', label: '', color: '#3B82F6' });
  };

  const handleUpdateOption = async (id: string, updates: Partial<PropertyOption>) => {
    if (id.startsWith('default-')) {
      // For default options, create a new one
      const option = options.find(o => o.id === id);
      if (option) {
        await createOption.mutateAsync({
          property_name: option.property_name,
          value: option.value,
          label: updates.label || option.label,
          color: updates.color || option.color,
          sort_order: option.sort_order,
          is_active: updates.is_active ?? option.is_active,
        });
      }
    } else {
      await updateOption.mutateAsync({ id, ...updates });
    }
  };

  const handleDeleteOption = async (id: string) => {
    if (!id.startsWith('default-')) {
      await deleteOption.mutateAsync(id);
    }
  };

  if (isLoading) {
    return <div className="p-4 text-center text-muted-foreground">Loading options...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Property Options</h3>
          <p className="text-sm text-muted-foreground">Customize dropdown options for each property</p>
        </div>
      </div>

      {/* Property Type Selector */}
      <div className="space-y-2">
        <Label>Property Type</Label>
        <Select value={selectedProperty} onValueChange={setSelectedProperty}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROPERTY_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Add Option Button */}
      <Button size="sm" variant="outline" onClick={() => setShowAddForm(true)}>
        <Plus className="w-4 h-4 mr-1" />
        Add Option
      </Button>

      {/* Add Option Form */}
      {showAddForm && (
        <div className="border border-border rounded-lg p-4 space-y-4 bg-card">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Option Label</Label>
              <Input
                value={newOption.label}
                onChange={(e) => setNewOption({ ...newOption, label: e.target.value })}
                placeholder="e.g. Type D"
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-1 flex-wrap">
                {COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    className={cn(
                      "w-6 h-6 rounded-full transition-all",
                      newOption.color === color && "ring-2 ring-offset-2 ring-offset-background ring-primary"
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewOption({ ...newOption, color })}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button>
            <Button onClick={handleAddOption} disabled={!newOption.label}>Save Option</Button>
          </div>
        </div>
      )}

      {/* Options List */}
      <div className="space-y-2">
        {options.map((option) => (
          <div
            key={option.id}
            className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50 transition-colors"
          >
            <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
            
            <div
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{ backgroundColor: option.color }}
            />
            
            <div className="flex-1 min-w-0">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border"
                style={{
                  backgroundColor: `${option.color}20`,
                  color: option.color,
                  borderColor: `${option.color}40`,
                }}
              >
                {option.label}
              </span>
            </div>

            <div className="flex items-center gap-1">
              {COLOR_OPTIONS.slice(0, 6).map((color) => (
                <button
                  key={color}
                  className={cn(
                    "w-4 h-4 rounded-full transition-all opacity-50 hover:opacity-100",
                    option.color === color && "opacity-100 ring-1 ring-offset-1 ring-offset-background ring-white"
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => handleUpdateOption(option.id, { color })}
                />
              ))}
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => handleDeleteOption(option.id)}
              disabled={option.id.startsWith('default-')}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>

      {options.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No options for this property. Add your first option above.
        </div>
      )}
    </div>
  );
}
