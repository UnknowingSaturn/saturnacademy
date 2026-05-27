import { useState } from 'react';
import { Link, RefreshCw, AlertTriangle, Archive, Flame, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAccounts } from '@/hooks/useAccounts';
import { useArchiveAllTrades } from '@/hooks/useTrades';
import { AccountCard } from '@/components/accounts/AccountCard';
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
  const archiveAllMutation = useArchiveAllTrades();
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);
  const [setupAccount, setSetupAccount] = useState<Account | null>(null);
  const [isFreshStarting, setIsFreshStarting] = useState(false);
  const [freshStartAccountId, setFreshStartAccountId] = useState<string>('');
  const [archiveAllAccountId, setArchiveAllAccountId] = useState<string>('');
  const [repairAccountId, setRepairAccountId] = useState<string>('');
  const [isRepairing, setIsRepairing] = useState(false);
  const [isArchivingLegacyDuplicates, setIsArchivingLegacyDuplicates] = useState(false);



  const handleRepairStuckTrades = async () => {
    if (!repairAccountId) {
      toast.error("Please select an account");
      return;
    }
    setIsRepairing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please sign in");
        return;
      }
      const { data, error } = await supabase.functions.invoke('repair-snapshot-closed', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { account_id: repairAccountId },
      });
      if (error) throw error;
      toast.success(data.message, {
        description: data.pending_mt5_reconnect > 0
          ? `Pending tickets: ${data.pending_tickets?.slice(0, 5).join(', ')}${data.pending_tickets?.length > 5 ? '…' : ''}`
          : undefined,
      });
      refetch();
    } catch (err) {
      console.error("Repair error:", err);
      toast.error("Failed to repair trades");
    } finally {
      setIsRepairing(false);
    }
  };

  const handleArchiveLegacyDuplicates = async () => {
    setIsArchivingLegacyDuplicates(true);
    try {
      const source = accounts?.find((account) => account.account_number === '70561');
      if (!source?.mt5_install_id) {
        toast.error('70561 account not found');
        return;
      }

      const siblingIds = (accounts || [])
        .filter((account) => account.mt5_install_id === source.mt5_install_id && account.id !== source.id)
        .map((account) => account.id);

      if (siblingIds.length === 0) {
        toast.info('No sibling accounts found for this MT5 install');
        return;
      }

      const { data: siblingTrades, error: siblingError } = await supabase
        .from('trades')
        .select('ticket')
        .in('account_id', siblingIds);
      if (siblingError) throw siblingError;

      const duplicateTickets = Array.from(new Set((siblingTrades || []).map((trade) => trade.ticket).filter(Boolean)));
      if (duplicateTickets.length === 0) {
        toast.info('No duplicate tickets found');
        return;
      }

      const { data: archivedRows, error } = await supabase
        .from('trades')
        .update({ is_archived: true, archived_at: new Date().toISOString() })
        .eq('account_id', source.id)
        .in('ticket', duplicateTickets)
        .select('id');
      if (error) throw error;

      toast.success(`Archived ${archivedRows?.length || 0} duplicate 70561 trades`, {
        description: 'Only 70561 copies with matching sibling tickets were hidden. Restore them from Archived if needed.',
      });
      refetch();
    } catch (err) {
      console.error('Legacy duplicate cleanup error:', err);
      toast.error('Failed to archive legacy duplicates');
    } finally {
      setIsArchivingLegacyDuplicates(false);
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

          <Button onClick={() => setQuickConnectOpen(true)}>
            <Link className="h-4 w-4 mr-2" />
            Connect MT5
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
          <p className="text-muted-foreground mt-1 mb-4">Connect your MT5 terminal to start tracking trades</p>
          <Button onClick={() => setQuickConnectOpen(true)}>
            <Link className="h-4 w-4 mr-2" />
            Connect MT5
          </Button>
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

          {/* Maintenance Zone — Repair stuck trades */}
          <div className="mt-8 border border-amber-500/30 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 p-4 bg-amber-500/5 border-b border-amber-500/20">
              <Wrench className="h-5 w-5 text-amber-600" />
              <h3 className="font-semibold text-amber-600">Repair</h3>
            </div>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <RefreshCw className="h-4 w-4 text-amber-500" />
                <h4 className="font-medium">Repair stuck "break-even" trades</h4>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                If you switch broker logins inside the same MT5 terminal, some trades may have been incorrectly closed at PnL 0.
                This rebuilds them from the real MT5 deal history. Trades that still need MT5 reconnect to heal will be flagged.
              </p>

              <div className="flex items-center gap-3">
                <Select value={repairAccountId} onValueChange={setRepairAccountId}>
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

                <Button
                  variant="outline"
                  className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                  onClick={handleRepairStuckTrades}
                  disabled={!repairAccountId || isRepairing}
                >
                  {isRepairing ? 'Repairing...' : 'Repair stuck trades'}
                </Button>
              </div>

              <div className="mt-5 border-t border-amber-500/20 pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Archive className="h-4 w-4 text-amber-500" />
                  <h4 className="font-medium">Archive duplicate legacy 70561 trades</h4>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Hides only 70561 trade copies whose ticket already exists on another account from the same MT5 install.
                </p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                      disabled={isArchivingLegacyDuplicates}
                    >
                      {isArchivingLegacyDuplicates ? 'Archiving...' : 'Archive duplicates'}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Archive confirmed duplicate 70561 trades?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will hide only 70561 trades that have the same ticket on another sibling account. Nothing is deleted, and archived trades can be restored later.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleArchiveLegacyDuplicates}
                        className="bg-amber-500 text-white hover:bg-amber-600"
                      >
                        Archive Duplicates
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>

          <div className="mt-8 border border-destructive/30 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 p-4 bg-destructive/5 border-b border-destructive/20">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h3 className="font-semibold text-destructive">Danger Zone</h3>
            </div>
            
            {/* Archive All Section */}
            <div className="p-4 border-b border-destructive/20">
              <div className="flex items-center gap-2 mb-2">
                <Archive className="h-4 w-4 text-amber-500" />
                <h4 className="font-medium">Archive All Trades (Reversible)</h4>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Hide all trades from the journal. You can restore them later from the Archived tab.
              </p>
              
              <div className="flex items-center gap-3">
                <Select value={archiveAllAccountId} onValueChange={setArchiveAllAccountId}>
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
                      variant="outline" 
                      className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                      disabled={!archiveAllAccountId || archiveAllMutation.isPending}
                    >
                      {archiveAllMutation.isPending ? 'Archiving...' : 'Archive All'}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Archive all trades?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will archive all trades for the selected account. They will be hidden from the journal, dashboard, and reports.
                        <br /><br />
                        <strong>You can restore them anytime</strong> from Journal → Archived tab.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction 
                        onClick={() => {
                          archiveAllMutation.mutate(archiveAllAccountId, {
                            onSuccess: () => setArchiveAllAccountId('')
                          });
                        }}
                        className="bg-amber-500 text-white hover:bg-amber-600"
                      >
                        Archive All Trades
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>

            {/* Fresh Start Section */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Flame className="h-4 w-4 text-destructive" />
                <h4 className="font-medium">Fresh Start (Permanent)</h4>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Delete all trades AND events for EA re-import. This cannot be undone.
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
          </div>
        </>
      )}

      <MT5SetupDialog account={setupAccount} onOpenChange={(open) => !open && setSetupAccount(null)} />
      <QuickConnectDialog open={quickConnectOpen} onOpenChange={setQuickConnectOpen} />
    </div>
  );
}
