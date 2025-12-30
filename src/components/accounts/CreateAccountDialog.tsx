import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, subDays, subMonths } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
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
import { Switch } from '@/components/ui/switch';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useCreateAccount } from '@/hooks/useAccounts';
import { AccountType, PropFirm } from '@/types/trading';

type SyncPreset = 'week' | 'month' | '3months' | 'custom';

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  broker: z.string().optional(),
  account_number: z.string().optional(),
  account_type: z.enum(['demo', 'live', 'prop']),
  prop_firm: z.enum(['ftmo', 'fundednext', 'other']).optional(),
  balance_start: z.coerce.number().min(0),
  sync_history_enabled: z.boolean().default(true),
  sync_history_from: z.date().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface CreateAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SYNC_PRESETS: { value: SyncPreset; label: string; getDays: () => number }[] = [
  { value: 'week', label: '1 Week', getDays: () => 7 },
  { value: 'month', label: '1 Month', getDays: () => 30 },
  { value: '3months', label: '3 Months', getDays: () => 90 },
  { value: 'custom', label: 'Custom', getDays: () => 0 },
];

export function CreateAccountDialog({ open, onOpenChange }: CreateAccountDialogProps) {
  const createAccount = useCreateAccount();
  const [syncPreset, setSyncPreset] = useState<SyncPreset>('month');

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      broker: '',
      account_number: '',
      account_type: 'demo',
      balance_start: 10000,
      sync_history_enabled: true,
      sync_history_from: subDays(new Date(), 30),
    },
  });

  const accountType = form.watch('account_type');
  const syncHistoryEnabled = form.watch('sync_history_enabled');

  // Update sync_history_from when preset changes
  const handlePresetChange = (preset: SyncPreset) => {
    setSyncPreset(preset);
    if (preset !== 'custom') {
      const presetConfig = SYNC_PRESETS.find(p => p.value === preset);
      if (presetConfig) {
        form.setValue('sync_history_from', subDays(new Date(), presetConfig.getDays()));
      }
    }
  };

  const onSubmit = async (data: FormData) => {
    await createAccount.mutateAsync({
      name: data.name,
      broker: data.broker || null,
      account_number: data.account_number || null,
      account_type: data.account_type as AccountType,
      prop_firm: data.account_type === 'prop' ? (data.prop_firm as PropFirm) || null : null,
      balance_start: data.balance_start,
      equity_current: data.balance_start,
      is_active: true,
      terminal_id: null,
      broker_utc_offset: 2,
      copier_role: 'independent',
      master_account_id: null,
      copier_enabled: false,
      sync_history_enabled: data.sync_history_enabled,
      sync_history_from: data.sync_history_enabled ? data.sync_history_from?.toISOString() || null : null,
    });
    form.reset();
    setSyncPreset('month');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Account</DialogTitle>
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
                    <Input placeholder="My Trading Account" {...field} />
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
                      <Input placeholder="IC Markets" {...field} />
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
                      <Input placeholder="12345678" {...field} />
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
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
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
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select firm" />
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

            <FormField
              control={form.control}
              name="balance_start"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Starting Balance ($)</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="10000" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Historical Sync Settings */}
            <div className="space-y-4 rounded-lg border border-border/50 p-4">
              <FormField
                control={form.control}
                name="sync_history_enabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between">
                    <div className="space-y-0.5">
                      <FormLabel>Sync Historical Trades</FormLabel>
                      <FormDescription className="text-xs">
                        Import past trades when the EA connects
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

              {syncHistoryEnabled && (
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">How far back?</div>
                  <div className="flex flex-wrap gap-2">
                    {SYNC_PRESETS.map((preset) => (
                      <Button
                        key={preset.value}
                        type="button"
                        variant={syncPreset === preset.value ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handlePresetChange(preset.value)}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>

                  {syncPreset === 'custom' && (
                    <FormField
                      control={form.control}
                      name="sync_history_from"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Start Date</FormLabel>
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
                                selected={field.value}
                                onSelect={field.onChange}
                                disabled={(date) =>
                                  date > new Date() || date < subDays(new Date(), 90)
                                }
                                initialFocus
                                className={cn("p-3 pointer-events-auto")}
                              />
                            </PopoverContent>
                          </Popover>
                          <FormDescription className="text-xs">
                            Maximum 90 days of history
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createAccount.isPending}>
                {createAccount.isPending ? 'Creating...' : 'Create Account'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
