import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EditableRuleItem } from './EditableRuleItem';

interface CollapsibleRuleSectionProps {
  title: string;
  description?: string;
  rules: string[];
  onRulesChange: (rules: string[]) => void;
  variant?: 'default' | 'profit' | 'loss' | 'destructive';
  icon?: React.ReactNode;
  placeholder?: string;
  defaultOpen?: boolean;
}

export function CollapsibleRuleSection({
  title,
  description,
  rules,
  onRulesChange,
  variant = 'default',
  icon,
  placeholder = 'Add a rule...',
  defaultOpen = true,
}: CollapsibleRuleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [newRule, setNewRule] = useState('');

  const handleAdd = () => {
    if (!newRule.trim()) return;
    onRulesChange([...rules, newRule.trim()]);
    setNewRule('');
  };

  const handleUpdate = (index: number, newValue: string) => {
    const updated = [...rules];
    updated[index] = newValue;
    onRulesChange(updated);
  };

  const handleRemove = (index: number) => {
    onRulesChange(rules.filter((_, i) => i !== index));
  };

  const variantStyles = {
    default: 'text-foreground',
    profit: 'text-profit',
    loss: 'text-loss',
    destructive: 'text-destructive',
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between cursor-pointer group py-1">
          <div className="flex items-center gap-2">
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            <Label className={cn('cursor-pointer', variantStyles[variant])}>
              {title}
            </Label>
            {rules.length > 0 && (
              <span className="text-xs text-muted-foreground">({rules.length})</span>
            )}
          </div>
        </div>
      </CollapsibleTrigger>
      
      <CollapsibleContent className="space-y-2 pt-2">
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        
        <div className="space-y-1">
          {rules.map((rule, i) => (
            <EditableRuleItem
              key={i}
              value={rule}
              onUpdate={(newValue) => handleUpdate(i, newValue)}
              onRemove={() => handleRemove(i)}
              variant={variant}
              icon={icon}
            />
          ))}
        </div>
        
        <div className="flex gap-2">
          <Input
            value={newRule}
            onChange={(e) => setNewRule(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            className="text-sm"
          />
          <Button variant="outline" size="icon" onClick={handleAdd} disabled={!newRule.trim()}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
