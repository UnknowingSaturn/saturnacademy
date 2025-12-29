import { useState } from 'react';
import { Plus, Link, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAccounts } from '@/hooks/useAccounts';
import { AccountCard } from '@/components/accounts/AccountCard';
import { CreateAccountDialog } from '@/components/accounts/CreateAccountDialog';
import { MT5SetupDialog } from '@/components/accounts/MT5SetupDialog';
import { QuickConnectDialog } from '@/components/accounts/QuickConnectDialog';
import { Account } from '@/types/trading';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function Accounts() {
  const { data: accounts, isLoading, refetch } = useAccounts();
  const [createOpen, setCreateOpen] = useState(false);
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);
  const [setupAccount, setSetupAccount] = useState<Account | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const [isFreshStarting, setIsFreshStarting] = useState(false);
  const [freshStartAccountId, setFreshStartAccountId] = useState<string>('');

  const handleRecoverTrades = async () => {
    setIsRecovering(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please sign in to recover trades");
        return;
      }

      const { data, error } = await supabase.functions.invoke('reprocess-orphan-exits', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) throw error;

      if (data.recovered > 0) {
        toast.success(data.message, {
          description: data.trades?.join(', '),
        });
      } else {
        toast.info(data.message);
      }
    } catch (err) {
      console.error("Recovery error:", err);
      toast.error("Failed to recover trades");
    } finally {
      setIsRecovering(false);
    }
  };

  const handleFreshStart = async () => {
    if (!freshStartAccountId) {
      toast.error("Please select an account");
      return;
    }

    setIsFreshStarting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please sign in");
        return;
      }

      const { data, error } = await supabase.functions.invoke('fresh-start', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: { account_id: freshStartAccountId },
      });

      if (error) throw error;

      toast.success(data.message, {
        description: "Restart your EA to re-import all trades.",
      });

      // Refetch accounts to update trade counts
      refetch();
    } catch (err) {
      console.error("Fresh start error:", err);
      toast.error("Failed to perform fresh start");
    } finally {
      setIsFreshStarting(false);
      setFreshStartAccountId('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Accounts</h1>
          <p className="text-muted-foreground">Manage your trading accounts and MT5 connections</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="ghost" 
            size="sm"
            onClick={handleRecoverTrades}
            disabled={isRecovering}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRecovering ? 'animate-spin' : ''}`} />
            {isRecovering ? 'Recovering...' : 'Recover Missed Trades'}
          </Button>
          <Button variant="outline" onClick={() => setQuickConnectOpen(true)}>
            <Link className="h-4 w-4 mr-2" />
            Connect MT5
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Account
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-48 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : accounts?.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-lg">
          <h3 className="text-lg font-medium">No accounts yet</h3>
          <p className="text-muted-foreground mt-1 mb-4">Connect your MT5 terminal or create a manual account</p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => setQuickConnectOpen(true)}>
              <Link className="h-4 w-4 mr-2" />
              Connect MT5
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Manual Account
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {accounts?.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onSetupMT5={() => setSetupAccount(account)}
              />
            ))}
          </div>

          {/* Danger Zone */}
          <div className="mt-8 border border-destructive/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h3 className="font-semibold text-destructive">Danger Zone</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Fresh Start will delete all trades AND events for an account, allowing your EA to re-import everything from scratch.
            </p>
            
            <div className="flex items-center gap-3">
              <Select value={freshStartAccountId} onValueChange={setFreshStartAccountId}>
                <SelectTrigger className="w-[250px]">
                  <SelectValue placeholder="Select account..." />
                </SelectTrigger>
                <SelectContent>
                  {accounts?.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button 
                    variant="destructive" 
                    disabled={!freshStartAccountId || isFreshStarting}
                  >
                    {isFreshStarting ? 'Processing...' : 'Fresh Start'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete <strong>all trades and events</strong> for the selected account. 
                      This action cannot be undone.
                      <br /><br />
                      After this, restart your EA to re-import all historical trades from scratch.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={handleFreshStart}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Yes, Delete Everything
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </>
      )}

      <CreateAccountDialog open={createOpen} onOpenChange={setCreateOpen} />
      <MT5SetupDialog account={setupAccount} onOpenChange={(open) => !open && setSetupAccount(null)} />
      <QuickConnectDialog open={quickConnectOpen} onOpenChange={setQuickConnectOpen} />
    </div>
  );
}
