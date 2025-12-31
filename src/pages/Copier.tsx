import * as React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, ArrowLeftRight, Shield, Download, Activity, Monitor } from 'lucide-react';
import { AccountRoleManager } from '@/components/copier/AccountRoleManager';
import { SymbolMappingsPanel } from '@/components/copier/SymbolMappingsPanel';
import { RiskSettingsPanel } from '@/components/copier/RiskSettingsPanel';
import { ConfigExportPanel } from '@/components/copier/ConfigExportPanel';
import { CopierDashboard } from '@/components/copier/CopierDashboard';
import { ExecutionHistory } from '@/components/copier/ExecutionHistory';
import { DesktopAppPanel } from '@/components/copier/DesktopAppPanel';
import { useCopierAccounts } from '@/hooks/useCopier';

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
        <TabsList className="grid w-full grid-cols-6 lg:w-auto lg:inline-grid">
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
          <TabsTrigger value="desktop" className="gap-2">
            <Monitor className="h-4 w-4" />
            <span className="hidden sm:inline">Desktop</span>
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
        
        {/* Desktop App Tab */}
        <TabsContent value="desktop">
          <DesktopAppPanel 
            masterAccount={masterAccount}
            receiverAccounts={receiverAccounts}
          />
        </TabsContent>
        
        {/* Activity Tab */}
        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Execution History</CardTitle>
              <CardDescription>
                View recent copy executions and their status with real-time updates
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
