import { useState } from 'react';
import { Copy, Eye, EyeOff, Settings, Trash2, Terminal, History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useDeleteAccount } from '@/hooks/useAccounts';
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
import { EditAccountDialog } from './EditAccountDialog';
import { ImportHistoryDialog } from './ImportHistoryDialog';

interface AccountCardProps {
  account: Account;
  onSetupMT5: () => void;
}

export function AccountCard({ account, onSetupMT5 }: AccountCardProps) {
  const { toast } = useToast();
  const deleteAccount = useDeleteAccount();
  const [showApiKey, setShowApiKey] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [importHistoryOpen, setImportHistoryOpen] = useState(false);

  const copyApiKey = async () => {
    if (account.api_key) {
      await navigator.clipboard.writeText(account.api_key);
      toast({ title: 'API key copied to clipboard' });
    }
  };

  const maskedKey = account.api_key
    ? `${account.api_key.slice(0, 8)}${'•'.repeat(20)}${account.api_key.slice(-4)}`
    : 'No API key';

  const accountTypeLabel = {
    demo: 'Demo',
    live: 'Live',
    prop: 'Funded',
  }[account.account_type || 'demo'];

  const accountTypeVariant = {
    demo: 'secondary',
    live: 'default',
    prop: 'destructive',
  }[account.account_type || 'demo'] as 'secondary' | 'default' | 'destructive';

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <CardTitle className="text-lg">{account.name}</CardTitle>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {account.broker && <span>{account.broker}</span>}
                {account.account_number && (
                  <>
                    <span>•</span>
                    <span>#{account.account_number}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={accountTypeVariant}>{accountTypeLabel}</Badge>
              {account.prop_firm && account.account_type === 'prop' && (
                <Badge variant="outline" className="uppercase">
                  {account.prop_firm}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Starting Balance</span>
              <p className="font-medium">${(account.balance_start || 0).toLocaleString()}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Current Equity</span>
              <p className="font-medium">${(account.equity_current || 0).toLocaleString()}</p>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-sm text-muted-foreground">API Key</span>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono truncate">
                {showApiKey ? account.api_key || 'No API key' : maskedKey}
              </code>
              <Button variant="ghost" size="icon" onClick={() => setShowApiKey(!showApiKey)}>
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" onClick={copyApiKey} disabled={!account.api_key}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" className="flex-1" onClick={onSetupMT5}>
              <Terminal className="h-4 w-4 mr-2" />
              MT5 Setup
            </Button>
            <Button 
              variant="outline" 
              size="icon" 
              onClick={() => setImportHistoryOpen(true)}
              title="Import historical trades"
            >
              <History className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setEditOpen(true)}>
              <Settings className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Account</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{account.name}"? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteAccount.mutate(account.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      <EditAccountDialog account={account} open={editOpen} onOpenChange={setEditOpen} />
      <ImportHistoryDialog account={account} open={importHistoryOpen} onOpenChange={setImportHistoryOpen} />
    </>
  );
}
