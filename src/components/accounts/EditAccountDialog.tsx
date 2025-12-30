import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { RefreshCw } from 'lucide-react';
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
import { useUpdateAccount } from '@/hooks/useAccounts';
import { Account, AccountType, PropFirm } from '@/types/trading';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  broker: z.string().optional(),
  account_number: z.string().optional(),
  account_type: z.enum(['demo', 'live', 'prop']),
  prop_firm: z.enum(['ftmo', 'fundednext', 'other']).optional(),
  balance_start: z.coerce.number().min(0),
  equity_current: z.coerce.number().min(0),
  broker_utc_offset: z.coerce.number().min(-12).max(14),
});

type FormData = z.infer<typeof formSchema>;

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
      });
    }
  }, [open, account, form]);

  const accountType = form.watch('account_type');

  const onSubmit = async (data: FormData) => {
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
    });
    onOpenChange(false);
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
                <span className="text-sm font-medium">Timezone Correction</span>
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
                {isSyncing ? 'Applying...' : 'Apply Timezone Correction'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Converts trade times to UTC using your broker's timezone, then recalculates sessions & R-multiples.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateAccount.isPending}>
                Save Changes
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
