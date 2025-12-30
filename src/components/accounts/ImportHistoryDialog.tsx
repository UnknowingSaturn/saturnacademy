import { useState } from 'react';
import { format, subDays, subMonths } from 'date-fns';
import { CalendarIcon, History, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useUpdateSyncSettings } from '@/hooks/useAccounts';
import { Account } from '@/types/trading';
import { cn } from '@/lib/utils';

interface ImportHistoryDialogProps {
  account: Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SyncPreset = '1week' | '2weeks' | '1month' | '3months' | 'custom';

export function ImportHistoryDialog({ account, open, onOpenChange }: ImportHistoryDialogProps) {
  const [syncPreset, setSyncPreset] = useState<SyncPreset>('1month');
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [showInstructions, setShowInstructions] = useState(false);
  const updateSyncSettings = useUpdateSyncSettings();

  const getSyncFromDate = (): Date => {
    const now = new Date();
    switch (syncPreset) {
      case '1week':
        return subDays(now, 7);
      case '2weeks':
        return subDays(now, 14);
      case '1month':
        return subMonths(now, 1);
      case '3months':
        return subMonths(now, 3);
      case 'custom':
        return customDate || subMonths(now, 1);
      default:
        return subMonths(now, 1);
    }
  };

  const handleSaveAndShowInstructions = async () => {
    const syncFrom = getSyncFromDate();
    
    await updateSyncSettings.mutateAsync({
      accountId: account.id,
      syncEnabled: true,
      syncFrom,
    });
    
    setShowInstructions(true);
  };

  const handleClose = () => {
    onOpenChange(false);
    setShowInstructions(false);
    setSyncPreset('1month');
    setCustomDate(undefined);
  };

  // Max 3 months back
  const minDate = subMonths(new Date(), 3);

  // Check if account already has sync settings
  const hasSyncSettings = account.sync_history_enabled && account.sync_history_from;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Import Historical Trades
          </DialogTitle>
          <DialogDescription>
            Import closed trades from your MT5 history into your journal.
          </DialogDescription>
        </DialogHeader>

        {!showInstructions ? (
          <div className="space-y-6 py-4">
            {/* Current settings info */}
            {hasSyncSettings && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  History import is already configured from{' '}
                  <strong>{format(new Date(account.sync_history_from!), 'MMM d, yyyy')}</strong>.
                  Updating will allow you to re-import with new settings.
                </AlertDescription>
              </Alert>
            )}

            {/* Date range selection */}
            <div className="space-y-3">
              <label className="text-sm font-medium">Import trades from:</label>
              <div className="flex flex-wrap gap-2">
                {(['1week', '2weeks', '1month', '3months'] as const).map((preset) => (
                  <Button
                    key={preset}
                    variant={syncPreset === preset ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSyncPreset(preset)}
                  >
                    {preset === '1week' && '1 Week'}
                    {preset === '2weeks' && '2 Weeks'}
                    {preset === '1month' && '1 Month'}
                    {preset === '3months' && '3 Months'}
                  </Button>
                ))}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={syncPreset === 'custom' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSyncPreset('custom')}
                      className={cn(syncPreset === 'custom' && customDate && 'gap-1')}
                    >
                      <CalendarIcon className="h-3.5 w-3.5" />
                      {syncPreset === 'custom' && customDate
                        ? format(customDate, 'MMM d')
                        : 'Custom'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={customDate}
                      onSelect={(date) => {
                        setCustomDate(date);
                        setSyncPreset('custom');
                      }}
                      disabled={(date) => date < minDate || date > new Date()}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <p className="text-xs text-muted-foreground">
                Maximum: 3 months. For older trades, use CSV import.
              </p>
            </div>

            {/* Preview */}
            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="text-sm">
                <strong>Will import trades from:</strong>{' '}
                {format(getSyncFromDate(), 'MMMM d, yyyy')} to today
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Success message */}
            <Alert className="border-green-500/50 bg-green-500/10">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertDescription className="text-green-700 dark:text-green-400">
                Import settings saved! Follow the steps below to import trades.
              </AlertDescription>
            </Alert>

            {/* Instructions */}
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
                <RefreshCw className="h-5 w-5 text-primary mt-0.5" />
                <div className="space-y-2">
                  <p className="font-medium">Force history re-sync now</p>
                  <p className="text-sm text-muted-foreground">
                    The EA only syncs history once every 24 hours. To force an immediate re-sync:
                  </p>
                  <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                    <li>In MT5, go to <strong>File → Open Data Folder</strong></li>
                    <li>Navigate to <strong>MQL5 → Files</strong></li>
                    <li>
                      Delete the file: <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
                        TradeJournalSynced_{account.account_number || '[LOGIN]'}.flag
                      </code>
                    </li>
                    <li>Restart MT5 or re-attach the EA</li>
                  </ol>
                </div>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Why this happens:</strong> The EA creates a local flag file after syncing history 
                  to prevent duplicate imports. Deleting this file forces an immediate re-sync.
                </AlertDescription>
              </Alert>

              <div className="text-sm text-muted-foreground">
                <p>
                  After restarting, check MT5's <strong>Experts</strong> tab for "Syncing historical trades..." messages.
                  Trades should appear in your Journal within 1-2 minutes.
                </p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {!showInstructions ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button 
                onClick={handleSaveAndShowInstructions}
                disabled={updateSyncSettings.isPending}
              >
                {updateSyncSettings.isPending ? 'Saving...' : 'Enable Import'}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
