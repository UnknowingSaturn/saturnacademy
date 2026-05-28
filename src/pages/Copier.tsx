import * as React from 'react';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { LayoutDashboard, Activity, HelpCircle } from 'lucide-react';
import { CopierDashboard } from '@/components/copier/CopierDashboard';
import { CopierDashboardView } from '@/components/copier/CopierDashboardView';
import { ExecutionHistory } from '@/components/copier/ExecutionHistory';
import { PageIntroBanner } from '@/components/tutorial/PageIntroBanner';
import { TutorialDialog } from '@/components/tutorial/TutorialDialog';
import { useCopierAccounts } from '@/hooks/useCopier';

export default function Copier() {
  const { data: accounts } = useCopierAccounts();
  const [tutorialOpen, setTutorialOpen] = useState(false);
  
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Trade Copier</h1>
          <p className="text-muted-foreground">
            Copy trades from your master account to receiver accounts with automatic journaling
          </p>
        </div>
        <Button variant="outline" onClick={() => setTutorialOpen(true)}>
          <HelpCircle className="h-4 w-4 mr-2" />
          How it works
        </Button>
      </div>

      <PageIntroBanner
        routeKey="copier"
        title="Run master and receivers on separate scratch charts"
        body="The copier EA is read-only on the master and order-only on receivers. Give each EA its own dedicated chart so position sizers and other EAs don't interfere. Receiver SL/TP is locked to stay prop-firm compliant."
        actionLabel="View setup guide"
        onAction={() => setTutorialOpen(true)}
      />

      {/* Quick Stats - only show if setup exists */}
      {hasCopierSetup && <CopierDashboard />}
      
      {/* Main Content */}
      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 lg:w-auto lg:inline-grid">
          <TabsTrigger value="dashboard" className="gap-2">
            <LayoutDashboard className="h-4 w-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-2" disabled={!hasCopierSetup}>
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">Activity</span>
          </TabsTrigger>
        </TabsList>
        
        {/* Dashboard Tab */}
        <TabsContent value="dashboard">
          <CopierDashboardView />
        </TabsContent>
        
        {/* Activity Tab */}
        <TabsContent value="activity">
          <ExecutionHistory />
        </TabsContent>
      </Tabs>

      <TutorialDialog
        open={tutorialOpen}
        onOpenChange={setTutorialOpen}
        title="Copier setup & best practices"
        description="Master vs receiver, chart placement, symbol mapping and prop-firm safety."
        defaultTab="dedicated-chart"
      />
    </div>
  );
}
