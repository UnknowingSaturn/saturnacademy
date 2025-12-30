import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { RefreshCw, History, CalendarIcon } from 'lucide-react';
import { format, subDays, subMonths } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useUpdateAccount } from '@/hooks/useAccounts';
import { Account, AccountType, PropFirm } from '@/types/trading';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  broker: z.string().optional(),
  account_number: z.string().optional(),
  account_type: z.enum(['demo', 'live', 'prop']),
  prop_firm: z.enum(['ftmo', 'fundednext', 'other']).optional(),
  balance_start: z.coerce.number().min(0),
  equity_current: z.coerce.number().min(0),
  broker_utc_offset: z.coerce.number().min(-12).max(14),
  sync_history_enabled: z.boolean().default(true),
  sync_history_from: z.date().optional().nullable(),
});

type FormData = z.infer<typeof formSchema>;

const SYNC_PRESETS = [
  { label: '1 Week', days: 7 },
  { label: '1 Month', days: 30 },
  { label: '3 Months', days: 90 },
] as const;

const BROKER_TIMEZONES = [
  { value: -5, label: 'UTC-5 (New York)' },
  { value: -4, label: 'UTC-4 (New York DST)' },
  { value: 0, label: 'UTC+0 (London)' },
  { value: 1, label: 'UTC+1 (London DST)' },
  { value: 2, label: 'UTC+2 (Helsinki, Cyprus)' },
  { value: 3, label: 'UTC+3 (Moscow, EET DST)' },
];

interface EditAccountDialogProps {
  account: Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditAccountDialog({ account, open, onOpenChange }: EditAccountDialogProps) {
  const updateAccount = useUpdateAccount();
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);

  const [selectedPreset, setSelectedPreset] = useState<number | 'custom' | null>(
    account.sync_history_from ? 'custom' : 30
  );

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: account.name,
      broker: account.broker || '',
      account_number: account.account_number || '',
      account_type: account.account_type || 'demo',
      prop_firm: account.prop_firm || undefined,
      balance_start: account.balance_start || 0,
      equity_current: account.equity_current || 0,
      broker_utc_offset: account.broker_utc_offset ?? 2,
      sync_history_enabled: account.sync_history_enabled ?? true,
      sync_history_from: account.sync_history_from ? new Date(account.sync_history_from) : subDays(new Date(), 30),
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: account.name,
        broker: account.broker || '',
        account_number: account.account_number || '',
        account_type: account.account_type || 'demo',
        prop_firm: account.prop_firm || undefined,
        balance_start: account.balance_start || 0,
        equity_current: account.equity_current || 0,
        broker_utc_offset: account.broker_utc_offset ?? 2,
        sync_history_enabled: account.sync_history_enabled ?? true,
        sync_history_from: account.sync_history_from ? new Date(account.sync_history_from) : subDays(new Date(), 30),
      });
      setSelectedPreset(account.sync_history_from ? 'custom' : 30);
    }
  }, [open, account, form]);

  const accountType = form.watch('account_type');

  const onSubmit = async (data: FormData) => {
    // Calculate sync_history_from based on preset or custom date
    let syncFrom: Date | null = null;
    if (data.sync_history_enabled) {
      if (selectedPreset === 'custom') {
        syncFrom = data.sync_history_from || null;
      } else if (typeof selectedPreset === 'number') {
        syncFrom = subDays(new Date(), selectedPreset);
      }
    }

    await updateAccount.mutateAsync({
      id: account.id,
      name: data.name,
      broker: data.broker || null,
      account_number: data.account_number || null,
      account_type: data.account_type as AccountType,
      prop_firm: data.account_type === 'prop' ? (data.prop_firm as PropFirm) || null : null,
      balance_start: data.balance_start,
      equity_current: data.equity_current,
      broker_utc_offset: data.broker_utc_offset,
      sync_history_enabled: data.sync_history_enabled,
      sync_history_from: syncFrom?.toISOString() || null,
    });
    onOpenChange(false);
  };

  const handlePresetClick = (days: number | 'custom') => {
    setSelectedPreset(days);
    if (typeof days === 'number') {
      form.setValue('sync_history_from', subDays(new Date(), days));
    }
  };

  const handleSyncTradeData = async () => {
    setIsSyncing(true);
    const brokerOffset = form.getValues('broker_utc_offset');
    
    try {
      // First update the account with the broker offset
      await updateAccount.mutateAsync({
        id: account.id,
        broker_utc_offset: brokerOffset,
      });

      // Restore original times from events with timezone conversion
      const { data: restoreData, error: restoreError } = await supabase.functions.invoke('restore-trade-times', {
        body: { 
          account_id: account.id,
          broker_utc_offset: brokerOffset,
        },
      });

      if (restoreError) throw restoreError;

      // Then recalculate sessions and R%
      const { error: reprocessError } = await supabase.functions.invoke('reprocess-trades', {
        body: { account_id: account.id },
      });

      if (reprocessError) throw reprocessError;

      toast({
        title: 'Trade data synced',
        description: `Synced ${restoreData.trades_updated || 0} trades with UTC conversion and recalculated sessions.`,
      });
    } catch (error) {
      console.error('Sync error:', error);
      toast({
        title: 'Failed to sync trade data',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Account</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="broker"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Broker</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="account_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Number</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="account_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="demo">Demo</SelectItem>
                        <SelectItem value="live">Live</SelectItem>
                        <SelectItem value="prop">Funded</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {accountType === 'prop' && (
                <FormField
                  control={form.control}
                  name="prop_firm"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prop Firm</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="ftmo">FTMO</SelectItem>
                          <SelectItem value="fundednext">FundedNext</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="balance_start"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Starting Balance ($)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="equity_current"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Equity ($)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Trade Data Sync</span>
              </div>

              <FormField
                control={form.control}
                name="broker_utc_offset"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Broker Server Timezone</FormLabel>
                    <Select 
                      onValueChange={(v) => field.onChange(parseInt(v))} 
                      value={field.value?.toString()}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select timezone" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BROKER_TIMEZONES.map((tz) => (
                          <SelectItem key={tz.value} value={tz.value.toString()}>
                            {tz.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      The timezone of your broker's MT5 server
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleSyncTradeData}
                disabled={isSyncing}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing...' : 'Sync Trade Data'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Restores original MT5 times, converts to UTC using broker timezone, and recalculates sessions & R%.
              </p>
            </div>

            <Separator />

            {/* Historical Trade Import */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Historical Trade Import</span>
              </div>

              <FormField
                control={form.control}
                name="sync_history_enabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm">Sync Historical Trades</FormLabel>
                      <FormDescription className="text-xs">
                        Import past trades when EA connects
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {form.watch('sync_history_enabled') && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    {SYNC_PRESETS.map((preset) => (
                      <Button
                        key={preset.days}
                        type="button"
                        variant={selectedPreset === preset.days ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handlePresetClick(preset.days)}
                      >
                        {preset.label}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      variant={selectedPreset === 'custom' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handlePresetClick('custom')}
                    >
                      Custom
                    </Button>
                  </div>

                  {selectedPreset === 'custom' && (
                    <FormField
                      control={form.control}
                      name="sync_history_from"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel className="text-xs">Start Date</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  className={cn(
                                    "w-full pl-3 text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  {field.value ? (
                                    format(field.value, "PPP")
                                  ) : (
                                    <span>Pick a date</span>
                                  )}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value || undefined}
                                onSelect={field.onChange}
                                disabled={(date) =>
                                  date > new Date() || date < subMonths(new Date(), 3)
                                }
                                initialFocus
                                className="pointer-events-auto"
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <p className="text-xs text-muted-foreground">
                    Maximum history: 3 months. Trades older than this will not be imported.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateAccount.isPending}>
                {updateAccount.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}