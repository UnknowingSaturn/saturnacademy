import { Loader2, Check, AlertCircle, CloudOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SaveStatus } from '@/hooks/useAutoSave';

interface SaveStatusIndicatorProps {
  status: SaveStatus;
  onRetry?: () => void;
}

export function SaveStatusIndicator({ status, onRetry }: SaveStatusIndicatorProps) {
  if (status === 'idle') {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-all duration-200",
        status === 'unsaved' && "text-breakeven bg-breakeven/10",
        status === 'saving' && "text-muted-foreground bg-muted/50",
        status === 'saved' && "text-profit bg-profit/10",
        status === 'error' && "text-loss bg-loss/10 cursor-pointer hover:bg-loss/20"
      )}
      onClick={status === 'error' ? onRetry : undefined}
      role={status === 'error' ? 'button' : undefined}
    >
      {status === 'unsaved' && (
        <>
          <CloudOff className="h-3 w-3" />
          <span>Unsaved</span>
        </>
      )}
      {status === 'saving' && (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Saving...</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <Check className="h-3 w-3" />
          <span>Saved</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="h-3 w-3" />
          <span>Error - tap to retry</span>
        </>
      )}
    </div>
  );
}
