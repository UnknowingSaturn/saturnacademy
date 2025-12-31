import { useState } from 'react';
import { Copy, Eye, EyeOff, Settings, Trash2, Terminal, History, Activity, AlertTriangle, Crown, Radio, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useDeleteAccount } from '@/hooks/useAccounts';
import { useAccountStatus } from '@/hooks/useAccountStatus';
import { Account } from '@/types/trading';
import { formatDistanceToNow } from 'date-fns';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { EditAccountDialog } from './EditAccountDialog';
import { ImportHistoryDialog } from './ImportHistoryDialog';

interface AccountCardProps {
  account: Account;
  onSetupMT5: () => void;
}

export function AccountCard({ account, onSetupMT5 }: AccountCardProps) {
  const { toast } = useToast();
  const deleteAccount = useDeleteAccount();
  const { data: status } = useAccountStatus(account.id);
  const [showApiKey, setShowApiKey] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [importHistoryOpen, setImportHistoryOpen] = useState(false);

  // Determine connection status
  const isConnected = status?.lastEventAt && 
    (new Date().getTime() - status.lastEventAt.getTime()) < 24 * 60 * 60 * 1000; // Active in last 24h
  const neverConnected = !status?.lastEventAt;

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
              {/* EA Type Indicator */}
              {account.copier_role === 'master' && (
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                  <Crown className="h-3 w-3 mr-1" />
                  Master
                </Badge>
              )}
              {account.copier_role === 'receiver' && (
                <Badge variant="outline" className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30">
                  <Radio className="h-3 w-3 mr-1" />
                  Receiver
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

          {/* Connection Status */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {neverConnected ? (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                ) : isConnected ? (
                  <Activity className="h-4 w-4 text-green-500" />
                ) : (
                  <Activity className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">
                  {neverConnected ? 'Not connected' : isConnected ? 'Connected' : 'Inactive'}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {status?.tradeCount || 0} trades
              </span>
            </div>
            {status?.lastEventAt && (
              <p className="text-xs text-muted-foreground">
                Last activity: {formatDistanceToNow(status.lastEventAt, { addSuffix: true })}
              </p>
            )}
            {neverConnected && (
              <p className="text-xs text-muted-foreground">
                Set up MT5 to start syncing trades
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">API Key</span>
              {account.copier_role && account.copier_role !== 'independent' && (
                <span className="text-xs text-muted-foreground">
                  Use this key in {account.copier_role === 'master' ? 'TradeCopierMaster' : 'TradeCopierReceiver'}
                </span>
              )}
            </div>
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
            {account.copier_role && account.copier_role !== 'independent' && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Use this same API key when switching EAs to keep trades linked
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" className="flex-1" onClick={onSetupMT5}>
              <Terminal className="h-4 w-4 mr-2" />
              MT5 Setup
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="icon" 
                    onClick={() => setImportHistoryOpen(true)}
                  >
                    <History className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Import closed trades from MT5 history</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
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
