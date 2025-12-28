import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAccounts } from '@/hooks/useAccounts';
import { AccountCard } from '@/components/accounts/AccountCard';
import { CreateAccountDialog } from '@/components/accounts/CreateAccountDialog';
import { MT5SetupDialog } from '@/components/accounts/MT5SetupDialog';
import { Account } from '@/types/trading';

export default function Accounts() {
  const { data: accounts, isLoading } = useAccounts();
  const [createOpen, setCreateOpen] = useState(false);
  const [setupAccount, setSetupAccount] = useState<Account | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Accounts</h1>
          <p className="text-muted-foreground">Manage your trading accounts and MT5 connections</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Account
        </Button>
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
          <p className="text-muted-foreground mt-1">Create your first trading account to get started</p>
          <Button className="mt-4" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Account
          </Button>
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
    </div>
  );
}
