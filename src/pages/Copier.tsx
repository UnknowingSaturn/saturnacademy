import * as React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeftRight, Shield, Download, Activity, Monitor, LayoutDashboard } from 'lucide-react';
import { SymbolMappingsPanel } from '@/components/copier/SymbolMappingsPanel';
import { RiskSettingsPanel } from '@/components/copier/RiskSettingsPanel';
import { CopierDashboard } from '@/components/copier/CopierDashboard';
import { ExecutionHistory } from '@/components/copier/ExecutionHistory';
import { DesktopAppPanel } from '@/components/copier/DesktopAppPanel';
import { CopierOverview } from '@/components/copier/CopierOverview';
import { useCopierAccounts } from '@/hooks/useCopier';

export default function Copier() {
  const { data: accounts } = useCopierAccounts();
  
  // Only show accounts where the actual copier EA is running (ea_type matches copier_role)
  const masterAccount = accounts?.find(a => 
    a.copier_role === 'master' && a.ea_type === 'master'
  );
  const receiverAccounts = accounts?.filter(a => 
    a.copier_role === 'receiver' && a.ea_type === 'receiver'
  ) || [];
  const hasCopierSetup = masterAccount || receiverAccounts.length > 0;
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Trade Copier</h1>
        <p className="text-muted-foreground">
          Copy trades from your master account to receiver accounts with automatic journaling
        </p>
      </div>

      {/* Quick Stats - only show if setup exists */}
      {hasCopierSetup && <CopierDashboard />}
      
      {/* Main Configuration */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
          <TabsTrigger value="overview" className="gap-2">
            <LayoutDashboard className="h-4 w-4" />
            <span className="hidden sm:inline">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="desktop" className="gap-2">
            <Monitor className="h-4 w-4" />
            <span className="hidden sm:inline">Desktop</span>
          </TabsTrigger>
          <TabsTrigger value="symbols" className="gap-2" disabled={!hasCopierSetup}>
            <ArrowLeftRight className="h-4 w-4" />
            <span className="hidden sm:inline">Symbols</span>
          </TabsTrigger>
          <TabsTrigger value="risk" className="gap-2" disabled={!hasCopierSetup}>
            <Shield className="h-4 w-4" />
            <span className="hidden sm:inline">Risk</span>
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-2" disabled={!hasCopierSetup}>
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">Activity</span>
          </TabsTrigger>
        </TabsList>
        
        {/* Overview Tab */}
        <TabsContent value="overview">
          <CopierOverview />
        </TabsContent>

        {/* Desktop App Tab */}
        <TabsContent value="desktop">
          <DesktopAppPanel 
            masterAccount={masterAccount}
            receiverAccounts={receiverAccounts}
          />
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
