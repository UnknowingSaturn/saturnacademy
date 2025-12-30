import * as React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, ArrowLeftRight, Shield, Download, Activity, CheckCircle, XCircle, AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react';
import { AccountRoleManager } from '@/components/copier/AccountRoleManager';
import { SymbolMappingsPanel } from '@/components/copier/SymbolMappingsPanel';
import { RiskSettingsPanel } from '@/components/copier/RiskSettingsPanel';
import { ConfigExportPanel } from '@/components/copier/ConfigExportPanel';
import { CopierDashboard } from '@/components/copier/CopierDashboard';
import { useCopierAccounts, useCopierExecutions } from '@/hooks/useCopier';
import { format } from 'date-fns';

export default function Copier() {
  const { data: accounts, isLoading } = useCopierAccounts();
  
  const masterAccount = accounts?.find(a => a.copier_role === 'master');
  const receiverAccounts = accounts?.filter(a => a.copier_role === 'receiver') || [];
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Trade Copier</h1>
        <p className="text-muted-foreground">
          Configure local trade copying between your accounts
        </p>
      </div>
      
      {/* Quick Stats */}
      <CopierDashboard />
      
      {/* Main Configuration */}
      <Tabs defaultValue="accounts" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
          <TabsTrigger value="accounts" className="gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Accounts</span>
          </TabsTrigger>
          <TabsTrigger value="symbols" className="gap-2">
            <ArrowLeftRight className="h-4 w-4" />
            <span className="hidden sm:inline">Symbols</span>
          </TabsTrigger>
          <TabsTrigger value="risk" className="gap-2">
            <Shield className="h-4 w-4" />
            <span className="hidden sm:inline">Risk</span>
          </TabsTrigger>
          <TabsTrigger value="export" className="gap-2">
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export</span>
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-2">
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">Activity</span>
          </TabsTrigger>
        </TabsList>
        
        {/* Accounts Tab */}
        <TabsContent value="accounts">
          <Card>
            <CardHeader>
              <CardTitle>Account Roles</CardTitle>
              <CardDescription>
                Assign master and receiver roles to your trading accounts
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AccountRoleManager 
                accounts={accounts || []} 
                isLoading={isLoading} 
              />
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Symbols Tab */}
        <TabsContent value="symbols">
          <Card>
            <CardHeader>
              <CardTitle>Symbol Mappings</CardTitle>
              <CardDescription>
                Map symbols between master and receiver accounts for proper trade copying
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SymbolMappingsPanel 
                masterAccount={masterAccount}
                receiverAccounts={receiverAccounts}
              />
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Risk Tab */}
        <TabsContent value="risk">
          <Card>
            <CardHeader>
              <CardTitle>Risk & Safety Settings</CardTitle>
              <CardDescription>
                Configure risk calculation and safety controls for each receiver
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RiskSettingsPanel receiverAccounts={receiverAccounts} />
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Export Tab */}
        <TabsContent value="export">
          <Card>
            <CardHeader>
              <CardTitle>Export Configuration</CardTitle>
              <CardDescription>
                Generate and download the configuration file for your receiver EAs
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ConfigExportPanel 
                masterAccount={masterAccount}
                receiverAccounts={receiverAccounts}
              />
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Activity Tab */}
        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Execution History</CardTitle>
              <CardDescription>
                View recent copy executions and their status
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ExecutionHistory />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Execution History Component
function ExecutionHistory() {
  const { data: executions, isLoading } = useCopierExecutions({ limit: 50 });
  
  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading...</div>;
  }
  
  if (!executions || executions.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No execution history yet</p>
        <p className="text-sm">Executions will appear here once the copier is active</p>
      </div>
    );
  }
  
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead>Direction</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Lots</TableHead>
            <TableHead>Slippage</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {executions.map((execution) => (
            <TableRow key={execution.id}>
              <TableCell className="text-muted-foreground text-sm">
                {execution.executed_at 
                  ? format(new Date(execution.executed_at), 'MMM d, HH:mm:ss')
                  : '-'}
              </TableCell>
              <TableCell className="font-medium">{execution.symbol}</TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  {execution.direction === 'buy' ? (
                    <ArrowUp className="h-3 w-3 text-green-500" />
                  ) : (
                    <ArrowDown className="h-3 w-3 text-red-500" />
                  )}
                  <span className={execution.direction === 'buy' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                    {execution.direction.toUpperCase()}
                  </span>
                </div>
              </TableCell>
              <TableCell className="capitalize">{execution.event_type}</TableCell>
              <TableCell>{execution.receiver_lots?.toFixed(2) || '-'}</TableCell>
              <TableCell>
                {execution.slippage_pips != null ? (
                  <span className={execution.slippage_pips > 2 ? 'text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground'}>
                    {execution.slippage_pips.toFixed(1)} pips
                  </span>
                ) : '-'}
              </TableCell>
              <TableCell>
                <StatusBadge status={execution.status} error={execution.error_message} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StatusBadge({ status, error }: { status: string; error?: string | null }) {
  switch (status) {
    case 'success':
      return (
        <Badge className="bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30">
          <CheckCircle className="h-3 w-3 mr-1" />
          Success
        </Badge>
      );
    case 'failed':
      return (
        <Badge 
          className="bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30"
          title={error || undefined}
        >
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    case 'skipped':
      return (
        <Badge className="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Skipped
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}
