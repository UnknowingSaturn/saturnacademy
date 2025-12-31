import * as React from 'react';
import { useState, useMemo } from 'react';
import { useTrades } from '@/hooks/useTrades';
import { useAccounts } from '@/hooks/useAccounts';
import { useAccountFilter } from '@/contexts/AccountFilterContext';
import { useReports, getWeekPeriod, getMonthPeriod, getPreviousPeriod, ReportPeriod } from '@/hooks/useReports';
import { ReportMetricsGrid } from '@/components/reports/ReportMetricsGrid';
import { TradeHighlights } from '@/components/reports/TradeHighlights';
import { SymbolBreakdownTable } from '@/components/reports/SymbolBreakdownTable';
import { ExportControls } from '@/components/reports/ExportControls';
import { EquityCurve } from '@/components/dashboard/EquityCurve';
import { SessionBreakdown } from '@/components/dashboard/SessionBreakdown';
import { PlaybookCompliance } from '@/components/dashboard/PlaybookCompliance';

import { useDashboardMetrics } from '@/hooks/useDashboardMetrics';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronLeft, ChevronRight, LayoutDashboard, Loader2 } from 'lucide-react';
import { addWeeks, subWeeks, addMonths, subMonths } from 'date-fns';

const Dashboard = React.forwardRef<HTMLDivElement, object>(
  function Dashboard(_props, _ref) {
  const { data: allTrades = [], isLoading } = useTrades();
  const { data: accounts = [] } = useAccounts();
  const { selectedAccountId, selectedAccount } = useAccountFilter();
  const [periodType, setPeriodType] = useState<'week' | 'month'>('week');
  const [currentDate, setCurrentDate] = useState(new Date());

  // Filter trades by selected account
  const trades = useMemo(() => {
    if (selectedAccountId === 'all') return allTrades;
    return allTrades.filter(t => t.account_id === selectedAccountId);
  }, [allTrades, selectedAccountId]);

  // Calculate starting balance from selected account(s)
  const filteredAccounts = selectedAccountId === 'all' 
    ? accounts 
    : accounts.filter(a => a.id === selectedAccountId);
  
  const accountStartingBalance = filteredAccounts.reduce((sum, acc) => sum + Number(acc.balance_start || 0), 0);
  const currentEquity = filteredAccounts.reduce((sum, acc) => sum + Number(acc.equity_current || 0), 0);

  const period: ReportPeriod = periodType === 'week' 
    ? getWeekPeriod(currentDate) 
    : getMonthPeriod(currentDate);
  
  // Calculate previous period for comparison
  const previousPeriod = getPreviousPeriod(period);

  const { filteredTrades, metrics } = useReports(trades, period);
  const { filteredTrades: previousTrades, metrics: previousMetrics } = useReports(trades, previousPeriod);
  const dashboardMetrics = useDashboardMetrics(filteredTrades);

  // Calculate the starting balance for the equity curve
  // Priority: 1. First trade's balance_at_entry in current period
  //           2. Previous period's ending balance (start + pnl)
  //           3. Account's starting balance (fallback)
  const periodStartingBalance = React.useMemo(() => {
    // Sort current period trades by entry time to find the earliest
    const sortedCurrentTrades = [...filteredTrades]
      .filter(t => t.balance_at_entry !== null)
      .sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime());
    
    // If we have trades in the current period with balance_at_entry, use the first one
    if (sortedCurrentTrades.length > 0 && sortedCurrentTrades[0].balance_at_entry) {
      return sortedCurrentTrades[0].balance_at_entry;
    }

    // Otherwise, calculate from previous period trades
    // Sort previous period trades by entry time to find the earliest one's balance
    const sortedPrevTrades = [...previousTrades]
      .filter(t => t.balance_at_entry !== null)
      .sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime());
    
    if (sortedPrevTrades.length > 0 && sortedPrevTrades[0].balance_at_entry) {
      // Previous period starting balance + all previous period P&L = this period's starting balance
      const prevStartBalance = sortedPrevTrades[0].balance_at_entry;
      const prevTotalPnl = previousTrades.reduce((sum, t) => sum + (t.net_pnl || 0), 0);
      return prevStartBalance + prevTotalPnl;
    }

    // Fallback to account's static starting balance
    return accountStartingBalance;
  }, [filteredTrades, previousTrades, accountStartingBalance]);

  const navigatePrev = () => {
    setCurrentDate(prev => 
      periodType === 'week' ? subWeeks(prev, 1) : subMonths(prev, 1)
    );
  };

  const navigateNext = () => {
    setCurrentDate(prev => 
      periodType === 'week' ? addWeeks(prev, 1) : addMonths(prev, 1)
    );
  };

  const goToCurrentPeriod = () => {
    setCurrentDate(new Date());
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <LayoutDashboard className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Dashboard
              {selectedAccount && (
                <span className="text-lg font-normal text-muted-foreground ml-2">
                  • {selectedAccount.name}
                </span>
              )}
            </h1>
            <p className="text-muted-foreground text-sm">
              Your trading performance at a glance
            </p>
          </div>
        </div>

        {/* Period Selector */}
        <div className="flex items-center gap-4">
          <Tabs 
            value={periodType} 
            onValueChange={(v) => setPeriodType(v as 'week' | 'month')}
          >
            <TabsList className="glass-card">
              <TabsTrigger value="week">Weekly</TabsTrigger>
              <TabsTrigger value="month">Monthly</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Period Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          onClick={navigatePrev}
          className="h-10 w-10"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">
            {period.label}
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={goToCurrentPeriod}
            className="text-xs"
          >
            Today
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={navigateNext}
          className="h-10 w-10"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Metrics Grid */}
      <ReportMetricsGrid metrics={metrics} />

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <EquityCurve 
          trades={filteredTrades} 
          startingBalance={periodStartingBalance} 
          previousPeriodPnl={previousMetrics.totalPnl}
          periodLabel={periodType === 'week' ? 'week' : 'month'}
        />
        <SessionBreakdown bySession={dashboardMetrics.bySession} />
      </div>


      {/* Main Content */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Trade Highlights */}
          <TradeHighlights metrics={metrics} />

          {/* Breakdown Tables */}
          <SymbolBreakdownTable metrics={metrics} />
        </div>

        {/* Sidebar - Export Controls & Compliance */}
        <div className="space-y-4">
          <PlaybookCompliance />
          <ExportControls
            trades={trades}
            metrics={metrics}
            period={period}
            filteredTrades={filteredTrades}
          />
        </div>
      </div>

      {/* No Data State */}
      {filteredTrades.length === 0 && (
        <div className="text-center py-12">
          <LayoutDashboard className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">
            No trades for this period
          </h3>
          <p className="text-muted-foreground text-sm">
            Try selecting a different date range or period type.
          </p>
        </div>
        )}
      </div>
    );
  }
);

export default Dashboard;
