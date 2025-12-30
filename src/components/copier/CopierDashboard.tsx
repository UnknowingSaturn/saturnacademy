import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Activity, 
  CheckCircle, 
  XCircle, 
  Clock, 
  TrendingUp,
  AlertTriangle,
  Zap,
  Server,
  Users
} from 'lucide-react';
import { useCopierStats, useCopierAccounts, useCopierExecutions } from '@/hooks/useCopier';
import { format, formatDistanceToNow } from 'date-fns';

export function CopierDashboard() {
  const { data: accounts } = useCopierAccounts();
  const stats = useCopierStats();
  const { data: recentExecutions } = useCopierExecutions({ limit: 1 });
  
  const masterAccount = accounts?.find(a => a.copier_role === 'master');
  const receiverAccounts = accounts?.filter(a => a.copier_role === 'receiver') || [];
  const receiverCount = receiverAccounts.length;
  const isConfigured = !!masterAccount && receiverCount > 0;
  
  const lastExecution = recentExecutions?.[0];
  const lastActivityTime = lastExecution?.executed_at 
    ? formatDistanceToNow(new Date(lastExecution.executed_at), { addSuffix: true })
    : null;
  
  // Calculate today's stats
  const todayStats = React.useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return {
      todaySuccess: stats.totalExecutions > 0 ? Math.round(stats.successRate) : 0,
      todayFailed: stats.failedCount,
    };
  }, [stats]);
  
  return (
    <div className="space-y-4">
      {/* Main Stats Row */}
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
        
        {/* Total Executions */}
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
      
      {/* Secondary Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Configuration Summary */}
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">Configuration</span>
              <Server className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Master</span>
                {masterAccount ? (
                  <Badge variant="outline" className="font-mono">
                    {masterAccount.name}
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="text-xs">Not set</Badge>
                )}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Receivers</span>
                <Badge variant={receiverCount > 0 ? "secondary" : "destructive"}>
                  {receiverCount} {receiverCount === 1 ? 'account' : 'accounts'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Recent Activity */}
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">Last Activity</span>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </div>
            {lastExecution ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Symbol</span>
                  <span className="font-medium">{lastExecution.symbol}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Time</span>
                  <span className="text-muted-foreground">{lastActivityTime}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <Badge 
                    variant="outline" 
                    className={
                      lastExecution.status === 'success' 
                        ? 'text-green-600 border-green-500/30' 
                        : lastExecution.status === 'failed'
                        ? 'text-red-600 border-red-500/30'
                        : 'text-yellow-600 border-yellow-500/30'
                    }
                  >
                    {lastExecution.status}
                  </Badge>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No recent activity</p>
            )}
          </CardContent>
        </Card>
        
        {/* Health Indicators */}
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">Health</span>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Failed Today</span>
                <Badge 
                  variant={stats.failedCount === 0 ? "outline" : "destructive"}
                  className={stats.failedCount === 0 ? "text-green-600 border-green-500/30" : ""}
                >
                  {stats.failedCount}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Avg Slippage</span>
                <Badge 
                  variant="outline"
                  className={
                    stats.avgSlippage > 3 
                      ? "text-yellow-600 border-yellow-500/30" 
                      : "text-green-600 border-green-500/30"
                  }
                >
                  {stats.avgSlippage.toFixed(1)} pips
                </Badge>
              </div>
              {stats.avgSlippage > 3 && (
                <div className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                  <AlertTriangle className="h-3 w-3" />
                  <span>High slippage detected</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
