import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Crown, Radio, Minus, AlertCircle, Loader2, ArrowRight, Copy, Key, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useUpdateCopierRole } from '@/hooks/useCopier';
import type { CopierRole } from '@/types/copier';
import type { Account } from '@/types/trading';

interface AccountRoleManagerProps {
  accounts: Account[];
  isLoading: boolean;
}

export function AccountRoleManager({ accounts, isLoading }: AccountRoleManagerProps) {
  const updateRole = useUpdateCopierRole();
  const { toast } = useToast();
  
  const masterAccount = accounts.find(a => a.copier_role === 'master');
  const receiverAccounts = accounts.filter(a => a.copier_role === 'receiver');

  const copyApiKey = async (apiKey: string) => {
    await navigator.clipboard.writeText(apiKey);
    toast({ title: 'API key copied to clipboard' });
  };
  
  const handleRoleChange = (accountId: string, newRole: CopierRole) => {
    // If setting as master, ensure no other master exists
    if (newRole === 'master' && masterAccount && masterAccount.id !== accountId) {
      // First demote current master
      updateRole.mutate({ accountId: masterAccount.id, role: 'independent' });
    }
    
    updateRole.mutate({ 
      accountId, 
      role: newRole,
      masterAccountId: newRole === 'receiver' ? masterAccount?.id : null,
    });
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  if (accounts.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No accounts found</p>
        <p className="text-sm">Create accounts in the Accounts page first</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Instructions */}
      <div className="bg-muted/50 rounded-lg p-4 text-sm">
        <h4 className="font-medium mb-2">How it works:</h4>
        <ul className="space-y-2 text-muted-foreground">
          <li className="flex items-start gap-2">
            <Crown className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <span><strong>Master</strong>: Your main trading account. Uses <code className="bg-muted px-1 rounded text-xs">TradeCopierMaster.mq5</code> (journals + writes queue)</span>
          </li>
          <li className="flex items-start gap-2">
            <Radio className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
            <span><strong>Receiver</strong>: Accounts that copy trades. Uses <code className="bg-muted px-1 rounded text-xs">TradeCopierReceiver.mq5</code> (executes + journals)</span>
          </li>
          <li className="flex items-start gap-2">
            <Minus className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <span><strong>Independent</strong>: Journal-only mode. Uses <code className="bg-muted px-1 rounded text-xs">TradeJournalBridge.mq5</code></span>
          </li>
        </ul>
      </div>
      
      {/* Visual Diagram */}
      {masterAccount && receiverAccounts.length > 0 && (
        <div className="flex items-center justify-center gap-4 py-4 bg-muted/30 rounded-lg">
          <div className="text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/20 mb-2">
              <Crown className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm font-medium">{masterAccount.name}</p>
            <p className="text-xs text-muted-foreground">Master</p>
          </div>
          
          <div className="flex flex-col items-center gap-1">
            {receiverAccounts.map((_, i) => (
              <ArrowRight key={i} className="h-4 w-4 text-muted-foreground" />
            ))}
          </div>
          
          <div className="space-y-2">
            {receiverAccounts.map(receiver => (
              <div key={receiver.id} className="text-center">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-500/20">
                  <Radio className="h-5 w-5 text-green-500" />
                </div>
                <p className="text-xs font-medium">{receiver.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Transition Note */}
      <Alert className="bg-blue-500/10 border-blue-500/30">
        <Info className="h-4 w-4 text-blue-500" />
        <AlertDescription className="text-sm">
          <strong>Switching from TradeJournalBridge?</strong> Use your existing API key in the new EA to keep all trades linked to the same account.
        </AlertDescription>
      </Alert>

      {/* Account List */}
      <div className="space-y-3">
        {accounts.map(account => {
          const currentRole = account.copier_role || 'independent';
          const isUpdating = updateRole.isPending;
          
          return (
            <Card key={account.id} className="overflow-hidden">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <RoleIcon role={currentRole} />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{account.name}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {account.broker || 'No broker'} 
                        {account.account_number && ` • ${account.account_number}`}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <RoleBadge role={currentRole} />
                    
                    <Select
                      value={currentRole}
                      onValueChange={(value) => handleRoleChange(account.id, value as CopierRole)}
                      disabled={isUpdating}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="independent">
                          <div className="flex items-center gap-2">
                            <Minus className="h-4 w-4" />
                            Independent
                          </div>
                        </SelectItem>
                        <SelectItem value="master">
                          <div className="flex items-center gap-2">
                            <Crown className="h-4 w-4" />
                            Master
                          </div>
                        </SelectItem>
                        <SelectItem value="receiver" disabled={!masterAccount || masterAccount.id === account.id}>
                          <div className="flex items-center gap-2">
                            <Radio className="h-4 w-4" />
                            Receiver
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                {/* API Key display for Master/Receiver accounts */}
                {currentRole !== 'independent' && account.api_key && (
                  <div className="pl-13 ml-10 pt-2 border-t border-dashed">
                    <div className="flex items-center gap-2">
                      <Key className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">API Key:</span>
                      <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
                        {account.api_key.slice(0, 8)}...{account.api_key.slice(-4)}
                      </code>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6"
                        onClick={() => copyApiKey(account.api_key!)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Use this key in {currentRole === 'master' ? 'TradeCopierMaster.mq5' : 'TradeCopierReceiver.mq5'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      
      {/* Warning if no master */}
      {!masterAccount && accounts.length > 0 && (
        <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-600 dark:text-yellow-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <p className="text-sm">Set one account as Master to enable trade copying</p>
        </div>
      )}
    </div>
  );
}

function RoleIcon({ role }: { role: CopierRole }) {
  switch (role) {
    case 'master':
      return (
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/20">
          <Crown className="h-5 w-5 text-primary" />
        </div>
      );
    case 'receiver':
      return (
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-500/20">
          <Radio className="h-5 w-5 text-green-500" />
        </div>
      );
    default:
      return (
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-muted">
          <Minus className="h-5 w-5 text-muted-foreground" />
        </div>
      );
  }
}

function RoleBadge({ role }: { role: CopierRole }) {
  switch (role) {
    case 'master':
      return <Badge className="bg-primary/20 text-primary border-primary/30">Master</Badge>;
    case 'receiver':
      return <Badge className="bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30">Receiver</Badge>;
    default:
      return <Badge variant="secondary">Independent</Badge>;
  }
}
