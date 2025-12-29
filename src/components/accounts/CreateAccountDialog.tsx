import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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
import { useCreateAccount } from '@/hooks/useAccounts';
import { AccountType, PropFirm } from '@/types/trading';

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  broker: z.string().optional(),
  account_number: z.string().optional(),
  account_type: z.enum(['demo', 'live', 'prop']),
  prop_firm: z.enum(['ftmo', 'fundednext', 'other']).optional(),
  balance_start: z.coerce.number().min(0),
});

type FormData = z.infer<typeof formSchema>;

interface CreateAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateAccountDialog({ open, onOpenChange }: CreateAccountDialogProps) {
  const createAccount = useCreateAccount();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      broker: '',
      account_number: '',
      account_type: 'demo',
      balance_start: 10000,
    },
  });

  const accountType = form.watch('account_type');

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
      broker_utc_offset: 2, // Default to UTC+2 (most forex brokers)
    });
    form.reset();
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
