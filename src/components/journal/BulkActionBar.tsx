import { Archive, ArchiveRestore, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface BulkActionBarProps {
  selectedCount: number;
  onAction: () => void;
  onClear: () => void;
  isLoading?: boolean;
  mode?: 'archive' | 'restore';
}

export function BulkActionBar({ selectedCount, onAction, onClear, isLoading, mode = 'archive' }: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  const isArchive = mode === 'archive';

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
      <div className="flex items-center gap-3 px-4 py-3 bg-background border border-border rounded-lg shadow-lg">
        <span className="text-sm font-medium">
          {selectedCount} trade{selectedCount !== 1 ? 's' : ''} selected
        </span>
        
        <div className="h-4 w-px bg-border" />
        
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button 
              variant={isArchive ? "destructive" : "default"} 
              size="sm" 
              disabled={isLoading}
            >
              {isArchive ? (
                <Archive className="h-4 w-4 mr-2" />
              ) : (
                <ArchiveRestore className="h-4 w-4 mr-2" />
              )}
              {isLoading 
                ? (isArchive ? 'Archiving...' : 'Restoring...') 
                : (isArchive ? 'Archive Selected' : 'Restore Selected')
              }
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {isArchive 
                  ? `Archive ${selectedCount} trade${selectedCount !== 1 ? 's' : ''}?` 
                  : `Restore ${selectedCount} trade${selectedCount !== 1 ? 's' : ''}?`
                }
              </AlertDialogTitle>
              <AlertDialogDescription>
                {isArchive ? (
                  <>
                    Archived trades will be hidden from your journal, dashboard, and reports. 
                    You can restore them anytime from the "Archived" tab.
                  </>
                ) : (
                  <>
                    Restored trades will reappear in your journal, dashboard, and reports.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={onAction} 
                className={isArchive 
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" 
                  : ""
                }
              >
                {isArchive ? 'Archive Trades' : 'Restore Trades'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="h-4 w-4 mr-2" />
          Clear
        </Button>
      </div>
    </div>
  );
}
