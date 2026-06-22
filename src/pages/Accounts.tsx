import { useState } from 'react';
import { Link, AlertTriangle, Archive, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAccounts } from '@/hooks/useAccounts';
import { useArchiveAllTrades } from '@/hooks/useTrades';
import { AccountCard } from '@/components/accounts/AccountCard';
import { MT5SetupDialog } from '@/components/accounts/MT5SetupDialog';
import { QuickConnectDialog } from '@/components/accounts/QuickConnectDialog';
import { ChallengePlannerCard } from '@/components/accounts/ChallengePlannerCard';
import { PageIntroBanner } from '@/components/tutorial/PageIntroBanner';
import { TutorialDialog } from '@/components/tutorial/TutorialDialog';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { Account } from '@/types/trading';
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
  const { data: accounts, isLoading } = useAccounts();
  const archiveAllMutation = useArchiveAllTrades();
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);
  const [setupAccount, setSetupAccount] = useState<Account | null>(null);
  const [archiveAllAccountId, setArchiveAllAccountId] = useState<string>('');
  const firstVisit = useFirstVisit('accounts');
  const [tutorialOpen, setTutorialOpen] = useState(firstVisit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Accounts</h1>
          <p className="text-muted-foreground">Manage your trading accounts and MT5 connections</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTutorialOpen(true)}>
            <HelpCircle className="h-4 w-4 mr-2" />
            How it works
          </Button>
          <Button onClick={() => setQuickConnectOpen(true)}>
            <Link className="h-4 w-4 mr-2" />
            Connect MT5
          </Button>
        </div>
      </div>

      <PageIntroBanner
        routeKey="accounts"
        title="Connect MT5 terminals — one EA per chart, many accounts supported"
        body="Track several accounts in parallel by installing MT5 once per account and attaching the bridge EA to a scratch chart in each. The EA is read-only and prop-firm safe."
        actionLabel="Open the setup guide"
        onAction={() => setTutorialOpen(true)}
      />

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

          <div className="mt-8 border border-destructive/30 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 p-4 bg-destructive/5 border-b border-destructive/20">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h3 className="font-semibold text-destructive">Danger Zone</h3>
            </div>

            <div className="p-4">
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
                            onSuccess: () => setArchiveAllAccountId(''),
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
          </div>
        </>
      )}

      <MT5SetupDialog account={setupAccount} onOpenChange={(open) => !open && setSetupAccount(null)} />
      <QuickConnectDialog open={quickConnectOpen} onOpenChange={setQuickConnectOpen} />
      <TutorialDialog
        open={tutorialOpen}
        onOpenChange={setTutorialOpen}
        title="MT5 setup & best practices"
        description="Everything you need to connect terminals, run several accounts, and avoid prop-firm pitfalls."
      />
    </div>
  );
}
