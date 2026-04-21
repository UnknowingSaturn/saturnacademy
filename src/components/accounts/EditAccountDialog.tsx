import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { RefreshCw, Copy, Eye, EyeOff, Key, Info } from 'lucide-react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useUpdateAccount } from '@/hooks/useAccounts';
import { Account, AccountType, PropFirm } from '@/types/trading';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { BROKER_DST_PROFILE_OPTIONS, BrokerDstProfile, brokerLocalToUtc, resolveBrokerOffsetHours } from '@/lib/brokerDst';
import { formatFullDateTimeET } from '@/lib/time';
import { useQuery } from '@tanstack/react-query';

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  broker: z.string().optional(),
  account_number: z.string().optional(),
  account_type: z.enum(['demo', 'live', 'prop']),
  prop_firm: z.enum(['ftmo', 'fundednext', 'other']).optional(),
  balance_start: z.coerce.number().min(0),
  equity_current: z.coerce.number().min(0),
  broker_utc_offset: z.coerce.number().min(-12).max(14),
  broker_dst_profile: z.enum(['EET_DST', 'GMT_DST', 'FIXED_PLUS_3', 'FIXED_PLUS_2', 'FIXED_PLUS_0', 'MANUAL']),
});

type FormData = z.infer<typeof formSchema>;

interface EditAccountDialogProps {
  account: Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditAccountDialog({ account, open, onOpenChange }: EditAccountDialogProps) {
  const updateAccount = useUpdateAccount();
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const maskedKey = account.api_key
    ? `${account.api_key.slice(0, 8)}${'•'.repeat(16)}${account.api_key.slice(-4)}`
    : 'No API key';

  const copyApiKey = async () => {
    if (account.api_key) {
      await navigator.clipboard.writeText(account.api_key);
      toast({ title: 'API key copied to clipboard' });
    }
  };

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
      broker_dst_profile: (account.broker_dst_profile as BrokerDstProfile) || 'MANUAL',
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
        broker_dst_profile: (account.broker_dst_profile as BrokerDstProfile) || 'MANUAL',
      });
    }
  }, [open, account, form]);

  const accountType = form.watch('account_type');
  const profile = form.watch('broker_dst_profile') as BrokerDstProfile;
  const manualOffset = form.watch('broker_utc_offset');

  // Detect whether this account has live EA event data — if so, no manual correction needed.
  const { data: eventStats } = useQuery({
    queryKey: ['account-event-stats', account.id],
    queryFn: async () => {
      const { count } = await supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', account.id);
      return { eventCount: count ?? 0 };
    },
    enabled: open,
  });

  // Pull a few sample trades so we can preview what the correction would do.
  const { data: sampleTrades } = useQuery({
    queryKey: ['account-sample-trades', account.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('trades')
        .select('id, ticket, symbol, entry_time')
        .eq('account_id', account.id)
        .order('entry_time', { ascending: false })
        .limit(5);
      return data ?? [];
    },
    enabled: open,
  });

  const previewRows = useMemo(() => {
    if (!sampleTrades || sampleTrades.length === 0) return [];
    return sampleTrades.map((t) => {
      const stored = t.entry_time;
      const offsetH = resolveBrokerOffsetHours(profile, stored, manualOffset);
      // Treat stored time as if it were broker-local and re-derive UTC.
      const correctedUtc = brokerLocalToUtc(profile, stored, manualOffset);
      return {
        ticket: t.ticket,
        symbol: t.symbol,
        stored,
        offsetH,
        correctedUtc: correctedUtc.toISOString(),
      };
    });
  }, [sampleTrades, profile, manualOffset]);

  const hasEaEvents = (eventStats?.eventCount ?? 0) > 0;

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
      broker_dst_profile: data.broker_dst_profile,
    });
    onOpenChange(false);
  };

  const handleSyncTradeData = async () => {
    setIsSyncing(true);
    const brokerOffset = form.getValues('broker_utc_offset');
    const dstProfile = form.getValues('broker_dst_profile');

    try {
      // Persist the chosen profile before correcting
      await updateAccount.mutateAsync({
        id: account.id,
        broker_utc_offset: brokerOffset,
        broker_dst_profile: dstProfile,
      });

      const { data: restoreData, error: restoreError } = await supabase.functions.invoke('restore-trade-times', {
        body: {
          account_id: account.id,
          broker_utc_offset: brokerOffset,
          broker_dst_profile: dstProfile,
        },
      });

      if (restoreError) throw restoreError;

      const tradesUpdated = restoreData?.trades_updated ?? 0;
      const restoreMessage = restoreData?.message as string | undefined;
      const failures = (restoreData?.failures ?? []) as Array<{ ticket: number; reason: string }>;

      if (tradesUpdated === 0) {
        toast({
          title: 'No trades updated',
          description: restoreMessage || 'No matching trades found to update.',
        });
        return;
      }

      const { error: reprocessError } = await supabase.functions.invoke('reprocess-trades', {
        body: { account_id: account.id },
      });

      if (reprocessError) {
        console.error('Reprocess error after successful restore:', reprocessError);
        toast({
          title: 'Times restored, recompute failed',
          description: `${tradesUpdated} trades got UTC times, but session/R recompute failed: ${reprocessError.message}. Try the reprocess action again.`,
          variant: 'destructive',
        });
        return;
      }

      const failureNote = failures.length > 0 ? ` (${failures.length} skipped)` : '';
      toast({
        title: 'Trade data synced',
        description: `Synced ${tradesUpdated} trades with DST-aware UTC conversion and recalculated sessions${failureNote}.`,
      });
    } catch (error) {
      console.error('Sync error:', error);
      const message = error instanceof Error
        ? error.message
        : (typeof error === 'object' && error && 'message' in error ? String((error as any).message) : 'Unknown error');
      toast({
        title: 'Failed to sync trade data',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
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

            {/* API Key Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">API Key</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono truncate">
                  {showApiKey ? account.api_key || 'No API key' : maskedKey}
                </code>
                <Button type="button" variant="ghost" size="icon" onClick={() => setShowApiKey(!showApiKey)}>
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={copyApiKey} disabled={!account.api_key}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use this API key in your EA to journal trades. Keep the same key when switching between EAs.
              </p>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Broker Timezone</span>
              </div>

              {hasEaEvents && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    This account has <strong>{eventStats?.eventCount}</strong> live EA events. Trade times are
                    auto-corrected per-event (DST-aware) by the live bridge — no manual correction needed.
                    The settings below only apply to CSV-imported trades.
                  </AlertDescription>
                </Alert>
              )}

              <FormField
                control={form.control}
                name="broker_dst_profile"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Broker DST Profile</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BROKER_DST_PROFILE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            <div className="flex flex-col items-start">
                              <span>{opt.label}</span>
                              <span className="text-xs text-muted-foreground">{opt.description}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Picks the right offset for each trade's date (handles DST automatically).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {profile === 'MANUAL' && (
                <FormField
                  control={form.control}
                  name="broker_utc_offset"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Manual UTC offset (hours)</FormLabel>
                      <FormControl>
                        <Input type="number" step="1" min={-12} max={14} {...field} />
                      </FormControl>
                      <FormDescription>Used when DST profile is set to Manual.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {previewRows.length > 0 && (
                <div className="rounded-md border">
                  <div className="px-3 py-2 text-xs font-medium border-b bg-muted/50">
                    Preview — last {previewRows.length} trades
                  </div>
                  <div className="divide-y text-xs">
                    <div className="grid grid-cols-12 gap-2 px-3 py-2 font-medium text-muted-foreground">
                      <div className="col-span-2">Ticket</div>
                      <div className="col-span-3">Stored</div>
                      <div className="col-span-1 text-right">Offset</div>
                      <div className="col-span-3">UTC after fix</div>
                      <div className="col-span-3">Display</div>
                    </div>
                    {previewRows.map((row, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 px-3 py-2">
                        <div className="col-span-2 font-mono">{row.ticket ?? '—'}</div>
                        <div className="col-span-3 font-mono truncate">{row.stored.replace('T', ' ').replace('.000Z', '').replace('Z', '')}</div>
                        <div className="col-span-1 text-right">{row.offsetH >= 0 ? `+${row.offsetH}` : row.offsetH}h</div>
                        <div className="col-span-3 font-mono truncate">{row.correctedUtc.replace('T', ' ').replace('.000Z', '').replace('Z', '')}</div>
                        <div className="col-span-3 truncate">{formatFullDateTimeET(row.correctedUtc)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                Re-derives UTC times for stored trades using the DST profile (per-trade-date offset),
                then recalculates sessions & R-multiples.
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
