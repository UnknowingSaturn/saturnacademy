import { useState } from 'react';
import { Plus, Link, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAccounts } from '@/hooks/useAccounts';
import { AccountCard } from '@/components/accounts/AccountCard';
import { CreateAccountDialog } from '@/components/accounts/CreateAccountDialog';
import { MT5SetupDialog } from '@/components/accounts/MT5SetupDialog';
import { QuickConnectDialog } from '@/components/accounts/QuickConnectDialog';
import { Account } from '@/types/trading';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function Accounts() {
  const { data: accounts, isLoading } = useAccounts();
  const [createOpen, setCreateOpen] = useState(false);
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);
  const [setupAccount, setSetupAccount] = useState<Account | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);

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
        <div className="grid gap-4 md:grid-cols-2">
          {accounts?.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onSetupMT5={() => setSetupAccount(account)}
            />
          ))}
        </div>
      )}

      <CreateAccountDialog open={createOpen} onOpenChange={setCreateOpen} />
      <MT5SetupDialog account={setupAccount} onOpenChange={(open) => !open && setSetupAccount(null)} />
      <QuickConnectDialog open={quickConnectOpen} onOpenChange={setQuickConnectOpen} />
    </div>
  );
}
