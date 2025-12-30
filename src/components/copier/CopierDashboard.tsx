import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, CheckCircle, XCircle, Clock, TrendingUp } from 'lucide-react';
import { useCopierStats, useCopierAccounts } from '@/hooks/useCopier';

export function CopierDashboard() {
  const { data: accounts } = useCopierAccounts();
  const stats = useCopierStats();
  
  const masterAccount = accounts?.find(a => (a as any).copier_role === 'master');
  const receiverCount = accounts?.filter(a => (a as any).copier_role === 'receiver').length || 0;
  const isConfigured = !!masterAccount && receiverCount > 0;
  
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* Status */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <div className="flex items-center gap-2 mt-1">
                {isConfigured ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="font-medium text-green-600 dark:text-green-400">Ready</span>
                  </>
                ) : (
                  <>
                    <div className="w-2 h-2 rounded-full bg-yellow-500" />
                    <span className="font-medium text-yellow-600 dark:text-yellow-400">Setup Needed</span>
                  </>
                )}
              </div>
            </div>
            <Activity className="h-5 w-5 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
      
      {/* Executions */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Copies</p>
              <p className="text-2xl font-bold">{stats.totalExecutions}</p>
            </div>
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
      
      {/* Success Rate */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Success Rate</p>
              <p className="text-2xl font-bold">
                {stats.totalExecutions > 0 ? `${stats.successRate.toFixed(1)}%` : '-'}
              </p>
            </div>
            <CheckCircle className="h-5 w-5 text-green-500" />
          </div>
        </CardContent>
      </Card>
      
      {/* Avg Slippage */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Avg Slippage</p>
              <p className="text-2xl font-bold">
                {stats.totalExecutions > 0 ? `${stats.avgSlippage.toFixed(1)}` : '-'}
                <span className="text-sm font-normal text-muted-foreground ml-1">pips</span>
              </p>
            </div>
            <Clock className="h-5 w-5 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
