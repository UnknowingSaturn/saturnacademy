import * as React from 'react';
import { useState } from 'react';
import { useTrades } from '@/hooks/useTrades';
import { useAccounts } from '@/hooks/useAccounts';
import { useReports, getWeekPeriod, getMonthPeriod, ReportPeriod } from '@/hooks/useReports';
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
  const { data: trades = [], isLoading } = useTrades();
  const { data: accounts = [] } = useAccounts();
  const [periodType, setPeriodType] = useState<'week' | 'month'>('week');
  const [currentDate, setCurrentDate] = useState(new Date());

  // Calculate starting balance and current equity from all active accounts
  const startingBalance = accounts.reduce((sum, acc) => sum + Number(acc.balance_start || 0), 0);
  const currentEquity = accounts.reduce((sum, acc) => sum + Number(acc.equity_current || 0), 0);

  const period: ReportPeriod = periodType === 'week' 
    ? getWeekPeriod(currentDate) 
    : getMonthPeriod(currentDate);

  const { filteredTrades, metrics } = useReports(trades, period);
  const dashboardMetrics = useDashboardMetrics(filteredTrades);

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
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
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
        <EquityCurve trades={filteredTrades} startingBalance={startingBalance} currentEquity={currentEquity} />
        <SessionBreakdown bySession={dashboardMetrics.bySession} />
      </div>

      {/* Main Content */}
      <div className="grid lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 space-y-6">
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
