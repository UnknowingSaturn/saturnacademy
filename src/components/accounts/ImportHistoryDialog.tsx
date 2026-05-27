import { useState } from 'react';
import { format, subDays, subMonths, subYears } from 'date-fns';
import { CalendarIcon, History, AlertCircle, CheckCircle2 } from 'lucide-react';
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
import { useForceResync } from '@/hooks/useAccounts';
import { Account } from '@/types/trading';
import { cn } from '@/lib/utils';

interface ImportHistoryDialogProps {
  account: Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SyncPreset = '1week' | '1month' | '3months' | '6months' | '1year' | 'all' | 'custom';

// "All History" — far enough back to cover any realistic account age.
const ALL_HISTORY_FROM = new Date('2020-01-01T00:00:00Z');

export function ImportHistoryDialog({ account, open, onOpenChange }: ImportHistoryDialogProps) {
  const [syncPreset, setSyncPreset] = useState<SyncPreset>('all');
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [showInstructions, setShowInstructions] = useState(false);
  const forceResync = useForceResync();

  const getSyncFromDate = (): Date => {
    const now = new Date();
    switch (syncPreset) {
      case '1week':    return subDays(now, 7);
      case '1month':   return subMonths(now, 1);
      case '3months':  return subMonths(now, 3);
      case '6months':  return subMonths(now, 6);
      case '1year':    return subYears(now, 1);
      case 'all':      return ALL_HISTORY_FROM;
      case 'custom':   return customDate || subMonths(now, 1);
      default:         return ALL_HISTORY_FROM;
    }
  };

  const handleResync = async () => {
    await forceResync.mutateAsync({
      accountIds: [account.id],
      syncFrom: getSyncFromDate(),
    });
    setShowInstructions(true);
  };

  const handleClose = () => {
    onOpenChange(false);
    setShowInstructions(false);
    setSyncPreset('all');
    setCustomDate(undefined);
  };

  // Allow custom range up to 5 years back.
  const minDate = subYears(new Date(), 5);

  const hasSyncSettings = account.sync_history_enabled && account.sync_history_from;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Resync Historical Trades
          </DialogTitle>
          <DialogDescription>
            Pull closed trades from MT5 history into your journal. Pick how far back to look, then the EA replays on its next poll.
          </DialogDescription>
        </DialogHeader>

        {!showInstructions ? (
          <div className="space-y-6 py-4">
            {hasSyncSettings && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Currently set from{' '}
                  <strong>{format(new Date(account.sync_history_from!), 'MMM d, yyyy')}</strong>.
                  Choose a new range below to widen or shorten the import window.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <label className="text-sm font-medium">Import trades from:</label>
              <div className="flex flex-wrap gap-2">
                {(['1week', '1month', '3months', '6months', '1year', 'all'] as const).map((preset) => (
                  <Button
                    key={preset}
                    variant={syncPreset === preset ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSyncPreset(preset)}
                  >
                    {preset === '1week' && '1 Week'}
                    {preset === '1month' && '1 Month'}
                    {preset === '3months' && '3 Months'}
                    {preset === '6months' && '6 Months'}
                    {preset === '1year' && '1 Year'}
                    {preset === 'all' && 'All History'}
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
                        ? format(customDate, 'MMM d, yyyy')
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
                "All History" goes back to Jan 1, 2020. The EA can only replay deals that MT5 has cached locally — see note below.
              </p>
            </div>

            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="text-sm">
                <strong>Will request trades from:</strong>{' '}
                {syncPreset === 'all'
                  ? 'all available MT5 history'
                  : `${format(getSyncFromDate(), 'MMMM d, yyyy')} → today`}
              </p>
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Important:</strong> In MT5, open the <em>History</em> tab → right-click → <em>All History</em> (or
                custom range covering the period you want). The EA can only see deals that MT5 has loaded into memory.
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <Alert className="border-green-500/50 bg-green-500/10">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertDescription className="text-green-700 dark:text-green-400">
                Resync queued. The EA will replay history on its next poll (within ~30s while the terminal is open).
              </AlertDescription>
            </Alert>

            <div className="rounded-lg border bg-muted/30 p-4 text-sm space-y-2">
              <p className="font-medium">Make sure of:</p>
              <ol className="text-muted-foreground list-decimal list-inside space-y-1">
                <li>The MT5 terminal for this account is <strong>open and logged in</strong>.</li>
                <li>
                  History tab is set to <strong>All History</strong> (or a range that covers the chosen window).
                </li>
                <li>EA is attached to a chart and "AutoTrading" is enabled.</li>
              </ol>
              <p className="text-muted-foreground pt-1">
                Existing trades are deduped — only missing ones are inserted. Check the Journal in 1–2 minutes.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {!showInstructions ? (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleResync} disabled={forceResync.isPending}>
                {forceResync.isPending ? 'Queuing…' : 'Resync Now'}
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
