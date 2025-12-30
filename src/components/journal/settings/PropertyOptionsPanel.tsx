import { useState, useRef, useEffect } from "react";
import { usePropertyOptions, useCreatePropertyOption, useUpdatePropertyOption, useDeletePropertyOption, useReorderPropertyOptions } from "@/hooks/useUserSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { PropertyOption } from "@/types/settings";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const PROPERTY_TYPES = [
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

interface SortableOptionItemProps {
  option: PropertyOption;
  onUpdate: (id: string, updates: Partial<PropertyOption>) => void;
  onDelete: (id: string) => void;
}

function SortableOptionItem({ option, onUpdate, onDelete }: SortableOptionItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(option.label);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: option.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSaveLabel = () => {
    if (editValue.trim() && editValue !== option.label) {
      onUpdate(option.id, { label: editValue.trim() });
    } else {
      setEditValue(option.label);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveLabel();
    } else if (e.key === 'Escape') {
      setEditValue(option.label);
      setIsEditing(false);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50 transition-colors",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="touch-none cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="w-4 h-4 text-muted-foreground" />
      </button>
      
      <div
        className="w-4 h-4 rounded-full flex-shrink-0"
        style={{ backgroundColor: option.color }}
      />
      
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <Input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSaveLabel}
            onKeyDown={handleKeyDown}
            className="h-7 text-xs"
          />
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border cursor-text hover:ring-1 hover:ring-primary/50 transition-all"
            style={{
              backgroundColor: `${option.color}20`,
              color: option.color,
              borderColor: `${option.color}40`,
            }}
          >
            {option.label}
          </button>
        )}
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
            onClick={() => onUpdate(option.id, { color })}
          />
        ))}
      </div>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Option</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{option.label}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onDelete(option.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function PropertyOptionsPanel() {
  const [selectedProperty, setSelectedProperty] = useState('profile');
  const { data: options = [], isLoading } = usePropertyOptions(selectedProperty);
  const createOption = useCreatePropertyOption();
  const updateOption = useUpdatePropertyOption();
  const deleteOption = useDeletePropertyOption();
  const reorderOptions = useReorderPropertyOptions();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newOption, setNewOption] = useState({
    value: '',
    label: '',
    color: '#3B82F6',
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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
    await updateOption.mutateAsync({ id, ...updates });
  };

  const handleDeleteOption = async (id: string) => {
    await deleteOption.mutateAsync(id);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = options.findIndex((o) => o.id === active.id);
      const newIndex = options.findIndex((o) => o.id === over.id);
      const newOrder = arrayMove(options, oldIndex, newIndex);
      
      // Update sort orders in database
      const updates = newOrder.map((option, index) => ({
        id: option.id,
        sort_order: index,
      }));
      await reorderOptions.mutateAsync(updates);
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
          <p className="text-sm text-muted-foreground">Customize dropdown options for each property. Click label to edit, drag to reorder.</p>
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

      {/* Options List with Drag and Drop */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={options.map(o => o.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {options.map((option) => (
              <SortableOptionItem
                key={option.id}
                option={option}
                onUpdate={handleUpdateOption}
                onDelete={handleDeleteOption}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {options.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No options for this property. Add your first option above.
        </div>
      )}
    </div>
  );
}
