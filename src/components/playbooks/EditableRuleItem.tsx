import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GripVertical, X, Pencil, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EditableRuleItemProps {
  value: string;
  onUpdate: (newValue: string) => void;
  onRemove: () => void;
  variant?: 'default' | 'profit' | 'loss' | 'destructive';
  icon?: React.ReactNode;
  placeholder?: string;
}

export function EditableRuleItem({
  value,
  onUpdate,
  onRemove,
  variant = 'default',
  icon,
  placeholder = 'Edit rule...',
}: EditableRuleItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== value) {
      onUpdate(trimmed);
    } else {
      setEditValue(value);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditValue(value);
      setIsEditing(false);
    }
  };

  const variantStyles = {
    default: 'bg-muted hover:bg-muted/80',
    profit: 'bg-profit/5 border border-profit/20 hover:bg-profit/10',
    loss: 'bg-loss/5 border border-loss/20 hover:bg-loss/10',
    destructive: 'bg-destructive/5 border border-destructive/20 hover:bg-destructive/10',
  };

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-sm px-3 py-1.5 rounded group transition-colors',
        variantStyles[variant]
      )}
    >
      <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
      
      {icon && <span className="flex-shrink-0">{icon}</span>}
      
      {isEditing ? (
        <div className="flex-1 flex items-center gap-2">
          <Input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            placeholder={placeholder}
            className="h-7 text-sm"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={handleSave}
          >
            <Check className="w-3 h-3" />
          </Button>
        </div>
      ) : (
        <>
          <span
            className="flex-1 cursor-pointer"
            onClick={() => setIsEditing(true)}
          >
            {value}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => setIsEditing(true)}
          >
            <Pencil className="w-3 h-3" />
          </Button>
        </>
      )}
      
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        onClick={onRemove}
      >
        <X className="w-3 h-3" />
      </Button>
    </div>
  );
}
